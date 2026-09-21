import mongoose from 'mongoose';

const customerWalletTransactionSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true,
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit'], 
        required: true
    },
    transactionCategory: {
        type: String,
        enum: ['online_order_credit', 'wallet_recharge', 'manual_adjustment', 'withdrawal', 'penalty', 'bonus', 'refund', 'other'],
        default: 'other'
    },
    previousBalance: {
        type: Number,
        default: 0
    },
    newBalance: {
        type: Number,
        default: 0
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ride',
        sparse: true
    },
    description: {
        type: String,
        required: true
    },
    transactionId: {
        type: String, 
        sparse: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    payoutDetails: {
        razorpayContactId: String,
        razorpayFundAccountId: String,
        razorpayPayoutId: String,
        bankAccountLast4: String,
        ifscCode: String,
        accountHolderName: String,
        mode: String,
        purpose: String,
        approvedAt: Date,
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin'
        },
        rejectedAt: Date,
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin'
        },
        rejectionReason: String,
        failureReason: String,
        rawStatus: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

customerWalletTransactionSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

customerWalletTransactionSchema.index({ customerId: 1 });
customerWalletTransactionSchema.index({ status: 1 });
customerWalletTransactionSchema.index({ createdAt: -1 });

export default mongoose.model('CustomerWalletTransaction', customerWalletTransactionSchema);
