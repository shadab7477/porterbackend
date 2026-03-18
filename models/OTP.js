import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
    trim: true
  },
  otp: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // 15 minutes TTL
  },
  isVerified: {
    type: Boolean,
    default: false
  }
});

otpSchema.index({ mobile: 1 });

export default mongoose.model('OTP', otpSchema);
