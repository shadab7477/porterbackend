import Vehicle from '../models/Vehicle.js';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';

export const getAllVehicles = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10, distance } = req.query;
    const query = {};
    
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    let isMerchant = false;
    if (req.customerId) {
      const customer = await Customer.findById(req.customerId).lean();
      if (customer && customer.isMerchant) {
        isMerchant = true;
      }
    }
    
    let vehicles = await Vehicle.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ name: 1 })
      .lean(); // Use lean to allow modification
    
    const total = await Vehicle.countDocuments(query);
    
    if (distance) {
      let distanceInKm = parseFloat(distance);
      if (!isNaN(distanceInKm)) {
        if (distanceInKm < 1) distanceInKm = 1;
        vehicles = await Promise.all(vehicles.map(async (v) => {
          const fare = await Ride.calculateFare(distanceInKm, v.vehicleType, isMerchant);
          return {
            ...v,
            estimatedPrice: fare.total,
            fareDetails: fare.breakdown
          };
        }));
      }
    }

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
      mainPricePerKm,   // NEW
      subscriptionFee,
      slabRates,        // NEW
      capacity,
      weight,
      discount,
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
      mainPricePerKm: mainPricePerKm !== undefined ? Number(mainPricePerKm) : 0, // NEW
      subscriptionFee: subscriptionFee !== undefined ? Number(subscriptionFee) : 0,
      discount: discount !== undefined ? Number(discount) : 0,
      slabRates, // NEW
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
    
    // Convert mainPricePerKm to number if present (NEW)
    if (updateData.mainPricePerKm !== undefined) {
      updateData.mainPricePerKm = Number(updateData.mainPricePerKm);
    }
    
    // Convert subscriptionFee to number if present
    if (updateData.subscriptionFee !== undefined) {
      updateData.subscriptionFee = Number(updateData.subscriptionFee);
    }
    
    // Convert discount to number if present
    if (updateData.discount !== undefined) {
      updateData.discount = Number(updateData.discount);
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
    
    let isMerchant = false;
    if (req.customerId) {
      const customer = await Customer.findById(req.customerId).lean();
      if (customer && customer.isMerchant) {
        isMerchant = true;
      }
    }
    
    // We'll allow vehicleType to be optional. If provided, we return its specific calculation as primary.
    // Otherwise we just default to the first active vehicle.
    let targetVehicleType = vehicleType;
    if (!targetVehicleType) {
      const firstVehicle = await Vehicle.findOne({ isActive: true });
      if (!firstVehicle) {
        return res.status(404).json({ success: false, message: 'No active vehicles found' });
      }
      targetVehicleType = firstVehicle.vehicleType;
    }

    const vehicle = await Vehicle.findOne({ vehicleType: targetVehicleType, isActive: true });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    
    let distanceInKm = parseFloat(distance);
    if (!isNaN(distanceInKm) && distanceInKm < 1) {
      distanceInKm = 1;
    }
    let total = 0;
    let baseFare = vehicle.baseFare;
    let ratePerKm = vehicle.pricePerKm;
    
    const vType = vehicle.vehicleType.toLowerCase();
    if (['bike', 'scooty', 'scooter'].includes(vType)) {
      baseFare = 0;
      let calcDistance = distanceInKm < 1 ? 1 : distanceInKm;
      let bucket = Math.floor(calcDistance);
      if (bucket > 13) bucket = 13;
      
      let slabRate = 0;
      if (vehicle.slabRates && vehicle.slabRates[`price${bucket}km`]) {
         slabRate = vehicle.slabRates[`price${bucket}km`];
      }
      
      if (slabRate > 0) {
         ratePerKm = slabRate;
      }
      
      total = distanceInKm * ratePerKm;
    } else {
      if (distanceInKm > 5 && vehicle.mainPricePerKm > 0) {
        total = distanceInKm * vehicle.mainPricePerKm;
        baseFare = 0;
        ratePerKm = vehicle.mainPricePerKm;
      } else {
        total = baseFare + (distanceInKm * ratePerKm);
      }
    }
    
    let subtotal = total;
    let discountPercentage = 0;
    let discountAmount = 0;
    
    if (distanceInKm > 10) {
      if (vehicle.discount && vehicle.discount > 0) {
        discountPercentage = vehicle.discount;
      } else {
        const vType = vehicle.vehicleType.toLowerCase();
        if (['bike', 'scooty', 'scooter'].includes(vType)) {
          discountPercentage = 12;
        } else {
          discountPercentage = 15;
        }
      }
      discountAmount = total * (discountPercentage / 100);
      total -= discountAmount;
    }
    
    // Now fetch all active vehicles to calculate their specific fares
    const activeVehicles = await Vehicle.find({ isActive: true }).sort({ baseFare: 1 });
    const vehicleOptions = activeVehicles.map(v => {
      let vTotal = 0;
      let vBaseFare = v.baseFare;
      let vRatePerKm = v.pricePerKm;
      
      const vt = v.vehicleType.toLowerCase();
      if (['bike', 'scooty', 'scooter'].includes(vt)) {
        vBaseFare = 0;
        let cDist = distanceInKm < 1 ? 1 : distanceInKm;
        let vBucket = Math.floor(cDist);
        if (vBucket > 13) vBucket = 13;
        
        let vSlabRate = 0;
        if (v.slabRates && v.slabRates[`price${vBucket}km`]) {
           vSlabRate = v.slabRates[`price${vBucket}km`];
        }
        if (vSlabRate > 0) {
           vRatePerKm = vSlabRate;
        }
        vTotal = distanceInKm * vRatePerKm;
      } else {
        if (distanceInKm > 5 && v.mainPricePerKm > 0) {
          vTotal = distanceInKm * v.mainPricePerKm;
          vBaseFare = 0;
          vRatePerKm = v.mainPricePerKm;
        } else {
          vTotal = vBaseFare + (distanceInKm * vRatePerKm);
        }
      }
      
      let vSubtotal = vTotal;
      let vDiscountPercentage = 0;
      let vDiscountAmount = 0;
      
      if (distanceInKm > 10) {
        if (v.discount && v.discount > 0) {
          vDiscountPercentage = v.discount;
        } else {
          if (['bike', 'scooty', 'scooter'].includes(vt)) {
            vDiscountPercentage = 12;
          } else {
            vDiscountPercentage = 15;
          }
        }
        vDiscountAmount = vTotal * (vDiscountPercentage / 100);
        vTotal -= vDiscountAmount;
      }

      return {
        vehicleType: v.vehicleType,
        category: v.category,
        name: v.name,
        capacity: v.capacity,
        weight: v.weight,
        mainPricePerKm: v.mainPricePerKm,
        breakdown: {
          distance: distanceInKm,
          baseFare: vBaseFare,
          pricePerKm: vRatePerKm,
          subtotal: Math.round(vSubtotal * 100) / 100,
          discountAmount: Math.round(vDiscountAmount * 100) / 100,
          discountPercentage: vDiscountPercentage,
          distanceCharge: Math.round(vTotal * 100) / 100
        },
        total: Math.round(vTotal * 100) / 100
      };
    });

    res.json({
      success: true,
      data: {
        vehicleType: vehicle.vehicleType,
        name: vehicle.name,
        mainPricePerKm: vehicle.mainPricePerKm,   // NEW (optional)
        breakdown: {
          distance: distanceInKm,
          baseFare: baseFare,
          pricePerKm: ratePerKm,
          subtotal: Math.round(subtotal * 100) / 100,
          discountAmount: Math.round(discountAmount * 100) / 100,
          discountPercentage,
          distanceCharge: Math.round(total * 100) / 100
        },
        total: Math.round(total * 100) / 100,
        vehicleOptions // NEW: Array containing calculated fares for all vehicles
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getActiveVehicles = async (req, res) => {
  try {
    const { distance } = req.query;
    
    let isMerchant = false;
    if (req.customerId) {
      const customer = await Customer.findById(req.customerId).lean();
      if (customer && customer.isMerchant) {
        isMerchant = true;
      }
    }
    
    let vehicles = await Vehicle.find({ isActive: true }).sort({ name: 1 }).lean();
    
    if (distance) {
      let distanceInKm = parseFloat(distance);
      if (!isNaN(distanceInKm)) {
        if (distanceInKm < 1) distanceInKm = 1;
        vehicles = await Promise.all(vehicles.map(async (v) => {
          const fare = await Ride.calculateFare(distanceInKm, v.vehicleType, isMerchant);
          return {
            ...v,
            estimatedPrice: fare.total,
            fareDetails: fare.breakdown
          };
        }));
      }
    }

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