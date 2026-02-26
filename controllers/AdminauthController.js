import Admin from '../models/Admin.js';
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