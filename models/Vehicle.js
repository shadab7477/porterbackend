import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    required: [true, 'Vehicle ID is required'],
    unique: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['2 Wheelers', '3 Wheelers', '4 Wheelers', 'Other'],
    default: 'Other'
  },
  name: {
    type: String,
    required: [true, 'Vehicle name is required'],
    trim: true
  },
  baseFare: {
    type: Number,
    required: [true, 'Base fare is required'],
    min: 0
  },
  pricePerKm: {
    type: Number,
    required: [true, 'Price per km is required'],
    min: 0
  },
  mainPricePerKm: {               // NEW FIELD
    type: Number,
    required: true,
    min: 0,
    default: 0                     // temporary default for existing documents
  },
  subscriptionFee: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  discount: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  slabRates: {
    price1km: { type: Number, default: 0 },
    price2km: { type: Number, default: 0 },
    price3km: { type: Number, default: 0 },
    price4km: { type: Number, default: 0 },
    price5km: { type: Number, default: 0 },
    price6km: { type: Number, default: 0 },
    price7km: { type: Number, default: 0 },
    price8km: { type: Number, default: 0 },
    price9km: { type: Number, default: 0 },
    price10km: { type: Number, default: 0 },
    price11km: { type: Number, default: 0 },
    price12km: { type: Number, default: 0 },
    price13km: { type: Number, default: 0 }
  },
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: 1
  },
  weight: {
    type: String,
    trim: true,
    default: ''
  },
  description: {
    type: String,
    trim: true
  },
  image_1: {
    url: String,
    publicId: String
  },
  image_2: {
    url: String,
    publicId: String
  },
  image_3: {
    url: String,
    publicId: String
  },
  isActive: {
    type: Boolean,
    default: true
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

vehicleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Vehicle', vehicleSchema);