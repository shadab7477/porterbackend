import mongoose from 'mongoose';

const driverSchema = new mongoose.Schema({
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
  isActive: {
    type: Boolean,
    default: true
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  documents: {
    license: {
      url: String,
      verified: { type: Boolean, default: false },
      uploadedAt: Date
    },
    idProof: {
      url: String,
      verified: { type: Boolean, default: false },
      uploadedAt: Date
    },
    vehicleRegistration: {
      url: String,
      verified: { type: Boolean, default: false },
      uploadedAt: Date
    },
    insurance: {
      url: String,
      verified: { type: Boolean, default: false },
      uploadedAt: Date
    }
  },
  // Verification fields
  verificationStatus: {
    type: String,
    enum: ['pending', 'under_review', 'verified', 'rejected'],
    default: 'pending'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDocuments: [{
    url: String,
    type: {
      type: String,
      enum: ['license', 'id_proof', 'vehicle_registration', 'insurance']
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  verifiedAt: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  rejectionReason: String,
  submittedAt: {
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

driverSchema.index({ currentLocation: '2dsphere' });
driverSchema.index({ verificationStatus: 1 });

driverSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Driver', driverSchema);