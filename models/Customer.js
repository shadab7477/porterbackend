import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
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

customerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

customerSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      id: this._id, 
      phone: this.phone,
      role: 'customer'
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

export default mongoose.model('Customer', customerSchema);