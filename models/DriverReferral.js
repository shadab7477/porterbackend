import mongoose from 'mongoose';

const driverReferralSchema = new mongoose.Schema({
  referrerDriverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
    index: true
  },
  referrerPhone: {
    type: String,
    trim: true
  },
  refereeApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DriverApplication',
    required: true,
    index: true
  },
  refereeDriverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null,
    sparse: true
  },
  refereeName: {
    type: String,
    trim: true
  },
  refereePhone: {
    type: String,
    trim: true
  },
  referralCode: {
    type: String,
    required: true,
    trim: true
  },
  rewardAmount: {
    type: Number,
    default: 99
  },
  rewardType: {
    type: String,
    enum: ['commission_credit'],
    default: 'commission_credit'
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'cancelled'],
    default: 'completed'
  },
  awardedAt: {
    type: Date,
    default: Date.now
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

driverReferralSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const DriverReferral = mongoose.model('DriverReferral', driverReferralSchema);

export default DriverReferral;

