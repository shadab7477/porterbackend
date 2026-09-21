import mongoose from 'mongoose';

const driverWalletTransactionSchema = new mongoose.Schema({
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver',
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
        enum: ['commission_due', 'wallet_recharge', 'manual_adjustment', 'withdrawal', 'penalty', 'bonus', 'incentive', 'refund', 'other'],
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

driverWalletTransactionSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

driverWalletTransactionSchema.index({ driverId: 1 });
driverWalletTransactionSchema.index({ status: 1 });
driverWalletTransactionSchema.index({ createdAt: -1 });

export default mongoose.model('DriverWalletTransaction', driverWalletTransactionSchema);
