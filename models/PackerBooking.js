import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  address: { type: String, required: true },
  coordinates: { type: [Number], required: true }, // [longitude, latitude]
  floor: { type: Number, default: 0 },
  hasLift: { type: Boolean, default: false }
}, { _id: false });

const itemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  name: { type: String, required: true },
  qty: { type: Number, required: true, default: 1 },
  fragile: { type: Boolean, default: false }
}, { _id: false });

const serviceSchema = new mongoose.Schema({
  packingType: { type: String, enum: ['none', 'single-layer', 'multi-layer'], default: 'none' },
  loadingUnloading: { type: Boolean, default: true },
  assembly: { type: Boolean, default: false }
}, { _id: false });

const pricingSchema = new mongoose.Schema({
  itemCost: { type: Number, default: 0 },
  extraCost: { type: Number, default: 0 },
  distanceCharge: { type: Number, default: 0 },
  serviceCharge: { type: Number, default: 0 },
  total: { type: Number, required: true },
  bookingAmountPaid: { type: Number, default: 0 }
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  timeSlot: { type: String, required: true } // e.g. "09:00 AM - 11:00 AM"
}, { _id: false });

const logSchema = new mongoose.Schema({
  status: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  note: { type: String }
}, { _id: false });

const packerBookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },

  locations: {
    pickup: { type: locationSchema, required: true },
    dropoff: { type: locationSchema, required: true }
  },
  distance: { type: Number, default: 0 }, // in km

  inventory: [itemSchema],
  services: { type: serviceSchema, default: {} },
  pricing: { type: pricingSchema, required: true },
  schedule: { type: scheduleSchema, required: true },

  paymentStatus: {
    type: String,
    enum: ['pending', 'partial_paid', 'completed'],
    default: 'pending'
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  
  communications: {
    proxyPhoneNumber: { type: String }, // Used to mask actual numbers
    expiry: { type: Date }
  },

  logs: [logSchema]
}, { timestamps: true });

packerBookingSchema.index({ customerId: 1, status: 1 });
packerBookingSchema.index({ driverId: 1, status: 1 });
packerBookingSchema.index({ 'schedule.date': 1 });
packerBookingSchema.index({ bookingId: 1 });

export default mongoose.model('PackerBooking', packerBookingSchema);
