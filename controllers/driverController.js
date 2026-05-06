import Driver from '../models/Driver.js';

// ==================== DRIVER SELF-SERVICE FUNCTIONS ====================

// Toggle driver's own online status (for authenticated drivers)
export const toggleMyOnlineStatus = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude } = req.body; // Get location from request body
    
    const driver = await Driver.findById(driverId);
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    // Check if driver is verified
    if (!req.driver.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Driver not verified. Please complete registration and wait for verification.'
      });
    }
    
    // If going online, validate location is provided
    const newOnlineStatus = !driver.isOnline;
    
    if (newOnlineStatus) {
      // When going online, location is required
      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'Location (latitude and longitude) is required to go online'
        });
      }
      
      // Validate coordinates
      if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180'
        });
      }
      
      // Update current location when going online
      driver.currentLocation = {
        type: 'Point',
        coordinates: [longitude, latitude] // GeoJSON format: [longitude, latitude]
      };
      
      driver.isOnline = true;
      driver.isAvailable = true;
      driver.lastOnlineAt = new Date();
    } else {
      // Going offline - clear location or keep last known
      driver.isOnline = false;
      driver.isAvailable = false;
      driver.lastOnlineAt = null;
      // Optionally keep last known location or clear it
      // driver.currentLocation.coordinates = [0, 0];
    }
    
    driver.lastActive = new Date();
    await driver.save();
    
    // Emit socket event if needed
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:status-changed', {
        driverId: driver._id,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }
    
    res.status(200).json({
      success: true,
      message: `You are now ${driver.isOnline ? 'online' : 'offline'}`,
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        currentLocation: driver.currentLocation,
        lastActive: driver.lastActive,
        lastOnlineAt: driver.lastOnlineAt
      }
    });
  } catch (error) {
    console.error('Error in toggleMyOnlineStatus:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to toggle online status' 
    });
  }
}

// Get driver's own online status
export const getMyOnlineStatus = async (req, res) => {
  try {
    const driverId = req.driver.id;
    
    const driver = await Driver.findById(driverId)
      .select('isOnline isAvailable lastActive lastOnlineAt');
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        lastActive: driver.lastActive,
        lastOnlineAt: driver.lastOnlineAt
      }
    });
  } catch (error) {
    console.error('Error in getMyOnlineStatus:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get online status' 
    });
  }
};

// Update driver's own location
export const updateLocation = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Latitude and longitude are required' 
      });
    }
    
    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      },
      { new: true }
    ).select('currentLocation lastActive');
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    // Emit socket event if needed
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:location-update', {
        driverId,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: driver.currentLocation,
        lastActive: driver.lastActive
      }
    });
  } catch (error) {
    console.error('Error in updateLocation:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to update location' 
    });
  }
};

// Get driver's own stats
export const getDriverStats = async (req, res) => {
  try {
    const driverId = req.driver.id;
    
    const driver = await Driver.findById(driverId)
      .select('totalEarnings totalTrips rating isOnline isAvailable');
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        totalEarnings: driver.totalEarnings,
        totalTrips: driver.totalTrips,
        rating: driver.rating,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable
      }
    });
  } catch (error) {
    console.error('Error in getDriverStats:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get driver stats' 
    });
  }
};


// ==================== ADMIN FUNCTIONS ====================

// Get all drivers (admin only)
export const getAllDrivers = async (req, res) => {
  try {
    const { status, vehicleType, verificationStatus, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (status === 'available') query.isAvailable = true;
    if (status === 'busy') query.isAvailable = false;
    if (status === 'online') query.isOnline = true;
    if (status === 'offline') query.isOnline = false;
    if (vehicleType) query.vehicleType = vehicleType;
    if (verificationStatus) query.verificationStatus = verificationStatus;
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    
    const drivers = await Driver.find(query)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 });
    
    const total = await Driver.countDocuments(query);
    
    res.json({
      success: true,
      data: drivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in getAllDrivers:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Get driver by ID (admin only)
export const getDriverById = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    res.json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Error in getDriverById:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Create driver (admin only)
export const createDriver = async (req, res) => {
  try {
    const driver = new Driver(req.body);
    await driver.save();
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:created', driver);
    }
    
    res.status(201).json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Error in createDriver:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Update driver (admin only)
export const updateDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:updated', driver);
    }
    
    res.json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Error in updateDriver:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Delete driver (soft delete - admin only)
export const deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isActive: false, isOnline: false, isAvailable: false },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:deleted', { id: req.params.id });
    }
    
    res.json({ 
      success: true, 
      message: 'Driver deleted successfully' 
    });
  } catch (error) {
    console.error('Error in deleteDriver:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Update driver location (admin only)
export const updateDriverLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        }
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:location-update', {
        driverId: driver._id,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Error in updateDriverLocation:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Update driver availability (admin only)
export const updateDriverAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isAvailable },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:availability-change', {
        driverId: driver._id,
        isAvailable,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Error in updateDriverAvailability:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Get available drivers (public)
