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

    // Get driver/application from database if exists. During subscription
    // payment, the token id may refer to either the Driver or DriverApplication.
    let driver = null;
    let application = null;
    try {
      if (decoded.id) {
        driver = await Driver.findById(decoded.id).populate('applicationId');
        application = driver?.applicationId || null;

        if (!application) {
          application = await DriverApplication.findById(decoded.id);
        }
      }

      if (!application && decoded.phone) {
        application = await DriverApplication.findOne({ phone: decoded.phone });
      }
    } catch (err) {
      console.log('Driver/application not found or not yet created:', err.message);
    }
    
    // For registration and subscription routes, we don't require a Driver
    // document yet because payment can happen from the application flow.
    const isRegistrationRoute = req.path === '/register' || req.path === '/status/:phone';
    const isSubscriptionRoute = req.path.startsWith('/subscription/');
    
    if (!isRegistrationRoute && !isSubscriptionRoute && !driver) {
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
    if (!isRegistrationRoute && !isSubscriptionRoute && driver && application) {
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
      name: driver?.name || application?.fullName || null,
      isVerified: application?.verificationStatus === 'verified' || false,
      applicationId: application?._id || application || null
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
