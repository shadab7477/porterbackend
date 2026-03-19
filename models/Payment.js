import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  paymentId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  orderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Ride',  // Changed from 'DeliveryOrder' to 'Ride'
    required: true 
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer', 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  method: { 
    type: String, 
    enum: ['cash', 'card', 'upi', 'wallet', 'online'], 
    default: 'cash' 
  },
  status: { 
    type: String, 
    enum: ['pending', 'success', 'failed', 'refunded'], 
    default: 'pending' 
  },
  transactionId: { 
    type: String 
  },
  refundId: {
    type: String
  },
  paidAt: { 
    type: Date 
  },
  refundedAt: {
    type: Date
  },
  metadata: {
    type: Map,
    of: String
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

paymentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for faster queries
paymentSchema.index({ paymentId: 1 });
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ customerId: 1 });
paymentSchema.index({ status: 1 });

export default mongoose.model('Payment', paymentSchema);