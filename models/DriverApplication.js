import mongoose from 'mongoose';

const documentVerificationSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verifiedAt: Date,
  rejectionReason: String,
  comments: String,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, { _id: false });

const documentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

// Updated Aadhar Card Schema with front and back images
const aadharDocumentSchema = new mongoose.Schema({
  front: {
    type: documentSchema,
    default: null
  },
  back: {
    type: documentSchema,
    default: null
  },
  aadharNumber: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

const drivingLicenseDocumentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  licenseNumber: String,
  expiryDate: Date,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

const vehicleRCDocumentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  rcNumber: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

const bankDetailsSchema = new mongoose.Schema({
  accountHolderName: String,
  accountNumber: String,
  ifscCode: String,
  bankName: String,
  branchName: String,
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

const driverApplicationSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
    },
    fcmToken: {
      type: String,
    },
    email: {
      type: String,
    },
    fullName: {
      type: String,
      required: true,
    },
    dateOfBirth: {
      type: Date,
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
    },
    
    // Profile Photo
    profilePhoto: {
      type: documentSchema,
      default: null
    },

    // Aadhar Card with front and back images
    aadharCard: {
      type: aadharDocumentSchema,
      default: null
    },

    // PAN Card
    panCard: {
      type: documentSchema,
      default: null
    },

    // Driving License
    drivingLicense: {
      type: drivingLicenseDocumentSchema,
      default: null
    },

    // Vehicle RC
    vehicleRC: {
      type: vehicleRCDocumentSchema,
      default: null
    },

    // Vehicle Photo
    vehiclePhoto: {
      type: documentSchema,
      default: null
    },

    vehicleType: {
      type: String,
    },
    vehicleNumber: {
      type: String,
    },
    vehicleModel: {
      type: String,
    },
    vehicleYear: {
      type: Number,
    },
    vehicleColor: {
      type: String,
    },

    bankDetails: {
      type: bankDetailsSchema,
      default: null
    },

    // Overall application status
    verificationStatus: {
      type: String,
      enum: ['pending', 'submitted', 'under_review', 'partially_verified', 'verified', 'rejected', 'withdrawn'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
    },
    submittedAt: {
      type: Date,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  { timestamps: true }
);

// Indexes for performance
driverApplicationSchema.index({ phone: 1 });
driverApplicationSchema.index({ verificationStatus: 1 });
driverApplicationSchema.index({ submittedAt: -1 });
driverApplicationSchema.index({ 'aadharCard.aadharNumber': 1 });
driverApplicationSchema.index({ 'drivingLicense.licenseNumber': 1 });
driverApplicationSchema.index({ 'vehicleRC.rcNumber': 1 });

// Pre-save middleware to validate document statuses
driverApplicationSchema.pre('save', function(next) {
  const documentTypes = [
    'profilePhoto', 
    'aadharCard', 
    'panCard', 
    'drivingLicense', 
    'vehicleRC', 
    'vehiclePhoto'
  ];
  
  for (const docType of documentTypes) {
    if (this[docType]) {
      // For aadharCard which has nested structure
      if (docType === 'aadharCard') {
        if (this[docType].front && this[docType].front.verification) {
          if (!['pending', 'verified', 'rejected'].includes(this[docType].front.verification.status)) {
            this[docType].front.verification.status = 'pending';
          }
        }
        if (this[docType].back && this[docType].back.verification) {
          if (!['pending', 'verified', 'rejected'].includes(this[docType].back.verification.status)) {
            this[docType].back.verification.status = 'pending';
          }
        }
        if (this[docType].verification) {
          if (!['pending', 'verified', 'rejected'].includes(this[docType].verification.status)) {
            this[docType].verification.status = 'pending';
          }
        }
      } else {
        // For regular documents
        if (this[docType].verification) {
          if (!['pending', 'verified', 'rejected'].includes(this[docType].verification.status)) {
            this[docType].verification.status = 'pending';
          }
        }
      }
    }
  }
  
  // Validate bank verification if exists
  if (this.bankDetails && this.bankDetails.verification) {
    if (!['pending', 'verified', 'rejected'].includes(this.bankDetails.verification.status)) {
      this.bankDetails.verification.status = 'pending';
    }
  }
  
  next();
});

// Method to calculate overall verification status
driverApplicationSchema.methods.calculateOverallStatus = function() {
  // Check profile photo
  const profilePhotoVerified = !this.profilePhoto || 
    (this.profilePhoto.verification?.status === 'verified');
  
  // Check aadhar card (both front and back)
  const aadharFrontVerified = !this.aadharCard?.front || 
    (this.aadharCard.front.verification?.status === 'verified');
  const aadharBackVerified = !this.aadharCard?.back || 
    (this.aadharCard.back.verification?.status === 'verified');
  const aadharVerified = aadharFrontVerified && aadharBackVerified;
  
  // Check pan card
  const panVerified = !this.panCard || 
    (this.panCard.verification?.status === 'verified');
  
  // Check driving license
  const licenseVerified = !this.drivingLicense || 
    (this.drivingLicense.verification?.status === 'verified');
  
  // Check vehicle RC
  const rcVerified = !this.vehicleRC || 
    (this.vehicleRC.verification?.status === 'verified');
  
  // Check vehicle photo
  const vehiclePhotoVerified = !this.vehiclePhoto || 
    (this.vehiclePhoto.verification?.status === 'verified');
  
  // Check bank details
  const bankVerified = !this.bankDetails || 
    (this.bankDetails.verification?.status === 'verified');

  // Check for any rejections
  const anyRejected = 
    (this.profilePhoto?.verification?.status === 'rejected') ||
    (this.aadharCard?.front?.verification?.status === 'rejected') ||
    (this.aadharCard?.back?.verification?.status === 'rejected') ||
    (this.panCard?.verification?.status === 'rejected') ||
    (this.drivingLicense?.verification?.status === 'rejected') ||
    (this.vehicleRC?.verification?.status === 'rejected') ||
    (this.vehiclePhoto?.verification?.status === 'rejected') ||
    (this.bankDetails?.verification?.status === 'rejected');

  // Check for any pending verifications
  const anyPending = 
    (this.profilePhoto?.verification?.status === 'pending') ||
    (this.aadharCard?.front?.verification?.status === 'pending') ||
    (this.aadharCard?.back?.verification?.status === 'pending') ||
    (this.panCard?.verification?.status === 'pending') ||
    (this.drivingLicense?.verification?.status === 'pending') ||
    (this.vehicleRC?.verification?.status === 'pending') ||
    (this.vehiclePhoto?.verification?.status === 'pending') ||
    (this.bankDetails?.verification?.status === 'pending');

  // Check if all documents are verified
  const allVerified = profilePhotoVerified && aadharVerified && panVerified && 
                      licenseVerified && rcVerified && vehiclePhotoVerified && bankVerified;

  if (anyRejected) return 'partially_verified';
  if (anyPending) return 'under_review';
  if (allVerified) return 'verified';
  
  return this.verificationStatus;
};

const DriverApplication = mongoose.model('DriverApplication', driverApplicationSchema);

export default DriverApplication;