export const getAvailableDrivers = async (req, res) => {
  try {
    const { vehicleType, latitude, longitude, radius = 5000 } = req.query;
    
    const query = {
      isActive: true,
      isOnline: true,
      isAvailable: true,
      isBlocked: false,
      verificationStatus: 'verified'
    };
    
    if (vehicleType) query.vehicleType = vehicleType;
    
    let drivers;
    
    if (latitude && longitude) {
      drivers = await Driver.find({
        ...query,
        currentLocation: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(longitude), parseFloat(latitude)]
            },
            $maxDistance: parseInt(radius)
          }
        }
      }).select('-__v');
    } else {
      drivers = await Driver.find(query).select('-__v');
    }
    
    res.json({ 
      success: true, 
      data: drivers 
    });
  } catch (error) {
    console.error('Error in getAvailableDrivers:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Submit documents for verification (driver self-service)
export const submitForVerification = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { documents } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        verificationStatus: 'under_review',
        documents: documents,
        submittedAt: new Date()
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:verification-submitted', {
        driverId: driver._id,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: 'Documents submitted for verification' 
    });
  } catch (error) {
    console.error('Error in submitForVerification:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Verify driver (admin only)
export const verifyDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'verified',
        isVerified: true,
        verifiedAt: new Date(),
        verifiedBy: req.admin?.id || req.admin?._id
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:verified', {
        driverId: driver._id,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: 'Driver verified successfully' 
    });
  } catch (error) {
    console.error('Error in verifyDriver:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Reject driver verification (admin only)
export const rejectDriver = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'rejected',
        isVerified: false,
        rejectionReason: reason,
        verifiedBy: req.admin?.id || req.admin?._id
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:rejected', {
        driverId: driver._id,
        reason,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: 'Driver verification rejected' 
    });
  } catch (error) {
    console.error('Error in rejectDriver:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Get pending verifications (admin only)
export const getPendingVerifications = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const query = {
      verificationStatus: { $in: ['pending', 'under_review'] }
    };
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    
    const drivers = await Driver.find(query)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ submittedAt: -1 });
    
    const total = await Driver.countDocuments(query);
    
    res.json({
      success: true,
      data: drivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in getPendingVerifications:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Toggle driver block status (admin only)
export const toggleBlockDriver = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    driver.isBlocked = !driver.isBlocked;
    if (driver.isBlocked) {
      driver.isOnline = false;
      driver.isAvailable = false;
    }
    await driver.save();
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:block-status-changed', {
        driverId: driver._id,
        isBlocked: driver.isBlocked,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: `Driver ${driver.isBlocked ? 'blocked' : 'unblocked'} successfully` 
    });
  } catch (error) {
    console.error('Error in toggleBlockDriver:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Update driver documents (admin only)
export const updateDriverDocuments = async (req, res) => {
  try {
    const { documents } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { documents },
      { new: true, runValidators: true }
    );
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:documents-updated', {
        driverId: driver._id,
        documents: driver.documents,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: 'Documents updated successfully' 
    });
  } catch (error) {
    console.error('Error in updateDriverDocuments:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Toggle driver active status (admin only)
export const toggleDriverActive = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    driver.isOnline = !driver.isOnline;
    driver.isAvailable = driver.isOnline;
    driver.lastOnlineAt = driver.isOnline ? null : new Date();
    await driver.save();
    
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:active-status-changed', {
        driverId: driver._id,
        isOnline: driver.isOnline,
        timestamp: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: driver, 
      message: driver.isOnline ? 'Driver is now online' : 'Driver is now offline' 
    });
  } catch (error) {
    console.error('Error in toggleDriverActive:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Add these functions to your existing driverController.js

// Update driver location with socket broadcast


// Helper function to find nearby customers
async function findNearbyCustomers(latitude, longitude, radius) {
  try {
    // Find rides that are searching for drivers
    const Ride = (await import('../models/Ride.js')).default;
    const searchingRides = await Ride.find({
      status: 'searching',
      'customer.customerId': { $exists: true }
    }).populate('customer.customerId');

    const nearbyCustomers = [];
    
    for (const ride of searchingRides) {
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      const distance = calculateDistance(latitude, longitude, pickupLat, pickupLon);
      
      if (distance <= radius) {
        nearbyCustomers.push({
          customerId: ride.customer.customerId,
          rideId: ride.rideId,
          distance,
          pickupLocation: ride.pickupLocation
        });
      }
    }
    
    return nearbyCustomers;
  } catch (error) {
    console.error('Error finding nearby customers:', error);
    return [];
  }
}
