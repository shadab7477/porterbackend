import mongoose from 'mongoose';

// Reusable document verification sub-schema
const documentVerificationSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verifiedAt: Date,
  rejectionReason: String,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, { _id: false });

// Generic image document sub-schema
const documentSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  uploadedAt: { type: Date, default: Date.now },
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

// Aadhaar card (front + back images)
const aadharDocSchema = new mongoose.Schema({
  front: { type: documentSchema, default: null },
  back:  { type: documentSchema, default: null },
  aadharNumber: { type: String, trim: true },
  verification: {
    type: documentVerificationSchema,
    default: () => ({ status: 'pending' })
  }
}, { _id: false });

const merchantApplicationSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },
    customerPhone: { type: String },
    customerName:  { type: String },

    // Business info
    businessName:   { type: String, trim: true },
    businessRegistrationNumber: { type: String, trim: true },
    panNumber:      { type: String, trim: true, uppercase: true },

    // Documents (all uploaded to Cloudinary)
    aadharCard:   { type: aadharDocSchema,  default: null },
    businessDoc:  { type: documentSchema,   default: null },
    panCard:      { type: documentSchema,   default: null },

    // Overall application status
    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },

    rejectionReason: { type: String },
    submittedAt:     { type: Date, default: Date.now },
    reviewedAt:      { type: Date },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    }
  },
  { timestamps: true }
);

// Compound indexes
merchantApplicationSchema.index({ customerId: 1, status: 1 });
merchantApplicationSchema.index({ submittedAt: -1 });

// Helper — check if all 3 document groups are individually verified
merchantApplicationSchema.methods.calculateOverallStatus = function () {
  const aadharOk =
    this.aadharCard?.front?.verification?.status === 'verified' &&
    this.aadharCard?.back?.verification?.status === 'verified';
  const businessDocOk = this.businessDoc?.verification?.status === 'verified';
  const panOk       = this.panCard?.verification?.status === 'verified';

  const anyRejected =
    this.aadharCard?.front?.verification?.status === 'rejected' ||
    this.aadharCard?.back?.verification?.status  === 'rejected' ||
    this.businessDoc?.verification?.status        === 'rejected' ||
    this.panCard?.verification?.status            === 'rejected';

  if (anyRejected) return 'under_review';
  if (aadharOk && businessDocOk && panOk) return 'approved'; // auto-approve when all docs verified
  return 'under_review';
};

const MerchantApplication = mongoose.model('MerchantApplication', merchantApplicationSchema);
export default MerchantApplication;
