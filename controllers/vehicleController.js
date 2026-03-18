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
      .sort({ displayName: 1 });
    
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
    const { vehicleType, name, baseFare, pricePerKm, capacity, description } = req.body;
    
    const existingVehicle = await Vehicle.findOne({ vehicleType });
    if (existingVehicle) {
      return res.status(400).json({ success: false, message: 'Vehicle ID already exists' });
    }
    
    const vehicle = new Vehicle({
      vehicleType,
      name,
      baseFare,
      pricePerKm,
      capacity,
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
    
    // Fare calculation based on distance only (no base fare)
    const total = distanceInKm * vehicle.pricePerKm;
    
    res.json({
      success: true,
      data: {
        vehicleType: vehicle.vehicleType,
        name: vehicle.name,
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
    const vehicles = await Vehicle.find({ isActive: true }).sort({ displayName: 1 });
    res.json({ success: true, data: vehicles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadVehicleImage = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

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
    if (vehicle.image && vehicle.image.publicId) {
      await deleteFromCloudinary(vehicle.image.publicId);
    }

    // Upload new image to Cloudinary
    const uploadedImage = await uploadToCloudinary(file.buffer, 'vehicles');

    // Update vehicle with new image
    vehicle.image = {
      url: uploadedImage.url,
      publicId: uploadedImage.publicId
    };
    
    await vehicle.save();

    const io = req.app.get('io');
    io.emit('vehicle:image:uploaded', { vehicleId: id, image: vehicle.image });

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        vehicleId: id,
        image: vehicle.image
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
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (!vehicle.image || !vehicle.image.publicId) {
      return res.status(404).json({
        success: false,
        message: 'No image found for this vehicle'
      });
    }

    // Delete from Cloudinary
    await deleteFromCloudinary(vehicle.image.publicId);

    // Remove image from vehicle
    vehicle.image = undefined;
    await vehicle.save();

    const io = req.app.get('io');
    io.emit('vehicle:image:deleted', { vehicleId: id });

    res.json({
      success: true,
      message: 'Image deleted successfully',
      data: {
        vehicleId: id,
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

