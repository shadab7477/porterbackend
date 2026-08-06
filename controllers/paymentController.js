// controllers/paymentController.js
import Razorpay from 'razorpay';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import crypto from 'crypto';
import CustomerWalletTransaction from '../models/CustomerWalletTransaction.js';
import DriverWalletTransaction from '../models/DriverWalletTransaction.js';
import CustomerWallet from '../models/CustomerWallet.js';
import DriverWallet from '../models/DriverWallet.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';

// Initialize Razorpay with your live keys
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX'
});

const getOrCreateCustomerWallet = async (customerId) => {
    let wallet = await CustomerWallet.findOne({ customerId });
    if (!wallet) {
        wallet = await CustomerWallet.create({ customerId, balance: 0 });
    }
    return wallet;
};

const getOrCreateDriverWallet = async (driverId) => {
    let wallet = await DriverWallet.findOne({ driverId });
    if (!wallet) {
        wallet = await DriverWallet.create({ driverId, balance: 0 });
    }
    return wallet;
};
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

// ==================== GET PAYMENT HISTORY ====================
export const getPaymentHistory = async (req, res) => {
    try {
        const customerId = req.customerId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Fetch wallet transactions
        const walletTransactions = await CustomerWalletTransaction.find({ 
            customerId 
        });

        // Fetch ride payments
        const payments = await Payment.find({ customerId })
            .populate('orderId', 'rideId pickupLocation dropLocation');

        // Combine into unified timeline
        const combinedHistory = [
            ...walletTransactions.map(w => ({
                id: w._id,
                type: 'wallet',
                transactionType: w.type, // 'credit' or 'debit'
                amount: w.amount,
                description: w.description,
                status: w.status,
                date: w.createdAt,
                transactionId: w.transactionId
            })),
            ...payments.map(p => ({
                id: p._id,
                type: 'ride',
                method: p.method,
                amount: p.amount,
                status: p.status,
                date: p.createdAt,
                paymentId: p.paymentId,
                transactionId: p.transactionId,
                rideDetails: p.orderId ? {
                    rideId: p.orderId.rideId,
                    pickup: p.orderId.pickupLocation?.address,
                    drop: p.orderId.dropLocation?.address
                } : null
            }))
        ];

        // Sort descending by date
        combinedHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Paginate
        const paginatedHistory = combinedHistory.slice(skip, skip + limit);

        res.json({
            success: true,
            data: paginatedHistory,
            pagination: {
                total: combinedHistory.length,
                page,
                limit,
                pages: Math.ceil(combinedHistory.length / limit)
            }
        });
    } catch (error) {
        console.error('❌ Get payment history error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch payment history'
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
                    
                    let transaction = await CustomerWalletTransaction.findOne({ transactionId: orderId });
                    let isCustomer = true;
                    
                    if (!transaction) {
                        transaction = await DriverWalletTransaction.findOne({ transactionId: orderId });
                        isCustomer = false;
                    }
                    
                    if (transaction && transaction.status === 'pending') {
                        transaction.status = 'completed';
                        await transaction.save();
                        
                        const walletModel = isCustomer ? CustomerWallet : DriverWallet;
                        const walletQuery = isCustomer ? { customerId: transaction.customerId } : { driverId: transaction.driverId };
                        
                        await walletModel.findOneAndUpdate(
                            walletQuery,
                            { $inc: { balance: transaction.amount } }
                        );
                        console.log(`✅ Wallet balance updated for ${isCustomer ? 'Customer' : 'Driver'}`);
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
                    let failedTx = await CustomerWalletTransaction.findOne({ transactionId: failedOrderId });
                    if (!failedTx) {
                        failedTx = await DriverWalletTransaction.findOne({ transactionId: failedOrderId });
                    }

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

// ==================== PAY WITH WALLET ====================
// Called by the CUSTOMER APP right after booking (or when payment_required fires).
// Instantly deducts from customer walletBalance and marks ride as paid.
export const payWithWallet = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId } = req.body;

        if (!rideId) {
            return res.status(400).json({ success: false, message: 'rideId is required' });
        }

        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Only for wallet payment rides
        if (ride.paymentMethod !== 'wallet') {
            return res.status(400).json({
                success: false,
                message: `This ride uses ${ride.paymentMethod} payment, not wallet`
            });
        }

        // Already paid — just confirm
        if (ride.paymentStatus === 'completed') {
            return res.json({
                success: true,
                message: 'Payment already completed',
                data: { rideId: ride.rideId, paymentStatus: 'completed' }
            });
        }

        const amount = ride.fare.finalAmount;

        // Get customer and check balance
        const customer = await Customer.findById(customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        if (customer.walletBalance < amount) {
            return res.status(400).json({
                success: false,
                message: `Insufficient wallet balance. Balance: ₹${customer.walletBalance}, Required: ₹${amount}`,
                walletBalance: customer.walletBalance,
                required: amount
            });
        }

        const previousBalance = customer.walletBalance;

        // Deduct from wallet
        customer.walletBalance -= amount;
        await customer.save();

        // Mark ride as paid
        ride.paymentStatus = 'completed';
        await ride.save();

        // Create ledger entry
        await WalletTransaction.create({
            userId: customerId,
            userType: 'Customer',
            amount: -amount,
            type: 'debit',
            transactionCategory: 'other',
            description: `Ride payment for ${rideId}`,
            previousBalance: previousBalance,
            newBalance: customer.walletBalance,
            orderId: ride._id,
            status: 'completed'
        });

        // Create Payment record for history
        await Payment.create({
            paymentId: `wallet_${rideId}_${Date.now()}`,
            orderId: ride._id,
            customerId,
            amount,
            method: 'wallet',
            status: 'success',
            transactionId: `wallet_${rideId}`,
            paidAt: new Date(),
            metadata: { source: 'wallet', previousBalance, newBalance: customer.walletBalance }
        });

        console.log(`✅ Wallet payment done for ride ${rideId}. Deducted ₹${amount}`);

        // Notify driver via socket — they can now start the ride
        const io = req.app.get('io');
        if (io) {
            io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                rideId: ride.rideId,
                message: 'Customer paid via wallet. You can now start the ride.',
                amount,
                paymentMethod: 'wallet'
            });
        }

        res.json({
            success: true,
            message: `₹${amount} deducted from wallet. Ride payment complete.`,
            data: {
                rideId: ride.rideId,
                paymentStatus: 'completed',
                amountDeducted: amount,
                walletBalance: customer.walletBalance
            }
        });

    } catch (error) {
        console.error('❌ Wallet payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process wallet payment'
        });
    }
};

