import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        // Note: To allow referencing both Customer and Driver, we use a generic ObjectId
        // and store the userType separately.
    },
    userType: {
        type: String,
        enum: ['Customer', 'Driver'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit'], // credit = money added/earned, debit = money spent/withdrawn
        required: true
    },
    transactionCategory: {
        type: String,
        enum: ['commission_due', 'online_order_credit', 'wallet_recharge', 'manual_adjustment', 'withdrawal', 'penalty', 'bonus', 'incentive', 'refund', 'other'],
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
        type: String, // Stripe PaymentIntent ID or other external reference
        sparse: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
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

// Update the updatedAt timestamp on save
walletTransactionSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes for faster queries
walletTransactionSchema.index({ userId: 1, userType: 1 });
walletTransactionSchema.index({ status: 1 });
walletTransactionSchema.index({ createdAt: -1 });

export default mongoose.model('WalletTransaction', walletTransactionSchema);
