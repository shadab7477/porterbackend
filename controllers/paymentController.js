import Razorpay from 'razorpay';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import crypto from 'crypto';

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ==================== CREATE PAYMENT ORDER ====================
// Called right after ride is requested (or before driver arrives).
// Returns order details so the mobile app can collect payment via Razorpay SDK.
export const createPaymentOrder = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId } = req.body;
        
        console.log("Creating Razorpay order for ride:", rideId);

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

        // Create order in Razorpay
        const options = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: `receipt_${ride.rideId}`,
            notes: {
                rideId: ride.rideId,
                customerId: customerId.toString(),
                customerPhone: ride.customer.phone || '',
                pickupAddress: ride.pickupLocation.address,
                dropAddress: ride.dropLocation.address
            }
        };

        const order = await razorpay.orders.create(options);

        // Store order ID on the ride, mark as processing
        ride.paymentIntentId = order.id; // Reusing the same field name for Razorpay order ID
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
            transactionId: order.id
        });
        await payment.save();

        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                amountInPaise: amountInPaise,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
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
        console.error('Create Razorpay order error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment order'
        });
    }
};

// ==================== VERIFY PAYMENT ====================
// Called by the mobile app after Razorpay payment is successful on client side.
// Verifies the payment signature and updates the ride record.
export const verifyPayment = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { 
            rideId, 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature 
        } = req.body;

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
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

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
                    paidAt: new Date()
                }
            );

            // Notify driver via socket that payment is done
            const io = req.app.get('io');
            io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                rideId: ride.rideId,
                message: 'Payment confirmed. You can now start the ride.',
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: ride.fare.finalAmount
            });

            return res.json({
                success: true,
                message: 'Payment verified successfully',
                data: {
                    rideId: ride.rideId,
                    paymentStatus: 'completed',
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    amount: ride.fare.finalAmount
                }
            });
        } else {
            // Signature verification failed
            ride.paymentStatus = 'failed';
            await ride.save();

            await Payment.findOneAndUpdate(
                { paymentId: razorpay_order_id },
                { status: 'failed' }
            );

            return res.status(400).json({
                success: false,
                message: 'Payment verification failed - invalid signature'
            });
        }

    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify payment'
        });
    }
};

// ==================== GET PAYMENT STATUS ====================
// Lightweight status check for a ride's payment
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
                paidAt: payment.paidAt
            };
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
                paymentDetails
            }
        });

    } catch (error) {
        console.error('Get payment status error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to get payment status' 
        });
    }
};

// ==================== RAZORPAY WEBHOOK ====================
// Handle Razorpay webhook events for payment status updates
export const handleRazorpayWebhook = async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        
        // Verify webhook signature
        const shasum = crypto.createHmac('sha256', webhookSecret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== req.headers['x-razorpay-signature']) {
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body.event;
        const payload = req.body.payload;

        console.log('Razorpay Webhook Event:', event);

        // Handle different event types
        switch (event) {
            case 'payment.captured':
            case 'payment.authorized':
                const paymentEntity = payload.payment.entity;
                const orderId = paymentEntity.order_id;
                
                // Find ride by paymentIntentId (which stores Razorpay order ID)
                const ride = await Ride.findOne({ paymentIntentId: orderId });
                
                if (ride) {
                    ride.paymentStatus = 'completed';
                    await ride.save();

                    // Update payment record
                    await Payment.findOneAndUpdate(
                        { paymentId: orderId },
                        {
                            status: 'success',
                            transactionId: paymentEntity.id,
                            paidAt: new Date()
                        }
                    );

                    // Notify via socket if needed
                    const io = req.app.get('io');
                    if (io) {
                        io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                            rideId: ride.rideId,
                            message: 'Payment confirmed via webhook',
                            paymentId: paymentEntity.id
                        });
                    }
                }
                break;

            case 'payment.failed':
                const failedPayment = payload.payment.entity;
                const failedOrderId = failedPayment.order_id;
                
                const failedRide = await Ride.findOne({ paymentIntentId: failedOrderId });
                if (failedRide) {
                    failedRide.paymentStatus = 'failed';
                    await failedRide.save();

                    await Payment.findOneAndUpdate(
                        { paymentId: failedOrderId },
                        { status: 'failed' }
                    );
                }
                break;

            default:
                console.log('Unhandled webhook event:', event);
        }

        res.json({ success: true, received: true });

    } catch (error) {
        console.error('Razorpay webhook error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Webhook processing failed' 
        });
    }
};

// ==================== REFUND PAYMENT ====================
// Process refund for cancelled rides
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

        // Update payment record
        payment.status = 'refunded';
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
                status: refund.status
            }
        });

    } catch (error) {
        console.error('Refund payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process refund'
        });
    }
};