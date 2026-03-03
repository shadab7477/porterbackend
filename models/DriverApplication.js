import mongoose from 'mongoose';

const documentVerificationSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verifiedAt: Date,
  rejectionReason: String,
  comments: String
}, { _id: false });

const documentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({})
  }
}, { _id: false });

// Aadhar Card Schema with number field
const aadharDocumentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  aadharNumber: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({})
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
    default: () => ({})
  }
}, { _id: false });

const vehicleRCDocumentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  rcNumber: String,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({})
  }
}, { _id: false });

const vehicleInsuranceDocumentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  policyNumber: String,
  expiryDate: Date,
  uploadedAt: Date,
  verification: {
    type: documentVerificationSchema,
    default: () => ({})
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

    // Aadhar Card (updated with aadharNumber)
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

    // Vehicle Insurance
    vehicleInsurance: {
      type: vehicleInsuranceDocumentSchema,
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
      accountHolderName: String,
      accountNumber: String,
      ifscCode: String,
      bankName: String,
      branchName: String,
      verification: {
        type: documentVerificationSchema,
        default: () => ({})
      }
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
  const documentTypes = ['profilePhoto', 'aadharCard', 'panCard', 'drivingLicense', 'vehicleRC', 'vehicleInsurance', 'vehiclePhoto'];
  
  for (const docType of documentTypes) {
    if (this[docType] && this[docType].verification) {
      // Ensure verification status is valid
      if (!['pending', 'verified', 'rejected'].includes(this[docType].verification.status)) {
        this[docType].verification.status = 'pending';
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
  const documents = [
    this.profilePhoto,
    this.aadharCard,
    this.panCard,
    this.drivingLicense,
    this.vehicleRC,
    this.vehicleInsurance,
    this.vehiclePhoto
  ].filter(doc => doc !== null && doc.url);

  if (documents.length === 0) return 'pending';

  const allVerified = documents.every(doc => doc.verification?.status === 'verified') && 
                     (!this.bankDetails?.accountNumber || this.bankDetails?.verification?.status === 'verified');
  const anyRejected = documents.some(doc => doc.verification?.status === 'rejected') ||
                      (this.bankDetails?.accountNumber && this.bankDetails?.verification?.status === 'rejected');
  const allRejected = documents.every(doc => doc.verification?.status === 'rejected') &&
                      (!this.bankDetails?.accountNumber || this.bankDetails?.verification?.status === 'rejected');
  const anyPending = documents.some(doc => !doc.verification?.status || doc.verification?.status === 'pending') ||
                     (this.bankDetails?.accountNumber && (!this.bankDetails?.verification?.status || this.bankDetails?.verification?.status === 'pending'));

  if (allRejected) return 'rejected';
  if (allVerified) return 'verified';
  if (anyRejected) return 'partially_verified';
  if (anyPending) return 'under_review';
  
  return this.verificationStatus;
};

const DriverApplication = mongoose.model('DriverApplication', driverApplicationSchema);

export default DriverApplication;