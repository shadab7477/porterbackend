// controllers/paymentController.js
import Razorpay from 'razorpay';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import crypto from 'crypto';
import WalletTransaction from '../models/WalletTransaction.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';

// Initialize Razorpay with your live keys
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX'
});

// ==================== CREATE PAYMENT ORDER ====================
export const createPaymentOrder = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId } = req.body;
        
        console.log("📝 Creating Razorpay order for ride:", rideId);

        if (!rideId) {
            return res.status(400).json({ success: false, message: 'rideId is required' });
        }

        // Fetch ride and verify it belongs to this customer
        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Only create order for non-cash rides
        if (ride.paymentMethod === 'cash') {
            return res.status(400).json({
                success: false,
                message: 'Cash rides do not require a payment order'
            });
        }

        // If a payment already exists and is completed, return success
        if (ride.paymentStatus === 'completed') {
            return res.json({
                success: true,
                message: 'Payment already completed',
                data: {
                    rideId: ride.rideId,
                    paymentStatus: 'completed',
                    amount: ride.fare.finalAmount
                }
            });
        }

        // Amount in paise (Razorpay uses smallest currency unit)
        const amountInPaise = Math.round(ride.fare.finalAmount * 100);

        // Create order in Razorpay with UPI support
        const options = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: `receipt_${ride.rideId}`,
            payment_capture: 1,
            notes: {
                rideId: ride.rideId,
                customerId: customerId.toString(),
                customerPhone: ride.customer.phone || '',
                pickupAddress: ride.pickupLocation.address,
                dropAddress: ride.dropLocation.address
            }
        };

        const order = await razorpay.orders.create(options);
        console.log("✅ Order created:", order.id);

        // Store order ID on the ride
        ride.paymentIntentId = order.id;
        ride.paymentStatus = 'processing';
        await ride.save();

        // Create payment record
        const payment = new Payment({
            paymentId: order.id,
            orderId: ride._id,
            customerId: customerId,
            amount: ride.fare.finalAmount,
            method: ride.paymentMethod,
            status: 'pending',
            transactionId: order.id,
            metadata: {
                orderId: order.id,
                amount: amountInPaise,
                currency: 'INR'
            }
        });
        await payment.save();

        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                amountInPaise: amountInPaise,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
                customerName: ride.customer.name || 'Customer',
                customerEmail: req.customerEmail || '',
                customerPhone: ride.customer.phone || '',
                fareBreakdown: {
                    distanceFare: ride.fare.distanceFare,
                    total: ride.fare.total,
                    finalAmount: ride.fare.finalAmount
                }
            }
        });

    } catch (error) {
        console.error('❌ Create Razorpay order error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment order'
        });
    }
};

// ==================== VERIFY PAYMENT SIGNATURE ====================
export const verifyPayment = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { 
            rideId, 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature 
        } = req.body;

        console.log("🔍 Verifying payment:", { rideId, razorpay_order_id, razorpay_payment_id });

        if (!rideId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return res.status(400).json({ 
                success: false, 
                message: 'rideId, payment_id, order_id and signature are required' 
            });
        }

        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Verify the order belongs to this ride
        if (ride.paymentIntentId && ride.paymentIntentId !== razorpay_order_id) {
            return res.status(400).json({ success: false, message: 'Payment order mismatch' });
        }

        // Generate signature for verification
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX')
            .update(body.toString())
            .digest('hex');

        console.log("🔐 Signature verification:");
        console.log("Expected:", expectedSignature);
        console.log("Received:", razorpay_signature);

        // Verify signature
        if (expectedSignature === razorpay_signature) {
            // Payment verified successfully
            ride.paymentStatus = 'completed';
            ride.paymentIntentId = razorpay_order_id;
            await ride.save();

            // Update payment record
            await Payment.findOneAndUpdate(
                { paymentId: razorpay_order_id },
                {
                    status: 'success',
                    transactionId: razorpay_payment_id,
                    paidAt: new Date(),
                    metadata: {
                        paymentId: razorpay_payment_id,
                        signature: razorpay_signature,
                        verifiedAt: new Date().toISOString()
                    }
                }
            );

            // Notify driver via socket that payment is done
            const io = req.app.get('io');
            if (io) {
                io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                    rideId: ride.rideId,
                    message: 'Payment confirmed. You can now start the ride.',
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    amount: ride.fare.finalAmount,
                    paymentMethod: 'UPI'
                });
            }

            return res.json({
                success: true,
                message: 'Payment verified successfully',
                data: {
                    rideId: ride.rideId,
                    paymentStatus: 'completed',
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    amount: ride.fare.finalAmount,
                    paymentMethod: 'UPI'
                }
            });
        } else {
            // Signature verification failed
            console.error("❌ Signature verification failed");
            
            ride.paymentStatus = 'failed';
            await ride.save();

            await Payment.findOneAndUpdate(
                { paymentId: razorpay_order_id },
                { 
                    status: 'failed',
                    metadata: {
                        error: 'Signature verification failed',
                        expectedSignature,
                        receivedSignature: razorpay_signature
                    }
                }
            );

            return res.status(400).json({
                success: false,
                message: 'Payment verification failed - invalid signature'
            });
        }

    } catch (error) {
        console.error('❌ Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify payment'
        });
    }
};

