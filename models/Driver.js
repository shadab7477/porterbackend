import mongoose from 'mongoose';

const driverSchema = new mongoose.Schema({
  driverId: {
    type: String,
    unique: true,
    sparse: true
  },
  // 4-digit numeric referral invite code (e.g. '4829')
  referralCode: {
    type: String,
    sparse: true,
    index: true,
    trim: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  referralCount: {
    type: Number,
    default: 0
  },
  referralEarnings: {
    type: Number,
    default: 0
  },
  name: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  applicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DriverApplication',
    required: true
  },
  vehicleType: {
    type: String,
    required: [true, 'Vehicle type is required'],
    trim: true
  },
  vehicleNumber: {
    type: String,
    required: [true, 'Vehicle number is required'],
    unique: true,
    trim: true
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  currentLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  socketId: {
    type: String,
    default: null
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  lastOnlineAt: {
    type: Date,
    default: null
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockReason: {
    type: String,
    default: null
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  totalTrips: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  fcmToken: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  subscription: {
    status: {
      type: String,
      enum: ['active', 'pending', 'expired'],
      default: 'active'
    },
    amount: {
      type: Number,
      default: 0
    },
    validUntil: {
      type: Date,
      default: null
    }
  }
});

// Indexes for performance
driverSchema.index({ currentLocation: '2dsphere' });
driverSchema.index({ phone: 1 });
driverSchema.index({ isOnline: 1 });
driverSchema.index({ isAvailable: 1 });

// Update the updatedAt timestamp on save
driverSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const Driver = mongoose.model('Driver', driverSchema);

export default Driver;