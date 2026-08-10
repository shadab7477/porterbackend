import Razorpay from 'razorpay';
import axios from 'axios';
import crypto from 'crypto';
import CustomerWalletTransaction from '../models/CustomerWalletTransaction.js';
import DriverWalletTransaction from '../models/DriverWalletTransaction.js';
import CustomerWallet from '../models/CustomerWallet.js';
import DriverWallet from '../models/DriverWallet.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';
import MerchantApplication from '../models/MerchantApplication.js';
import dotenv from 'dotenv';
dotenv.config();

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

const hasCompleteBankDetails = (bankDetails) => (
    !!bankDetails?.accountHolderName &&
    !!bankDetails?.accountNumber &&
    !!bankDetails?.ifscCode
);

const maskAccountNumber = (accountNumber) => {
    if (!accountNumber) return null;
    const value = String(accountNumber);
    return `****${value.slice(-4)}`;
};

const getDriverBankDetails = async (driver) => {
    const application = await DriverApplication.findById(driver.applicationId).select('bankDetails');
    return application?.bankDetails || null;
};

const getWithdrawalUserAndBank = async (transaction, isCustomerTransaction) => {
    if (isCustomerTransaction) {
        const customer = await Customer.findById(transaction.customerId);
        return { user: customer, bankDetails: customer?.bankDetails || null };
    }

    const driver = await Driver.findById(transaction.driverId);
    const bankDetails = driver ? await getDriverBankDetails(driver) : null;
    return { user: driver, bankDetails };
};