// ==================== GET PAYMENT STATUS ====================
export const getPaymentStatus = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId } = req.params;

        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId })
            .select('rideId paymentMethod paymentStatus paymentIntentId fare');

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        let razorpayStatus = null;
        let paymentDetails = null;

        // Try to fetch payment details from database
        const payment = await Payment.findOne({ paymentId: ride.paymentIntentId });
        
        if (payment) {
            razorpayStatus = payment.status;
            paymentDetails = {
                paymentId: payment.transactionId,
                paidAt: payment.paidAt,
                method: payment.method,
                metadata: payment.metadata
            };
        }

        // If payment is completed, try to fetch from Razorpay
        if (ride.paymentStatus === 'completed' && ride.paymentIntentId) {
            try {
                const razorpayPayment = await razorpay.orders.fetch(ride.paymentIntentId);
                razorpayStatus = razorpayPayment.status;
            } catch (e) {
                console.log('Could not fetch from Razorpay:', e.message);
            }
        }

        res.json({
            success: true,
            data: {
                rideId: ride.rideId,
                paymentMethod: ride.paymentMethod,
                paymentStatus: ride.paymentStatus,
                orderId: ride.paymentIntentId,
                razorpayStatus,
                amount: ride.fare.finalAmount,
                paymentDetails,
                upiDetails: ride.paymentMethod === 'upi' ? {
                    vpa: payment?.metadata?.vpa || 'N/A',
                    transactionId: payment?.transactionId
                } : null
            }
        });

    } catch (error) {
        console.error('❌ Get payment status error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to get payment status' 
        });
    }
};

