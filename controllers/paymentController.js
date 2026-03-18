import Stripe from 'stripe';
import Ride from '../models/Ride.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==================== CREATE PAYMENT INTENT ====================
// Called right after ride is requested (or before driver arrives).
// Returns clientSecret so the mobile app can collect card details via Stripe SDK.
export const createPaymentIntent = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId } = req.body;

        if (!rideId) {
            return res.status(400).json({ success: false, message: 'rideId is required' });
        }

        // Fetch ride and verify it belongs to this customer
        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Only create PaymentIntent for non-cash rides
        if (ride.paymentMethod === 'cash') {
            return res.status(400).json({
                success: false,
                message: 'Cash rides do not require a payment intent'
            });
        }

        // If a PaymentIntent already exists, return the existing one
        if (ride.paymentIntentId) {
            const existingIntent = await stripe.paymentIntents.retrieve(ride.paymentIntentId);
            // If it's still usable return the client secret
            if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existingIntent.status)) {
                return res.json({
                    success: true,
                    data: {
                        clientSecret: existingIntent.client_secret,
                        paymentIntentId: existingIntent.id,
                        amount: existingIntent.amount,
                        currency: existingIntent.currency
                    }
                });
            }
        }

        // Fare in INR paise (Stripe uses smallest currency unit)
        const amountInPaise = Math.round(ride.fare.finalAmount * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInPaise,
            currency: 'inr',
            payment_method_types: ['card'],
            metadata: {
                rideId: ride.rideId,
                customerId: customerId.toString(),
                customerPhone: ride.customer.phone || '',
                pickupAddress: ride.pickupLocation.address,
                dropAddress: ride.dropLocation.address
            },
            description: `Porter Delivery - Ride ${ride.rideId}`
        });

        // Store PaymentIntent ID on the ride, mark as processing
        ride.paymentIntentId = paymentIntent.id;
        ride.paymentStatus = 'processing';
        await ride.save();

        res.json({
            success: true,
            data: {
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id,
                amount: amountInPaise,
                currency: 'inr',
                publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                fareBreakdown: {
                    baseFare: ride.fare.baseFare,
                    distanceFare: ride.fare.distanceFare,
                    timeFare: ride.fare.timeFare,
                    tax: ride.fare.tax,
                    total: ride.fare.total,
                    finalAmount: ride.fare.finalAmount
                }
            }
        });

    } catch (error) {
        console.error('Create PaymentIntent error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment intent'
        });
    }
};

// ==================== CONFIRM PAYMENT ====================
// Called by the mobile app after Stripe confirms payment on client side.
// Verifies the PaymentIntent status with Stripe and updates the ride record.
export const confirmPayment = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { rideId, paymentIntentId } = req.body;

        if (!rideId || !paymentIntentId) {
            return res.status(400).json({ success: false, message: 'rideId and paymentIntentId are required' });
        }

        const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Verify the PaymentIntent belongs to this ride
        if (ride.paymentIntentId && ride.paymentIntentId !== paymentIntentId) {
            return res.status(400).json({ success: false, message: 'Payment intent mismatch' });
        }

        // Retrieve from Stripe to verify status
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status === 'succeeded') {
            // Payment already succeeded
            ride.paymentStatus = 'completed';
            ride.paymentIntentId = paymentIntentId;
            await ride.save();

            // Notify driver via socket that payment is done
            const io = req.app.get('io');
            io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                rideId: ride.rideId,
                message: 'Payment confirmed. You can now start the ride.',
                paymentIntentId,
                amount: paymentIntent.amount / 100
            });

            return res.json({
                success: true,
                message: 'Payment confirmed successfully',
                data: {
                    rideId: ride.rideId,
                    paymentStatus: 'completed',
                    amount: paymentIntent.amount / 100,
                    currency: paymentIntent.currency
                }
            });
        }

        if (paymentIntent.status === 'requires_capture') {
            // Auto-capture the payment
            const captured = await stripe.paymentIntents.capture(paymentIntentId);
            ride.paymentStatus = 'completed';
            ride.paymentIntentId = paymentIntentId;
            await ride.save();

            const io = req.app.get('io');
            io.emit(`ride:${ride.rideId}:payment_confirmed`, {
                rideId: ride.rideId,
                message: 'Payment captured. You can now start the ride.',
                paymentIntentId,
                amount: captured.amount / 100
            });

            return res.json({
                success: true,
                message: 'Payment captured successfully',
                data: {
                    rideId: ride.rideId,
                    paymentStatus: 'completed',
                    amount: captured.amount / 100,
                    currency: captured.currency
                }
            });
        }

        // Payment not yet succeeded
        return res.status(400).json({
            success: false,
            message: `Payment not completed. Current Stripe status: ${paymentIntent.status}`,
            stripeStatus: paymentIntent.status
        });

    } catch (error) {
        console.error('Confirm payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to confirm payment'
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

        let stripeStatus = null;
        if (ride.paymentIntentId) {
            try {
                const pi = await stripe.paymentIntents.retrieve(ride.paymentIntentId);
                stripeStatus = pi.status;
            } catch (e) {
                // Stripe lookup failed, use stored status
            }
        }

        res.json({
            success: true,
            data: {
                rideId: ride.rideId,
                paymentMethod: ride.paymentMethod,
                paymentStatus: ride.paymentStatus,
                paymentIntentId: ride.paymentIntentId,
                stripeStatus,
                amount: ride.fare.finalAmount
            }
        });

    } catch (error) {
        console.error('Get payment status error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to get payment status' });
    }
};