const createRazorpayXPayout = async ({ transaction, user, bankDetails, mode = 'IMPS', purpose = 'payout' }) => {
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX';
    const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_ACCOUNT_NUMBER;

    if (!accountNumber) {
        throw new Error('RAZORPAYX_ACCOUNT_NUMBER is not configured');
    }
// hey
    const auth = { username: keyId, password: keySecret };
    const contactPayload = {
        name: user.name || bankDetails.accountHolderName,
        email: user.email || undefined,
        contact: user.phone || undefined,
        type: isCustomerTransaction ? 'customer' : 'vendor',
        reference_id: `${isCustomerTransaction ? 'Customer' : 'Driver'}_${user._id}`,
        notes: {
            userId: String(user._id),
            userType: isCustomerTransaction ? 'Customer' : 'Driver'
        }
    };

    const contactRes = await axios.post('https://api.razorpay.com/v1/contacts', contactPayload, { auth });
    const fundAccountRes = await axios.post('https://api.razorpay.com/v1/fund_accounts', {
        contact_id: contactRes.data.id,
        account_type: 'bank_account',
        bank_account: {
            name: bankDetails.accountHolderName,
            ifsc: String(bankDetails.ifscCode).toUpperCase(),
            account_number: String(bankDetails.accountNumber)
        }
    }, { auth });

    const payoutRes = await axios.post('https://api.razorpay.com/v1/payouts', {
        account_number: accountNumber,
        fund_account_id: fundAccountRes.data.id,
        amount: Math.round(Math.abs(transaction.amount) * 100),
        currency: 'INR',
        mode,
        purpose,
        reference_id: String(transaction._id),
        narration: 'GoDelivo withdrawal',
        notes: {
            userId: String(user._id),
            userType: isCustomerTransaction ? 'Customer' : 'Driver',
            transactionId: String(transaction._id)
        }
    }, {
        auth,
        headers: {
            'X-Payout-Idempotency': String(transaction._id)
        }
    });

    return {
        contact: contactRes.data,
        fundAccount: fundAccountRes.data,
        payout: payoutRes.data
    };
};

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

        const TransactionModel = isCustomer ? CustomerWalletTransaction : DriverWalletTransaction;

        // Find user to get balance
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const wallet = isCustomer 
            ? await getOrCreateCustomerWallet(userId)
            : await getOrCreateDriverWallet(userId);

        // Get recent transactions
        const transactions = await TransactionModel.find(
            isCustomer ? { customerId: userId } : { driverId: userId }
        ).sort({ createdAt: -1 }).limit(20);

        res.json({
            success: true,
            data: {
                balance: wallet.balance,
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

        const TransactionModel = isCustomer ? CustomerWalletTransaction : DriverWalletTransaction;

        // Create a pending transaction using the Razorpay Order ID as transactionId
        const transaction = new TransactionModel({
            [isCustomer ? 'customerId' : 'driverId']: userId,
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
        let transaction = await CustomerWalletTransaction.findOne({
            transactionId: razorpay_order_id
        });
        let isCustomerTransaction = true;

        if (!transaction) {
            transaction = await DriverWalletTransaction.findOne({
                transactionId: razorpay_order_id
            });
            isCustomerTransaction = false;
        }

        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction record not found' });
        }

        const walletModel = isCustomerTransaction ? CustomerWallet : DriverWallet;
        const walletIdField = isCustomerTransaction ? { customerId: transaction.customerId } : { driverId: transaction.driverId };

        // If already processed (e.g. duplicate webhook / retry), return success with current balance
        if (transaction.status === 'completed') {
            const wallet = await walletModel.findOne(walletIdField);
            return res.json({
                success: true,
                message: 'Transaction already processed',
                data: {
                    amountAdded: transaction.amount,
                    newBalance: wallet?.balance ?? transaction.newBalance,
                    transactionId: razorpay_payment_id
                }
            });
        }

        // Capture previous balance BEFORE updating wallet
        const walletBefore = await walletModel.findOne(walletIdField);
        if (!walletBefore) {
            return res.status(404).json({ success: false, message: 'Wallet not found' });
        }
        const previousBalance = walletBefore.balance || 0;

        // Add amount to user's wallet
        const updatedWallet = await walletModel.findOneAndUpdate(
            walletIdField,
            { $inc: { balance: transaction.amount } },
            { new: true }
        );

        // Mark transaction complete and record ledger details in a SINGLE save
        transaction.status = 'completed';
        transaction.previousBalance = previousBalance;
        transaction.newBalance = updatedWallet.balance;
        transaction.transactionCategory = 'wallet_recharge';
        await transaction.save();

        // Check for unblocking driver if balance improves
        if (!isCustomerTransaction) {
            const driverId = transaction.driverId;
            const updatedUser = await Driver.findById(driverId);
            if (updatedUser && updatedUser.isBlocked && updatedUser.blockReason === 'due_limit_exceeded') {
                const dueLimits = { bike: 300, scooty: 300, auto: 700, mini_3w: 700, e_loader: 700, car: 700, tata_ace: 700, mini_truck: 700, truck: 700 };
                const vType = (updatedUser.vehicleType || 'bike').toLowerCase();
                const limit = dueLimits[vType] || 300;

                if (updatedWallet.balance > -limit) {
                    updatedUser.isBlocked = false;
                    updatedUser.blockReason = null;
                    await updatedUser.save();
                }
            }
        }

        res.json({
            success: true,
            message: 'Wallet balance updated successfully',
            data: {
                amountAdded: transaction.amount,
                newBalance: updatedWallet.balance,
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

        const bankDetails = await getDriverBankDetails(driver);
        if (!hasCompleteBankDetails(bankDetails)) {
            return res.status(400).json({ success: false, message: 'Complete verified bank details are required before withdrawal' });
        }

        if (bankDetails.verification?.status && bankDetails.verification.status !== 'verified') {
            return res.status(400).json({ success: false, message: 'Bank details must be verified before withdrawal' });
        }

        const wallet = await getOrCreateDriverWallet(driverId);

        // Check if driver has sufficient positive balance
        if (wallet.balance < amount) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Your withdrawable balance is ₹${Math.max(0, wallet.balance)}` });
        }

        const previousBalance = wallet.balance;
        
        // Deduct from wallet immediately
        wallet.balance -= amount;
        await wallet.save();

        // Create transaction record
        const transaction = new DriverWalletTransaction({
            driverId: driver._id,
            amount: -amount,
            type: 'debit',
            transactionCategory: 'withdrawal',
            description: 'Withdrawal request',
            previousBalance: previousBalance,
            newBalance: wallet.balance,
            status: 'pending' // pending until admin approves/processes
        });
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: {
                transactionId: transaction._id,
                amountWithdrawn: amount,
                newBalance: wallet.balance
            }
        });

    } catch (error) {
        console.error('Request withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Failed to process withdrawal' });
    }
};

// 5. Request Withdrawal (For Customers)
export const requestCustomerWithdrawal = async (req, res) => {
    try {
        const customerId = req.customerId;
        const { amount } = req.body;

        if (!customerId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const customer = await Customer.findById(customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        if (!hasCompleteBankDetails(customer.bankDetails)) {
            return res.status(400).json({ success: false, message: 'Complete bank details are required before withdrawal' });
        }

        const wallet = await getOrCreateCustomerWallet(customerId);

        // Check if customer has sufficient positive balance
        if (wallet.balance < amount) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Your withdrawable balance is ₹${Math.max(0, wallet.balance)}` });
        }

        const previousBalance = wallet.balance;
        
        // Deduct from wallet immediately
        wallet.balance -= amount;
        await wallet.save();

        // Create transaction record
        const transaction = new CustomerWalletTransaction({
            customerId: customer._id,
            amount: -amount,
            type: 'debit',
            transactionCategory: 'withdrawal',
            description: 'Withdrawal request',
            previousBalance: previousBalance,
            newBalance: wallet.balance,
            status: 'pending' // pending until admin approves/processes
        });
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: {
                transactionId: transaction._id,
                amountWithdrawn: amount,
                newBalance: wallet.balance
            }
        });

    } catch (error) {
        console.error('Request customer withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Failed to process withdrawal' });
    }
};

