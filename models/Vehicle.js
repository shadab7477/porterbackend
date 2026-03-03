import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    required: [true, 'Vehicle ID is required'],
    unique: true,
    trim: true
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
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: 1
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    url: {
      type: String
    },
    publicId: {
      type: String
    }
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