import mongoose from 'mongoose';

const bankDetailsSnapshot = new mongoose.Schema({
  accountHolderName: { type: String, trim: true },
  accountNumber:     { type: String, trim: true },
  ifscCode:          { type: String, trim: true, uppercase: true },
  bankName:          { type: String, trim: true },
  branchName:        { type: String, trim: true }
}, { _id: false });

const customerWithdrawalRequestSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  customerPhone: { type: String },
  customerName:  { type: String },

  // Amount requested — minimum ₹500
  amount: {
    type: Number,
    required: true,
    min: [500, 'Minimum withdrawal amount is ₹500']
  },

  // Snapshot of bank details at time of request
  bankDetails: {
    type: bankDetailsSnapshot,
    required: true
  },

  // Lifecycle status
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },

  // Wallet transaction ID (the debit created when request was placed)
  walletTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerWalletTransaction',
    default: null
  },

  // Wallet balance snapshot at time of request
  walletBalanceAtRequest: { type: Number, default: 0 },

  // Admin fields
  reviewedAt: { type: Date },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  adminNote:        { type: String },            // Admin internal note
  rejectionReason:  { type: String },            // Shown to customer on rejection

  // Payment proof when admin marks as paid
  transactionRef:   { type: String },            // UTR / NEFT ref / screenshot note
  paidAt:           { type: Date },

  // Refund tracking (for rejected/cancelled requests)
  refundedAt:       { type: Date },
  refundTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerWalletTransaction',
    default: null
  }
}, { timestamps: true });

// Compound indexes
customerWithdrawalRequestSchema.index({ customerId: 1, status: 1 });
customerWithdrawalRequestSchema.index({ createdAt: -1 });
customerWithdrawalRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('CustomerWithdrawalRequest', customerWithdrawalRequestSchema);