export const getCustomerBankDetails = async (req, res) => {
    try {
        const customer = await Customer.findById(req.customerId).select('bankDetails');
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const bankDetails = customer.bankDetails ? {
            accountHolderName: customer.bankDetails.accountHolderName,
            accountNumber: maskAccountNumber(customer.bankDetails.accountNumber),
            rawAccountNumber: customer.bankDetails.accountNumber,
            ifscCode: customer.bankDetails.ifscCode,
            bankName: customer.bankDetails.bankName,
            branchName: customer.bankDetails.branchName,
            updatedAt: customer.bankDetails.updatedAt
        } : null;

        res.json({ success: true, data: bankDetails });
    } catch (error) {
        console.error('Get customer bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bank details' });
    }
};

export const updateCustomerBankDetails = async (req, res) => {
    try {
        const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = req.body;

        if (!accountHolderName || !accountNumber || !ifscCode) {
            return res.status(400).json({ success: false, message: 'Account holder name, account number and IFSC code are required' });
        }

        const customer = await Customer.findById(req.customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const bankDetails = {
            accountHolderName: String(accountHolderName).trim(),
            accountNumber: String(accountNumber).trim(),
            ifscCode: String(ifscCode).trim().toUpperCase(),
            bankName: bankName ? String(bankName).trim() : undefined,
            branchName: branchName ? String(branchName).trim() : undefined,
            updatedAt: new Date()
        };

        customer.bankDetails = bankDetails;
        await customer.save();

        // Also sync to MerchantApplication if customer has a merchant application
        if (customer.merchantApplicationId) {
            await MerchantApplication.findByIdAndUpdate(customer.merchantApplicationId, { bankDetails });
        } else {
            await MerchantApplication.findOneAndUpdate({ customerId: customer._id }, { bankDetails });
        }

        res.json({
            success: true,
            message: 'Bank details updated successfully',
            data: {
                accountHolderName: customer.bankDetails.accountHolderName,
                accountNumber: maskAccountNumber(customer.bankDetails.accountNumber),
                rawAccountNumber: customer.bankDetails.accountNumber,
                ifscCode: customer.bankDetails.ifscCode,
                bankName: customer.bankDetails.bankName,
                branchName: customer.bankDetails.branchName,
                updatedAt: customer.bankDetails.updatedAt
            }
        });
    } catch (error) {
        console.error('Update customer bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to update bank details' });
    }
};

