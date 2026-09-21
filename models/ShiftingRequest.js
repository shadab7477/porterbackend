import mongoose from 'mongoose';

const shiftingRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true
  },
  movingFrom: {
    type: String,
    required: [true, 'Moving from location is required'],
    trim: true
  },
  movingTo: {
    type: String,
    required: [true, 'Moving to location is required'],
    trim: true
  },
  bhkType: {
    type: String,
    required: [true, 'BHK type is required'],
    enum: ['1 BHK', '2 BHK', '3 BHK']
  },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

const ShiftingRequest = mongoose.model('ShiftingRequest', shiftingRequestSchema);

export default ShiftingRequest;
