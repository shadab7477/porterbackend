import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  paymentId: { type: String, required: true, unique: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryOrder', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['cash', 'card', 'upi', 'wallet'], default: 'cash' },
  status: { type: String, enum: ['pending', 'success', 'failed', 'refunded'], default: 'pending' },
  transactionId: { type: String },
  paidAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

paymentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Payment', paymentSchema);