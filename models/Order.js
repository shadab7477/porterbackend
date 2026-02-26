import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true
  },
  coordinates: {
    type: [Number],
    required: true
  },
  type: {
    type: String,
    enum: ['pickup', 'dropoff'],
    required: true
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    required: true,
    unique: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  vehicleType: {
    type: String,
    required: true
  },
  locations: {
    pickup: {
      type: locationSchema,
      required: true
    },
    dropoff: {
      type: locationSchema,
      required: true
    }
  },
  distance: {
    type: Number,
    default: 0,
    description: 'Distance in kilometers'
  },
  fare: {
    baseFare: {
      type: Number,
      default: 0
    },
    distanceCharge: {
      type: Number,
      default: 0
    },
    timeCharge: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    },
    commission: {
      type: Number,
      default: 0
    }
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'accepted', 'picked_up', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  notes: {
    type: String,
    trim: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  assignedAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  cancellationReason: {
    type: String
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

orderSchema.index({ customerId: 1, status: 1 });
orderSchema.index({ driverId: 1, status: 1 });
orderSchema.index({ bookingId: 1 });
orderSchema.index({ createdAt: -1 });

orderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Order', orderSchema);