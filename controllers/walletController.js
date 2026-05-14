import Razorpay from 'razorpay';
import crypto from 'crypto';
import WalletTransaction from '../models/WalletTransaction.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import dotenv from 'dotenv';
dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX'
});

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

// 2. Create Razorpay Order for Wallet Top-up
export const createWalletOrder = async (req, res) => {
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

        const amountInPaise = Math.round(amount * 100);

        // Create an Order in Razorpay
        const options = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: `wallet_${userId}_${Date.now()}`.substring(0, 40),
            payment_capture: 1, // Auto-capture
            notes: {
                userId: userId.toString(),
                userType,
                type: 'wallet_topup'
            }
        };

        const order = await razorpay.orders.create(options);

        // Create a pending transaction using the Razorpay Order ID as transactionId
        const transaction = new WalletTransaction({
            userId,
            userType,
            amount,
            type: 'credit',
            description: 'Wallet Top-up via Razorpay',
            transactionId: order.id, // Storing Razorpay Order ID
            status: 'pending'
        });

        await transaction.save();

        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                amountInPaise: amountInPaise,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU'
            }
        });

    } catch (error) {
        console.error('Create wallet order error:', error);
        res.status(500).json({ success: false, message: 'Failed to create payment order' });
    }
};

// 3. Verify Wallet Payment Signature
export const verifyWalletPayment = async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Payment details and signature are required' });
        }

        // Generate signature for verification
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX')
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Payment verification failed - invalid signature' });
        }

        // Find the pending transaction via razorpay_order_id
        const transaction = await WalletTransaction.findOne({
            transactionId: razorpay_order_id
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction record not found' });
        }

        // If already processed (e.g. duplicate webhook / retry), return success with current balance
        if (transaction.status === 'completed') {
            const userModel = transaction.userType === 'Customer' ? Customer : Driver;
            const user = await userModel.findById(transaction.userId);
            return res.json({
                success: true,
                message: 'Transaction already processed',
                data: {
                    amountAdded: transaction.amount,
                    newBalance: user?.walletBalance ?? transaction.newBalance,
                    transactionId: razorpay_payment_id
                }
            });
        }

        const userModel = transaction.userType === 'Customer' ? Customer : Driver;

        // Capture previous balance BEFORE updating wallet
        const userBefore = await userModel.findById(transaction.userId);
        if (!userBefore) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const previousBalance = userBefore.walletBalance || 0;

        // Add amount to user's wallet
        const updatedUser = await userModel.findByIdAndUpdate(
            transaction.userId,
            { $inc: { walletBalance: transaction.amount } },
            { new: true }
        );

        // Mark transaction complete and record ledger details in a SINGLE save
        transaction.status = 'completed';
        transaction.previousBalance = previousBalance;
        transaction.newBalance = updatedUser.walletBalance;
        transaction.transactionCategory = 'wallet_recharge';
        await transaction.save();

        // Check for unblocking driver if balance improves
        if (transaction.userType === 'Driver' && updatedUser.isBlocked && updatedUser.blockReason === 'due_limit_exceeded') {
            const dueLimits = { bike: 300, scooty: 300, auto: 700, mini_3w: 700, e_loader: 700, car: 700, tata_ace: 700, mini_truck: 700, truck: 700 };
            const vType = (updatedUser.vehicleType || 'bike').toLowerCase();
            const limit = dueLimits[vType] || 300;

            if (updatedUser.walletBalance > -limit) {
                updatedUser.isBlocked = false;
                updatedUser.blockReason = null;
                await updatedUser.save();
            }
        }

        res.json({
            success: true,
            message: 'Wallet balance updated successfully',
            data: {
                amountAdded: transaction.amount,
                newBalance: updatedUser.walletBalance,
                transactionId: razorpay_payment_id
            }
        });

    } catch (error) {
        console.error('Verify wallet payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to verify transaction' });
    }
};

// 4. Request Withdrawal (For Drivers)
export const requestWithdrawal = async (req, res) => {
    try {
        const driverId = req.driver?.id;
        const { amount } = req.body;

        if (!driverId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const driver = await Driver.findById(driverId);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        // Check if driver has sufficient positive balance
        if (driver.walletBalance < amount) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Your withdrawable balance is ₹${Math.max(0, driver.walletBalance)}` });
        }

        const previousBalance = driver.walletBalance;
        
        // Deduct from wallet immediately
        driver.walletBalance -= amount;
        await driver.save();

        // Create transaction record
        const transaction = new WalletTransaction({
            userId: driver._id,
            userType: 'Driver',
            amount: -amount,
            type: 'debit',
            transactionCategory: 'withdrawal',
            description: 'Withdrawal request',
            previousBalance: previousBalance,
            newBalance: driver.walletBalance,
            status: 'pending' // pending until admin approves/processes
        });
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: {
                transactionId: transaction._id,
                amountWithdrawn: amount,
                newBalance: driver.walletBalance
            }
        });

    } catch (error) {
        console.error('Request withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Failed to process withdrawal' });
    }
};