// ==================== RAZORPAY WEBHOOK ====================
export const handleRazorpayWebhook = async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '@nJb2@ULG3j@rPh';
        
        console.log("📨 Webhook received at:", new Date().toISOString());
        
        // Verify webhook signature
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        console.log("🔐 Webhook Signature - Expected:", digest);
        console.log("🔐 Webhook Signature - Received:", req.headers['x-razorpay-signature']);

        if (digest !== req.headers['x-razorpay-signature']) {
            console.error('❌ Invalid webhook signature');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body.event;
        const payload = req.body.payload;

        console.log('✅ Webhook event:', event);

        // Handle different event types
        switch (event) {
            case 'payment.captured':
            case 'payment.authorized':
                const paymentEntity = payload.payment.entity;
                const orderId = paymentEntity.order_id;
                
                console.log('💰 Payment captured:', {
                    orderId,
                    paymentId: paymentEntity.id,
                    amount: paymentEntity.amount / 100,
                    method: paymentEntity.method
                });

                // Check if this is a wallet top-up
                if (paymentEntity.notes && paymentEntity.notes.type === 'wallet_topup') {
                    console.log('💳 Processing Wallet Top-up webhook');
                    const transaction = await WalletTransaction.findOne({ transactionId: orderId });
                    
                    if (transaction && transaction.status === 'pending') {
                        transaction.status = 'completed';
                        await transaction.save();
                        
                        const userModel = transaction.userType === 'Customer' ? Customer : Driver;
                        await userModel.findByIdAndUpdate(
                            transaction.userId,
                            { $inc: { walletBalance: transaction.amount } }
                        );
                        console.log(`✅ Wallet balance updated for ${transaction.userType}:`, transaction.userId);
                    }
                    break;
                }

                // Find ride by paymentIntentId (which stores Razorpay order ID)
                const ride = await Ride.findOne({ paymentIntentId: orderId });
                
                if (ride) {
                    ride.paymentStatus = 'completed';
                    await ride.save();
                    console.log('✅ Ride payment status updated:', ride.rideId);

                    // Update payment record
                    await Payment.findOneAndUpdate(
                        { paymentId: orderId },
                        {
                            status: 'success',
                            transactionId: paymentEntity.id,
                            paidAt: new Date(),
                            method: paymentEntity.method,
                            metadata: {
                                paymentId: paymentEntity.id,
                                method: paymentEntity.method,
                                vpa: paymentEntity.vpa,
                                bank: paymentEntity.bank,
                                capturedAt: new Date().toISOString()
                            }
                        }
                    );
                    console.log('✅ Payment record updated');

                    // Notify via socket if needed
                    const io = req.app.get('io');
                    if (io) {
                        io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                            rideId: ride.rideId,
                            message: 'Payment confirmed via webhook',
                            paymentId: paymentEntity.id,
                            method: paymentEntity.method
                        });
                    }
                } else {
                    console.log('❌ No ride found with orderId:', orderId);
                }
                break;

            case 'payment.failed':
                const failedPayment = payload.payment.entity;
                const failedOrderId = failedPayment.order_id;
                
                console.log('❌ Payment failed:', {
                    orderId: failedOrderId,
                    paymentId: failedPayment.id,
                    error: failedPayment.error_description
                });

                // Check if this is a wallet top-up failure
                if (failedPayment.notes && failedPayment.notes.type === 'wallet_topup') {
                    console.log('💳 Wallet Top-up failed webhook');
                    const failedTx = await WalletTransaction.findOne({ transactionId: failedOrderId });
                    if (failedTx && failedTx.status === 'pending') {
                        failedTx.status = 'failed';
                        await failedTx.save();
                        console.log('❌ Wallet transaction marked as failed');
                    }
                    break;
                }

                const failedRide = await Ride.findOne({ paymentIntentId: failedOrderId });
                if (failedRide) {
                    failedRide.paymentStatus = 'failed';
                    await failedRide.save();
                    console.log('✅ Ride marked as failed');

                    await Payment.findOneAndUpdate(
                        { paymentId: failedOrderId },
                        { 
                            status: 'failed',
                            metadata: {
                                error: failedPayment.error_description,
                                errorCode: failedPayment.error_code,
                                failedAt: new Date().toISOString()
                            }
                        }
                    );
                }
                break;

            default:
                console.log('ℹ️ Unhandled webhook event:', event);
        }

        res.json({ success: true, received: true });

    } catch (error) {
        console.error('❌ Razorpay webhook error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Webhook processing failed' 
        });
    }
};

// ==================== REFUND PAYMENT ====================
export const refundPayment = async (req, res) => {
    try {
        const { rideId, reason } = req.body;
        const customerId = req.customerId;

        const ride = await Ride.findOne({ 
            rideId, 
            'customer.customerId': customerId,
            paymentStatus: 'completed'
        });

        if (!ride) {
            return res.status(404).json({ 
                success: false, 
                message: 'Ride not found or payment not completed' 
            });
        }

        if (!ride.paymentIntentId) {
            return res.status(400).json({ 
                success: false, 
                message: 'No payment order found for this ride' 
            });
        }

        // Get payment record
        const payment = await Payment.findOne({ paymentId: ride.paymentIntentId });
        if (!payment || !payment.transactionId) {
            return res.status(404).json({ 
                success: false, 
                message: 'Payment details not found' 
            });
        }

        // Create refund in Razorpay
        const refund = await razorpay.payments.refund(payment.transactionId, {
            amount: Math.round(ride.fare.finalAmount * 100), // Full refund
            notes: {
                rideId: ride.rideId,
                reason: reason || 'Ride cancelled'
            }
        });

        console.log('✅ Refund processed:', refund.id);

        // Update payment record
        payment.status = 'refunded';
        payment.refundId = refund.id;
        payment.refundedAt = new Date();
        await payment.save();

        // Update ride status
        ride.paymentStatus = 'refunded';
        await ride.save();

        res.json({
            success: true,
            message: 'Refund processed successfully',
            data: {
                refundId: refund.id,
                amount: refund.amount / 100,
                currency: refund.currency,
                status: refund.status,
                paymentId: payment.transactionId
            }
        });

    } catch (error) {
        console.error('❌ Refund payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process refund'
        });
    }
};