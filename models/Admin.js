import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    default: 'admin'
  },
  password: {
    type: String,
    required: true,
    default: 'admin123'
  },
  role: {
    type: String,
    enum: ['admin', 'super_admin'],
    default: 'super_admin'
  },
  name: {
    type: String,
    default: 'Administrator'
  },
  email: {
    type: String,
    default: 'admin@logistics.com'
  },
  lastLogin: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

adminSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate JWT token
adminSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      id: this._id, 
      username: this.username,
      role: this.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );
};

// Compare password (plain text comparison for fixed credentials)
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return candidatePassword === this.password;
};

// Static method to initialize default admin
adminSchema.statics.initializeDefaultAdmin = async function() {
  try {
    const adminCount = await this.countDocuments();
    if (adminCount === 0) {
      await this.create({
        username: 'admin',
        password: 'admin123',
        role: 'super_admin',
        name: 'Administrator',
        email: 'admin@logistics.com'
      });
      console.log('✅ Default admin created: admin/admin123');
    }
  } catch (error) {
    console.error('Error initializing default admin:', error);
  }
};

const Admin = mongoose.model('Admin', adminSchema);

// Initialize default admin on module load
Admin.initializeDefaultAdmin();

export default Admin;