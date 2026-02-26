import jwt from 'jsonwebtoken';
import Driver from '../models/Driver.js'; // Make sure this path is correct

const driverAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if this is a driver token (has id field)
    if (!decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    const driver = await Driver.findById(decoded.id).select('-password');

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is active/verified
    if (driver.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Driver account is not verified',
        status: driver.verificationStatus
      });
    }

    // Optional: check if blocked (if you have this field)
    if (driver.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Driver account is blocked'
      });
    }

    req.driver = driver;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export default driverAuthMiddleware;