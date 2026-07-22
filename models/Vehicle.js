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
  perKmAdd: {                      // NEW FIELD
    type: Number,
    required: true,
    min: 0,
    default: 0                     // default for existing docs
  },
  subscriptionFee: {               // NEW FIELD
    type: Number,
    required: true,
    min: 0,
    default: 0                     // temporary default for existing documents
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