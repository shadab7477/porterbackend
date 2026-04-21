import Admin from '../models/Admin.js';
import RestrictedItem from '../models/RestrictedItem.js';
import GoodsItem from '../models/GoodsItem.js';
import jwt from 'jsonwebtoken';

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }
    
    // Find admin by username
    const admin = await Admin.findOne({ username });
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check password
    const isMatch = await admin.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Update last login
    admin.lastLogin = new Date();
    await admin.save();
    
    // Generate token
    const token = admin.generateAuthToken();
    
    console.log('Login successful for admin:', admin.username, 'ID:', admin._id); // Debug log
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        admin: {
          id: admin._id,
          username: admin.username,
          name: admin.name,
          role: admin.role,
          email: admin.email
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

export const getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminId).select('-password');
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const logout = async (req, res) => {
  // In a more complex system, you might want to blacklist the token
  // For now, we just return success and let the client clear the token
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

// Initialize default admin on first run
export const initializeAdmin = async () => {
  try {
    const count = await Admin.countDocuments();
    if (count === 0) {
      const admin = await Admin.create({
        username: 'admin',
        password: 'admin123',
        role: 'super_admin',
        name: 'Administrator',
        email: 'admin@logistics.com'
      });
      console.log('✅ Default admin created: admin/admin123');
      console.log('Admin ID:', admin._id);
    }
  } catch (error) {
    console.error('Error initializing admin:', error);
  }
};

// Upload restricted items list
export const uploadRestrictedItems = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileContent = req.file.buffer.toString('utf-8');
    let items = [];

    if (req.file.mimetype === 'application/json' || req.file.originalname.endsWith('.json')) {
      items = JSON.parse(fileContent);
    } else if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      // Simple CSV parsing (assuming headers: name,category,description,isRestricted)
      const lines = fileContent.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length >= headers.length) {
          const item = {};
          headers.forEach((header, index) => {
            if (header === 'isrestricted') {
              item.isRestricted = values[index].toLowerCase() === 'true';
            } else {
              item[header] = values[index];
            }
          });
          items.push(item);
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Please upload JSON or CSV file.'
      });
    }

    // Validate items
    const validItems = [];
    for (const item of items) {
      if (item.name && item.category) {
        validItems.push({
          name: item.name,
          category: item.category,
          description: item.description || '',
          isRestricted: item.isRestricted !== undefined ? item.isRestricted : true,
          createdBy: req.adminId
        });
      }
    }

    if (validItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items found in the file'
      });
    }

    // Save items to database
    const savedItems = await RestrictedItem.insertMany(validItems);

    res.json({
      success: true,
      message: `Successfully uploaded ${savedItems.length} restricted items`,
      data: {
        uploaded: savedItems.length,
        items: savedItems
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during upload'
    });
  }
};

// Get all restricted items
export const getRestrictedItems = async (req, res) => {
  try {
    const items = await RestrictedItem.find().populate('createdBy', 'name username').sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Delete a restricted item
export const deleteRestrictedItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await RestrictedItem.findByIdAndDelete(id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Item deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Upload goods items list
export const uploadGoodsItems = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fileContent = req.file.buffer.toString('utf-8');
    let items = [];

    if (req.file.mimetype === 'application/json' || req.file.originalname.endsWith('.json')) {
      items = JSON.parse(fileContent);
    } else if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      // Simple CSV parsing (assuming headers: name,category,description,maxWeight,length,width,height,isActive)
      const lines = fileContent.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length >= headers.length) {
          const item = {};
          headers.forEach((header, index) => {
            if (header === 'isactive') {
              item.isActive = values[index].toLowerCase() === 'true';
            } else if (header === 'maxweight') {
              item.maxWeight = parseFloat(values[index]) || null;
            } else if (['length', 'width', 'height'].includes(header)) {
              if (!item.maxDimensions) item.maxDimensions = {};
              item.maxDimensions[header] = parseFloat(values[index]) || null;
            } else {
              item[header] = values[index];
            }
          });
          items.push(item);
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Please upload JSON or CSV file.'
      });
    }

    // Validate items
    const validItems = [];
    for (const item of items) {
      if (item.name && item.category) {
        validItems.push({
          name: item.name,
          category: item.category,
          description: item.description || '',
          maxWeight: item.maxWeight || null,
          maxDimensions: item.maxDimensions || {},
          isActive: item.isActive !== undefined ? item.isActive : true,
          createdBy: req.adminId
        });
      }
    }

    if (validItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items found in the file'
      });
    }

    // Save items to database
    const savedItems = await GoodsItem.insertMany(validItems);

    res.json({
      success: true,
      message: `Successfully uploaded ${savedItems.length} goods items`,
      data: {
        uploaded: savedItems.length,
        items: savedItems
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during upload'
    });
  }
};

// Get all goods items
export const getGoodsItems = async (req, res) => {
  try {
    const items = await GoodsItem.find().populate('createdBy', 'name username').sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Delete a goods item
export const deleteGoodsItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    const item = await GoodsItem.findByIdAndDelete(id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Item deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update goods item status
export const updateGoodsItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const item = await GoodsItem.findByIdAndUpdate(
      id,
      { isActive, updatedAt: new Date() },
      { new: true }
    );
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Item status updated successfully',
      data: item
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};