export const deleteCustomerBankDetails = async (req, res) => {
    try {
        const customer = await Customer.findById(req.customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        customer.bankDetails = null;
        await customer.save();

        if (customer.merchantApplicationId) {
            await MerchantApplication.findByIdAndUpdate(customer.merchantApplicationId, { $unset: { bankDetails: 1 } });
        } else {
            await MerchantApplication.findOneAndUpdate({ customerId: customer._id }, { $unset: { bankDetails: 1 } });
        }

        res.json({
            success: true,
            message: 'Bank details deleted successfully'
        });
    } catch (error) {
        console.error('Delete customer bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete bank details' });
    }
};

export const getAdminWithdrawals = async (req, res) => {
    try {
        const { status = 'pending', page = 1, limit = 20 } = req.query;
        const query = { transactionCategory: 'withdrawal' };
        if (status && status !== 'all') query.status = status;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;

        const [customerTransactions, driverTransactions, customerTotal, driverTotal] = await Promise.all([
            CustomerWalletTransaction.find(query).sort({ createdAt: -1 }).limit(pageNum * limitNum).lean(),
            DriverWalletTransaction.find(query).sort({ createdAt: -1 }).limit(pageNum * limitNum).lean(),
            CustomerWalletTransaction.countDocuments(query),
            DriverWalletTransaction.countDocuments(query)
        ]);

        const total = customerTotal + driverTotal;
        const allTransactions = [
            ...customerTransactions.map(t => ({ ...t, isCustomerTransaction: true })),
            ...driverTransactions.map(t => ({ ...t, isCustomerTransaction: false }))
        ].sort((a, b) => b.createdAt - a.createdAt);

        const transactions = allTransactions.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        const data = await Promise.all(transactions.map(async (transaction) => {
            const { user, bankDetails } = await getWithdrawalUserAndBank(transaction, transaction.isCustomerTransaction);
            return {
                ...transaction,
                userType: transaction.isCustomerTransaction ? 'Customer' : 'Driver',
                requestedAmount: Math.abs(transaction.amount),
                user: user ? {
                    id: user._id,
                    name: user.name,
                    phone: user.phone,
                    email: user.email,
                    walletBalance: user.walletBalance
                } : null,
                bankDetails: bankDetails ? {
                    accountHolderName: bankDetails.accountHolderName,
                    accountNumber: maskAccountNumber(bankDetails.accountNumber),
                    ifscCode: bankDetails.ifscCode,
                    bankName: bankDetails.bankName,
                    branchName: bankDetails.branchName,
                    verificationStatus: bankDetails.verification?.status
                } : null
            };
        }));

        res.json({
            success: true,
            data,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get admin withdrawals error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
    }
};

export const approveWithdrawal = async (req, res) => {
    try {
        const { id } = req.params;
        const { mode = 'IMPS', purpose = 'payout' } = req.body;

        let transaction = await CustomerWalletTransaction.findOneAndUpdate(
            { _id: id, transactionCategory: 'withdrawal', status: 'pending' },
            {
                $set: {
                    status: 'processing',
                    'payoutDetails.approvedAt': new Date(),
                    'payoutDetails.approvedBy': req.adminId
                }
            },
            { new: true }
        );
        let isCustomerTransaction = true;

        if (!transaction) {
            transaction = await DriverWalletTransaction.findOneAndUpdate(
                { _id: id, transactionCategory: 'withdrawal', status: 'pending' },
                {
                    $set: {
                        status: 'processing',
                        'payoutDetails.approvedAt': new Date(),
                        'payoutDetails.approvedBy': req.adminId
                    }
                },
                { new: true }
            );
            isCustomerTransaction = false;
        }

        if (!transaction) {
            const existingCustomer = await CustomerWalletTransaction.findOne({ _id: id, transactionCategory: 'withdrawal' }).select('status');
            const existingDriver = await DriverWalletTransaction.findOne({ _id: id, transactionCategory: 'withdrawal' }).select('status');
            const existing = existingCustomer || existingDriver;
            
            return res.status(existing ? 400 : 404).json({
                success: false,
                message: existing ? `Withdrawal is already ${existing.status}` : 'Withdrawal request not found'
            });
        }

        const { user, bankDetails } = await getWithdrawalUserAndBank(transaction, isCustomerTransaction);
        if (!user) {
            transaction.status = 'pending';
            transaction.payoutDetails.failureReason = `${isCustomerTransaction ? 'Customer' : 'Driver'} not found`;
            await transaction.save();
            return res.status(404).json({ success: false, message: `${isCustomerTransaction ? 'Customer' : 'Driver'} not found` });
        }

        if (!hasCompleteBankDetails(bankDetails)) {
            transaction.status = 'pending';
            transaction.payoutDetails.failureReason = 'Complete bank details are required before payout';
            await transaction.save();
            return res.status(400).json({ success: false, message: 'Complete bank details are required before payout' });
        }

        const payoutData = await createRazorpayXPayout({ transaction, user, bankDetails, mode, purpose });

        transaction.status = 'completed';
        transaction.transactionId = payoutData.payout.id;
        transaction.payoutDetails = {
            razorpayContactId: payoutData.contact.id,
            razorpayFundAccountId: payoutData.fundAccount.id,
            razorpayPayoutId: payoutData.payout.id,
            bankAccountLast4: String(bankDetails.accountNumber).slice(-4),
            ifscCode: String(bankDetails.ifscCode).toUpperCase(),
            accountHolderName: bankDetails.accountHolderName,
            mode,
            purpose,
            approvedAt: transaction.payoutDetails.approvedAt || new Date(),
            approvedBy: req.adminId,
            rawStatus: payoutData.payout.status
        };
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal approved and Razorpay payout created',
            data: {
                transaction,
                payout: {
                    id: payoutData.payout.id,
                    status: payoutData.payout.status,
                    amount: payoutData.payout.amount / 100
                }
            }
        });
    } catch (error) {
        console.error('Approve withdrawal error:', error.response?.data || error.message);
            if (req.params?.id) {
                const revertData = {
                    $set: {
                        status: 'pending',
                        'payoutDetails.failureReason': error.response?.data?.error?.description || error.message
                    }
                };
                let reverted = await CustomerWalletTransaction.findOneAndUpdate(
                    { _id: req.params.id, transactionCategory: 'withdrawal', status: 'processing' },
                    revertData
                );
                if (!reverted) {
                    await DriverWalletTransaction.findOneAndUpdate(
                        { _id: req.params.id, transactionCategory: 'withdrawal', status: 'processing' },
                        revertData
                    );
                }
            }
        res.status(500).json({
            success: false,
            message: error.response?.data?.error?.description || error.message || 'Failed to approve withdrawal'
        });
    }
};

