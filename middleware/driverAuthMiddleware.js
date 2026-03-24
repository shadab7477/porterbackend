import jwt from 'jsonwebtoken';
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';

const driverAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    // Extract token - handle both "Bearer token" and just "token" formats
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token not provided'
      });
    }

    console.log('Token received:', token.substring(0, 20) + '...'); // Log first 20 chars for debugging

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    // Check if token type is driver_auth
    if (decoded.type !== 'driver_auth') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Get driver from database if exists (for registration routes, driver might not exist yet)
    let driver = null;
    try {
      if (decoded.id) {
        driver = await Driver.findById(decoded.id).populate('applicationId');
      }
    } catch (err) {
      console.log('Driver not found or not yet created:', err.message);
    }
    
    // For registration routes, we don't require driver to exist in DB
    const isRegistrationRoute = req.path === '/register' || req.path === '/status/:phone';
    
    if (!isRegistrationRoute && !driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found. Please complete registration first.'
      });
    }

    // Check if driver is blocked (only if driver exists)
    if (driver && driver.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Please contact support.'
      });
    }

    // For protected routes (non-registration), check if driver is verified
    if (!isRegistrationRoute && driver && driver.applicationId) {
      const application = driver.applicationId;
      if (application.verificationStatus !== 'verified') {
        return res.status(403).json({
          success: false,
          message: 'Driver not verified. Please complete registration and wait for verification.'
        });
      }
    }

    // Attach driver and decoded info to request
    req.driver = {
      id: decoded.id || null,
      phone: decoded.phone,
      name: driver?.name || null,
      isVerified: driver?.applicationId?.verificationStatus === 'verified' || false
    };
    
    // Also attach decoded token for registration routes that need phone number
    req.decoded = decoded;
    
    next();
  } catch (error) {
    console.error('Driver auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Please verify OTP again.',
        error: error.message
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

export default driverAuthMiddleware;