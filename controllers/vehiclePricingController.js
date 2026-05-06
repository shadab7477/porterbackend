import VehiclePricing from '../models/VehiclePricing.js';
import { uploadToCloudinary } from '../config/cloudinary.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const validateImageFile = (file) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (!allowed.includes(file.mimetype))
    return { valid: false, message: 'Only JPEG, PNG and WEBP images are allowed.' };
  if (file.size > maxSize)
    return { valid: false, message: 'File too large. Max size is 5 MB.' };
  return { valid: true };
};

const uploadFile = async (fileArray, folder, label) => {
  if (!fileArray || fileArray.length === 0) return null;
  const file = fileArray[0];
  const check = validateImageFile(file);
  if (!check.valid) throw new Error(`${label}: ${check.message}`);
  const result = await uploadToCloudinary(file.buffer, folder);
  return {
    url: result.url,
    publicId: result.publicId
  };
};

// ─── Controller Methods ───────────────────────────────────────────────────────

export const getAllVehiclePricing = async (req, res) => {
  try {
    const vehicles = await VehiclePricing.find().sort({ ratePerKm: 1 });
    res.json({ success: true, data: vehicles });
  } catch (error) {
    console.error('Error fetching vehicle pricing:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vehicle pricing' });
  }
};

export const createVehiclePricing = async (req, res) => {
  try {
    const { category, type, displayName, ratePerKm, isActive } = req.body;

    if (!category || !type || !displayName || ratePerKm === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const existingType = await VehiclePricing.findOne({ type: type.toLowerCase() });
    if (existingType) {
      return res.status(400).json({ success: false, message: `Vehicle type '${type}' already exists` });
    }

    const uploadedFiles = req.files || {};
    if (!uploadedFiles.image || uploadedFiles.image.length === 0) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    let imageUpload;
    try {
      imageUpload = await uploadFile(uploadedFiles.image, 'vehicle-types', 'Vehicle Image');
    } catch (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    const vehiclePricing = new VehiclePricing({
      category,
      type: type.toLowerCase(),
      displayName,
      ratePerKm: Number(ratePerKm),
      image: imageUpload,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true
    });

    await vehiclePricing.save();

    res.status(201).json({ success: true, data: vehiclePricing, message: 'Vehicle pricing created successfully' });
  } catch (error) {
    console.error('Error creating vehicle pricing:', error);
    res.status(500).json({ success: false, message: 'Failed to create vehicle pricing' });
  }
};

export const updateVehiclePricing = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, type, displayName, ratePerKm, isActive } = req.body;

    const vehicle = await VehiclePricing.findById(id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle pricing not found' });
    }

    if (type && type.toLowerCase() !== vehicle.type) {
      const existingType = await VehiclePricing.findOne({ type: type.toLowerCase() });
      if (existingType) {
        return res.status(400).json({ success: false, message: `Vehicle type '${type}' already exists` });
      }
      vehicle.type = type.toLowerCase();
    }

    if (category) vehicle.category = category;
    if (displayName) vehicle.displayName = displayName;
    if (ratePerKm !== undefined) vehicle.ratePerKm = Number(ratePerKm);
    if (isActive !== undefined) vehicle.isActive = isActive === 'true' || isActive === true;

    const uploadedFiles = req.files || {};
    if (uploadedFiles.image && uploadedFiles.image.length > 0) {
      try {
        const imageUpload = await uploadFile(uploadedFiles.image, 'vehicle-types', 'Vehicle Image');
        vehicle.image = imageUpload;
      } catch (uploadErr) {
        return res.status(400).json({ success: false, message: uploadErr.message });
      }
    }

    await vehicle.save();

    res.json({ success: true, data: vehicle, message: 'Vehicle pricing updated successfully' });
  } catch (error) {
    console.error('Error updating vehicle pricing:', error);
    res.status(500).json({ success: false, message: 'Failed to update vehicle pricing' });
  }
};

export const deleteVehiclePricing = async (req, res) => {
  try {
    const { id } = req.params;
    const vehicle = await VehiclePricing.findByIdAndDelete(id);
    
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle pricing not found' });
    }

    res.json({ success: true, message: 'Vehicle pricing deleted successfully' });
  } catch (error) {
    console.error('Error deleting vehicle pricing:', error);
    res.status(500).json({ success: false, message: 'Failed to delete vehicle pricing' });
  }
};