export const rejectWithdrawal = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason = 'Rejected by admin' } = req.body;

        let transaction = await CustomerWalletTransaction.findOne({ _id: id, transactionCategory: 'withdrawal' });
        let isCustomerTransaction = true;
        
        if (!transaction) {
            transaction = await DriverWalletTransaction.findOne({ _id: id, transactionCategory: 'withdrawal' });
            isCustomerTransaction = false;
        }

        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Withdrawal is already ${transaction.status}` });
        }

        const walletModel = isCustomerTransaction ? CustomerWallet : DriverWallet;
        const walletIdField = isCustomerTransaction ? { customerId: transaction.customerId } : { driverId: transaction.driverId };
        
        const wallet = await walletModel.findOne(walletIdField);
        if (!wallet) {
            return res.status(404).json({ success: false, message: `Wallet not found` });
        }

        wallet.balance += Math.abs(transaction.amount);
        await wallet.save();

        transaction.status = 'failed';
        transaction.newBalance = wallet.balance;
        transaction.payoutDetails = transaction.payoutDetails || {};
        transaction.payoutDetails.rejectedAt = new Date();
        transaction.payoutDetails.rejectedBy = req.adminId;
        transaction.payoutDetails.rejectionReason = reason;
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal rejected and amount returned to wallet',
            data: {
                transaction,
                newBalance: wallet.balance
            }
        });
    } catch (error) {
        console.error('Reject withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Failed to reject withdrawal' });
    }
};