// ==================== RECEIVER PAYMENT — CREATE ORDER ====================
// Called by the DRIVER APP when they reach the drop location.
// Creates a Razorpay order that the receiver pays via UPI/QR code.
export const createReceiverPaymentOrder = async (req, res) => {
    try {
        const driverId = req.driver?.id;
        const { rideId } = req.body;

        if (!rideId) {
            return res.status(400).json({ success: false, message: 'rideId is required' });
        }

        // Find ride and confirm this driver owns it
        const ride = await Ride.findOne({
            rideId,
            'driver.driverId': driverId,
            status: { $in: ['in_progress', 'driver_arrived'] }
        });

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Active ride not found or you are not the assigned driver'
            });
        }

        // Only for online/UPI payment rides
        if (ride.paymentMethod === 'cash') {
            return res.status(400).json({
                success: false,
                message: 'This is a cash ride. No digital payment required from receiver.'
            });
        }

        // If already paid, no need to create a new order
        if (ride.paymentStatus === 'completed') {
            return res.json({
                success: true,
                message: 'Payment already completed',
                data: { rideId: ride.rideId, paymentStatus: 'completed' }
            });
        }

        const amountInPaise = Math.round(ride.fare.finalAmount * 100);

        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `recv_${ride.rideId}`.substring(0, 40),
            payment_capture: 1,
            notes: {
                rideId: ride.rideId,
                type: 'receiver_payment',
                receiverName: ride.receiver?.name || 'Receiver',
                receiverPhone: ride.receiver?.phone || '',
                dropAddress: ride.dropLocation.address
            }
        });

        console.log('✅ Receiver payment order created:', order.id, 'for ride:', rideId);

        // Store order ID on ride
        ride.paymentIntentId = order.id;
        ride.paymentStatus = 'processing';
        await ride.save();

        // Create a Payment record
        await Payment.create({
            paymentId: order.id,
            orderId: ride._id,
            customerId: ride.customer.customerId,
            amount: ride.fare.finalAmount,
            method: ride.paymentMethod,
            status: 'pending',
            transactionId: order.id,
            metadata: { source: 'receiver_payment', driverId, rideId }
        });

        res.json({
            success: true,
            message: 'Payment order created. Show QR/link to receiver.',
            data: {
                orderId: order.id,
                amount: ride.fare.finalAmount,
                amountInPaise,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
                receiverName: ride.receiver?.name || 'Receiver',
                receiverPhone: ride.receiver?.phone || '',
                rideId: ride.rideId
            }
        });

    } catch (error) {
        console.error('❌ Create receiver payment order error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create receiver payment order'
        });
    }
};

// ==================== RECEIVER PAYMENT — VERIFY ====================
// Called by the DRIVER APP after the receiver has scanned and paid.
// Verifies signature and marks ride payment as completed.
export const verifyReceiverPayment = async (req, res) => {
    try {
        const driverId = req.driver?.id;
        const { rideId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

        if (!rideId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'rideId, payment_id, order_id and signature are all required'
            });
        }

        const ride = await Ride.findOne({
            rideId,
            'driver.driverId': driverId
        });

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Verify Razorpay signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX')
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Payment verification failed — invalid signature'
            });
        }

        // Mark ride payment as completed
        ride.paymentStatus = 'completed';
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
                    source: 'receiver_payment',
                    verifiedAt: new Date().toISOString()
                }
            }
        );

        console.log('✅ Receiver payment verified for ride:', rideId);

        // Notify via socket — driver app can now call /rides/complete
        const io = req.app.get('io');
        if (io) {
            io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                rideId: ride.rideId,
                message: 'Receiver payment confirmed. You can now complete the ride.',
                paymentId: razorpay_payment_id,
                amount: ride.fare.finalAmount,
                paidBy: 'receiver'
            });
        }

        res.json({
            success: true,
            message: 'Receiver payment verified. Ride can now be completed.',
            data: {
                rideId: ride.rideId,
                paymentStatus: 'completed',
                paymentId: razorpay_payment_id,
                amount: ride.fare.finalAmount,
                paidBy: 'receiver'
            }
        });

    } catch (error) {
        console.error('❌ Verify receiver payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify receiver payment'
        });
    }
};