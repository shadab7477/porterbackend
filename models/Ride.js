import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Point'],
    default: 'Point'
  },
  coordinates: {
    type: [Number],
    required: true
  },
  address: {
    type: String,
    required: true
  },
  placeId: String
}, { _id: false });

const rideSchema = new mongoose.Schema({
  rideId: {
    type: String,
    unique: true,
    default: () => 'RID' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000)
  },

  // Customer Details
  customer: {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true
    },
    name: String,
    phone: String,
    rating: Number
  },

  // Receiver Details
  receiver: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' }
  },

  // Driver Details
  driver: {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver'
    },
    name: String,
    phone: String,
    vehicleType: String,
    vehicleNumber: String,
    rating: Number
  },

  // Locations
  pickupLocation: {
    type: locationSchema,
    required: true
  },
  dropLocation: {
    type: locationSchema,
    required: true
  },

  // Route Details
  distance: {
    type: Number,
    required: true
  },
  duration: {
    type: Number,
    required: true
  },

  // Route Info (for display)
  routeInfo: {
    distanceText: String,
    durationText: String,
    durationInTrafficText: String
  },

  // Fare Details
  fare: {
    baseFare: { type: Number, default: 50 },
    distanceFare: { type: Number, default: 0 },
    timeFare: { type: Number, default: 0 },
    surgeMultiplier: { type: Number, default: 1 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true }
  },

  // Payment
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'wallet', 'online'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String,
    default: null
  },

  // Status Tracking
  status: {
    type: String,
    enum: [
      'requested',
      'searching',
      'driver_assigned',
      'driver_arrived',
      'in_progress',
      'completed',
      'cancelled',
      'no_drivers'
    ],
    default: 'requested'
  },

  // Timestamps
  requestedAt: { type: Date, default: Date.now },
  searchingStartedAt: Date,
  driverAssignedAt: Date,
  driverArrivedAt: Date,
  rideStartedAt: Date,
  rideCompletedAt: Date,
  cancelledAt: Date,
  cancelledBy: {
    type: String,
    enum: ['customer', 'driver', 'system']
  },
  cancellationReason: String,
  cancellationFee: { type: Number, default: 0 },

  // Driver Search
  driversNotified: [{
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    notifiedAt: Date,
    response: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'timeout']
    },
    respondedAt: Date,
    rejectionReason: String,
    distanceToPickup: Number,
    durationToPickup: Number
  }],

  // Driver ETA when assigned
  driverETA: {
    distance: Number,
    duration: Number,
    distanceText: String,
    durationText: String
  },

  // Tracking
  tracking: [{
    timestamp: { type: Date, default: Date.now },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number]
    },
    speed: Number
  }],

  // Actual distance (for completed rides)
  actualDistance: Number,
  actualDuration: Number,

  // Ratings
  customerRating: {
    rating: { type: Number, min: 1, max: 5 },
    review: String,
    givenAt: Date
  },
  driverRating: {
    rating: { type: Number, min: 1, max: 5 },
    review: String,
    givenAt: Date
  },

  // Geo-proximity flag
  nearDestination: {
    type: Boolean,
    default: false
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ==================== INDEXES ====================
// Single field indexes
rideSchema.index({ 'customer.customerId': 1 });
rideSchema.index({ 'driver.driverId': 1 });
rideSchema.index({ status: 1 });
rideSchema.index({ requestedAt: -1 });
rideSchema.index({ paymentIntentId: 1 });
rideSchema.index({ 'driversNotified.driverId': 1 });

// CRITICAL: 2dsphere index for geospatial queries
rideSchema.index({ pickupLocation: '2dsphere' });

// Compound indexes for common queries
rideSchema.index({ status: 1, requestedAt: -1 });
rideSchema.index({ 'driver.driverId': 1, status: 1 });
rideSchema.index({ 'customer.customerId': 1, status: 1, requestedAt: -1 });

// Pre-save middleware
rideSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Methods
rideSchema.methods.updateStatus = function (status) {
  this.status = status;
  const now = new Date();

  switch (status) {
    case 'searching':
      this.searchingStartedAt = now;
      break;
    case 'driver_assigned':
      this.driverAssignedAt = now;
      break;
    case 'driver_arrived':
      this.driverArrivedAt = now;
      break;
    case 'in_progress':
      this.rideStartedAt = now;
      break;
    case 'completed':
      this.rideCompletedAt = now;
      break;
    case 'cancelled':
      this.cancelledAt = now;
      break;
  }

  return this;
};

// Static method to calculate fare
rideSchema.statics.calculateFare = function (distance, duration, vehicleType = 'car', isPeakHour = false) {
  const baseFares = {
    'bike': 30,
    'auto': 40,
    'car': 50,
    'mini_truck': 80,
    'truck': 120
  };

  const perKmRates = {
    'bike': 8,
    'auto': 10,
    'car': 12,
    'mini_truck': 20,
    'truck': 30
  };

  const perMinuteRates = {
    'bike': 1,
    'auto': 1.5,
    'car': 2,
    'mini_truck': 3,
    'truck': 5
  };

  const surgeMultiplier = isPeakHour ? 1.5 : 1;

  const baseFare = baseFares[vehicleType] || baseFares.car;
  const distanceFare = distance * (perKmRates[vehicleType] || perKmRates.car);
  const timeFare = duration * (perMinuteRates[vehicleType] || perMinuteRates.car);

  const subtotal = baseFare + distanceFare + timeFare;
  const afterSurge = subtotal * surgeMultiplier;
  const tax = afterSurge * 0.05;
  const total = afterSurge + tax;

  return {
    baseFare,
    distanceFare,
    timeFare,
    surgeMultiplier,
    tax,
    total: Math.round(total),
    finalAmount: Math.round(total),
    breakdown: {
      baseFare: `₹${baseFare}`,
      distanceFare: `${distance.toFixed(1)}km × ₹${perKmRates[vehicleType]} = ₹${Math.round(distanceFare)}`,
      timeFare: `${duration}min × ₹${perMinuteRates[vehicleType]} = ₹${Math.round(timeFare)}`,
      surge: surgeMultiplier > 1 ? `${surgeMultiplier}x surge` : 'No surge',
      tax: `5% GST = ₹${Math.round(tax)}`,
      total: `₹${Math.round(total)}`
    }
  };
};

const Ride = mongoose.model('Ride', rideSchema);

// ==================== ENSURE INDEXES CREATED ON STARTUP ====================
(async () => {
  try {
    await Ride.createIndexes();
    console.log('✅ Ride indexes created successfully');
    
    // Verify geo index specifically
    const indexes = await Ride.collection.indexes();
    const hasGeoIndex = indexes.some(idx => 
      idx.key && idx.key.pickupLocation === '2dsphere'
    );
    
    if (hasGeoIndex) {
      console.log('✅ Geo index on pickupLocation exists');
    } else {
      console.log('⚠️ Creating geo index on pickupLocation...');
      await Ride.collection.createIndex({ pickupLocation: '2dsphere' });
      console.log('✅ Geo index created');
    }
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
  }
})();

export default Ride;