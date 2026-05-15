import Vehicle from '../models/Vehicle.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';

export const getAllVehicles = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    const vehicles = await Vehicle.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ name: 1 });
    
    const total = await Vehicle.countDocuments(query);
    
    res.json({
      success: true,
      data: vehicles,
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

export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    res.json({ success: true, data: vehicle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVehicleByType = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ vehicleType: req.params.type, isActive: true });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle type not found' });
    }
    res.json({ success: true, data: vehicle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVehicle = async (req, res) => {
  try {
    const {
      vehicleType,
      category,
      name,
      baseFare,
      pricePerKm,
      subscriptionFee,   // NEW
      capacity,
      weight,
      description
    } = req.body;
    
    const existingVehicle = await Vehicle.findOne({ vehicleType });
    if (existingVehicle) {
      return res.status(400).json({ success: false, message: 'Vehicle ID already exists' });
    }
    
    const vehicle = new Vehicle({
      vehicleType,
      category,
      name,
      baseFare,
      pricePerKm,
      subscriptionFee: subscriptionFee !== undefined ? Number(subscriptionFee) : 0, // NEW
      capacity,
      weight,
      description
    });
    
    await vehicle.save();
    
    const io = req.app.get('io');
    io.emit('vehicle:created', vehicle);
    
    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Convert subscriptionFee to number if present (NEW)
    if (updateData.subscriptionFee !== undefined) {
      updateData.subscriptionFee = Number(updateData.subscriptionFee);
    }
    
    const vehicle = await Vehicle.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    
    const io = req.app.get('io');
    io.emit('vehicle:updated', vehicle);
    
    res.json({ success: true, data: vehicle });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    
    const io = req.app.get('io');
    io.emit('vehicle:deleted', { id: req.params.id });
    
    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const calculateFare = async (req, res) => {
  try {
    const { vehicleType, distance } = req.body;
    
    const vehicle = await Vehicle.findOne({ vehicleType, isActive: true });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    
    const distanceInKm = parseFloat(distance);
    const total = distanceInKm * vehicle.pricePerKm;
    
    res.json({
      success: true,
      data: {
        vehicleType: vehicle.vehicleType,
        name: vehicle.name,
        subscriptionFee: vehicle.subscriptionFee,   // NEW (optional)
        breakdown: {
          distance: distanceInKm,
          pricePerKm: vehicle.pricePerKm,
          distanceCharge: Math.round(total * 100) / 100
        },
        total: Math.round(total * 100) / 100
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getActiveVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, data: vehicles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadVehicleImage = async (req, res) => {
  try {
    const { id, index } = req.params;
    const file = req.file;

    if (!['1', '2', '3'].includes(index)) {
      return res.status(400).json({ success: false, message: 'Invalid image index (must be 1, 2, or 3)' });
    }

    const imageField = `image_${index}`;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an image'
      });
    }

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Delete old image from Cloudinary if exists
    if (vehicle[imageField] && vehicle[imageField].publicId) {
      await deleteFromCloudinary(vehicle[imageField].publicId);
    }

    // Upload new image to Cloudinary
    const uploadedImage = await uploadToCloudinary(file.buffer, 'vehicles');

    // Update vehicle with new image
    vehicle[imageField] = {
      url: uploadedImage.url,
      publicId: uploadedImage.publicId
    };
    
    await vehicle.save();

    const io = req.app.get('io');
    io.emit('vehicle:image:uploaded', { vehicleId: id, index, image: vehicle[imageField] });

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        vehicleId: id,
        index,
        image: vehicle[imageField]
      }
    });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
};

export const deleteVehicleImage = async (req, res) => {
  try {
    const { id, index } = req.params;
    if (!['1', '2', '3'].includes(index)) {
      return res.status(400).json({ success: false, message: 'Invalid image index (must be 1, 2, or 3)' });
    }
    const imageField = `image_${index}`;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (!vehicle[imageField] || !vehicle[imageField].publicId) {
      return res.status(404).json({
        success: false,
        message: 'No image found for this vehicle at this index'
      });
    }

    // Delete from Cloudinary
    await deleteFromCloudinary(vehicle[imageField].publicId);

    // Remove image from vehicle
    vehicle[imageField] = undefined;
    await vehicle.save();

    const io = req.app.get('io');
    io.emit('vehicle:image:deleted', { vehicleId: id, index });

    res.json({
      success: true,
      message: 'Image deleted successfully',
      data: {
        vehicleId: id,
        index,
        image: null
      }
    });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image',
      error: error.message
    });
  }
};