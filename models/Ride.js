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
  requestedVehicleType: {
    type: String,
    required: true,
    default: 'car'
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
  // Single drop location (backward compatibility - stores last/final drop)
  dropLocation: {
    type: locationSchema,
    required: true
  },
  // Multiple drop locations (up to 4)
  dropLocations: [locationSchema],
  // Per-leg distance breakdown
  legDistances: [{
    from: { type: String },      // "pickup", "drop_1", "drop_2", etc.
    to: { type: String },        // "drop_1", "drop_2", etc.
    distance: { type: Number },  // km
    duration: { type: Number },  // minutes
    distanceText: { type: String },
    durationText: { type: String }
  }],
  // Track which drop the driver is currently heading to (0-indexed)
  currentDropIndex: {
    type: Number,
    default: 0
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

  // Fare Details - SIMPLIFIED: only distanceFare and total
  fare: {
    distanceFare: { type: Number, default: 0 },
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

// SIMPLIFIED: Static method to calculate fare - ONLY per km rates, no base, no tax
rideSchema.statics.calculateFare = function (distance, vehicleType = 'car') {
  // Per kilometer rates only - as specified
  const perKmRates = {
    // 2 Wheelers
    'bike': 15,        // Bike & Scooty
    'scooty': 15,      // Alternative name for bike
    
    // 3 Wheelers
    'auto': 35,        // Mini 3W
    'mini_3w': 35,     // Mini 3W
    'e_loader': 45,    // E Loader
    
    // 4 Wheelers
    'car': 105,        // TATA Ace
    'tata_ace': 105,   // TATA Ace
    'mini_truck': 105, // Alternative for TATA Ace
    'truck': 105       // Default for larger vehicles
  };

  // Get rate per km, default to car rate if vehicle type not found
  const ratePerKm = perKmRates[vehicleType] || perKmRates.car;
  
  // Calculate total fare: distance × rate per km
  const totalFare = distance * ratePerKm;

  // Return simplified fare object
  return {
    distanceFare: Math.round(totalFare),
    total: Math.round(totalFare),
    finalAmount: Math.round(totalFare),
    breakdown: {
      ratePerKm: `₹${ratePerKm}/km`,
      distance: `${distance.toFixed(1)} km`,
      total: `₹${Math.round(totalFare)}`
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