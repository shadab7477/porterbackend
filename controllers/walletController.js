import Stripe from 'stripe';
import WalletTransaction from '../models/WalletTransaction.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 1. Get Wallet Balance and History
export const getWalletBalance = async (req, res) => {
    try {
        const isCustomer = !!req.customerId;
        const userId = isCustomer ? req.customerId : req.driver?.id;
        const userType = isCustomer ? 'Customer' : 'Driver';

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const userModel = isCustomer ? Customer : Driver;

        // Find user to get balance
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Get recent transactions
        const transactions = await WalletTransaction.find({
            userId,
            userType
        }).sort({ createdAt: -1 }).limit(20);

        res.json({
            success: true,
            data: {
                balance: user.walletBalance || 0,
                transactions
            }
        });

    } catch (error) {
        console.error('Get wallet balance error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch wallet info' });
    }
};

// 2. Add Money Intent (Stripe)
export const addMoneyIntent = async (req, res) => {
    try {
        const { amount } = req.body; // Amount in INR
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const isCustomer = !!req.customerId;
        const userId = isCustomer ? req.customerId : req.driver?.id;
        const userType = isCustomer ? 'Customer' : 'Driver';

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'inr',
            metadata: {
                userId: userId.toString(),
                userType,
                type: 'wallet_topup'
            }
        });

        // Create a pending transaction
        const transaction = new WalletTransaction({
            userId,
            userType,
            amount,
            type: 'credit',
            description: 'Wallet Top-up via Stripe',
            transactionId: paymentIntent.id,
            status: 'pending'
        });

        await transaction.save();

        res.json({
            success: true,
            data: {
                clientSecret: paymentIntent.client_secret,
                transactionId: paymentIntent.id
            }
        });

    } catch (error) {
        console.error('Add money intent error:', error);
        res.status(500).json({ success: false, message: 'Failed to create payment intent' });
    }
};

// 3. Confirm Add Money
export const confirmAddMoney = async (req, res) => {
    try {
        const { paymentIntentId } = req.body;

        if (!paymentIntentId) {
            return res.status(400).json({ success: false, message: 'Payment intent ID is required' });
        }

        // Retrieve the payment intent from Stripe to verify status
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({
                success: false,
                message: 'Payment not successful',
                status: paymentIntent.status
            });
        }

        // Find the pending transaction
        const transaction = await WalletTransaction.findOne({
            transactionId: paymentIntentId
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction record not found' });
        }

        if (transaction.status === 'completed') {
            return res.json({ success: true, message: 'Transaction already processed' });
        }

        // Payment is successful, update transaction and wallet balance
        transaction.status = 'completed';
        await transaction.save();

        const userModel = transaction.userType === 'Customer' ? Customer : Driver;

        // Add amount to user's wallet
        await userModel.findByIdAndUpdate(transaction.userId, {
            $inc: { walletBalance: transaction.amount }
        });

        res.json({
            success: true,
            message: 'Wallet balance updated successfully',
            data: {
                amountAdded: transaction.amount,
                newBalance: (await userModel.findById(transaction.userId)).walletBalance
            }
        });

    } catch (error) {
        console.error('Confirm add money error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm transaction' });
    }
};
