import Driver from '../models/Driver.js';

export const getAllDrivers = async (req, res) => {
  try {
    const { status, vehicleType, verificationStatus, page = 1, limit = 10 } = req.query;
    const query = { isActive: true };
    
    if (status === 'available') query.isAvailable = true;
    if (status === 'busy') query.isAvailable = false;
    if (vehicleType) query.vehicleType = vehicleType;
    if (verificationStatus) query.verificationStatus = verificationStatus;
    
    const drivers = await Driver.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
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
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getDriverById = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createDriver = async (req, res) => {
  try {
    const driver = new Driver(req.body);
    await driver.save();
    
    const io = req.app.get('io');
    io.emit('driver:created', driver);
    
    res.status(201).json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:updated', driver);
    
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:deleted', { id: req.params.id });
    
    res.json({ success: true, message: 'Driver deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [longitude, latitude]
        }
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:location-update', {
      driverId: driver._id,
      location: driver.currentLocation,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isAvailable },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:availability-change', {
      driverId: driver._id,
      isAvailable,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getAvailableDrivers = async (req, res) => {
  try {
    const { vehicleType, latitude, longitude, radius = 5000 } = req.query;
    
    const query = {
      isActive: true,
      isAvailable: true,
      isVerified: true,
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
      });
    } else {
      drivers = await Driver.find(query);
    }
    
    res.json({ success: true, data: drivers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verification methods
export const submitForVerification = async (req, res) => {
  try {
    const { documents } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'under_review',
        verificationDocuments: documents,
        submittedAt: new Date()
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:verification-submitted', {
      driverId: driver._id,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver, message: 'Documents submitted for verification' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const verifyDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'verified',
        isVerified: true,
        verifiedAt: new Date(),
        verifiedBy: req.adminId
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:verified', {
      driverId: driver._id,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver, message: 'Driver verified successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const rejectDriver = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'rejected',
        isVerified: false,
        rejectionReason: reason,
        verifiedBy: req.adminId
      },
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:rejected', {
      driverId: driver._id,
      reason,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver, message: 'Driver verification rejected' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getPendingVerifications = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const query = {
      verificationStatus: { $in: ['pending', 'under_review'] }
    };
    
    const drivers = await Driver.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
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
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBlockDriver = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    driver.isBlocked = !driver.isBlocked;
    await driver.save();
    
    const io = req.app.get('io');
    io.emit('driver:block-status-changed', {
      driverId: driver._id,
      isBlocked: driver.isBlocked,
      timestamp: new Date()
    });
    
    res.json({ 
      success: true, 
      data: driver, 
      message: `Driver ${driver.isBlocked ? 'blocked' : 'unblocked'} successfully` 
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateDriverDocuments = async (req, res) => {
  try {
    const { documents } = req.body;
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { documents },
      { new: true, runValidators: true }
    );
    
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    
    const io = req.app.get('io');
    io.emit('driver:documents-updated', {
      driverId: driver._id,
      documents: driver.documents,
      timestamp: new Date()
    });
    
    res.json({ success: true, data: driver, message: 'Documents updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};