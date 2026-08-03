import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const bankDetailsSchema = new mongoose.Schema({
  accountHolderName: { type: String, trim: true },
  accountNumber: { type: String, trim: true },
  ifscCode: { type: String, trim: true, uppercase: true },
  bankName: { type: String, trim: true },
  branchName: { type: String, trim: true },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true
  },
  fcmToken: {
    type: String,
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
  walletBalance: {
    type: Number,
    default: 0
  },
  bankDetails: {
    type: bankDetailsSchema,
    default: null
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },

  // Merchant account
  isMerchant: {
    type: Boolean,
    default: false
  },
  merchantDiscount: {
    type: Number,
    default: 5  // percentage
  },
  merchantApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MerchantApplication',
    default: null
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

customerSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

customerSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    {
      id: this._id,
      phone: this.phone,
      role: 'customer'
    },
    process.env.JWT_SECRET
  );
};

export default mongoose.model('Customer', customerSchema);
