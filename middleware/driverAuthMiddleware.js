import jwt from 'jsonwebtoken';
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';

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

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log(decoded);
      
      // Check if this is a driver token (has id field) - for authenticated drivers
      if (decoded.id) {
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

        // Check if blocked
        if (driver.isBlocked) {
          return res.status(403).json({
            success: false,
            message: 'Driver account is blocked'
          });
        }

        req.driver = driver;
        req.userType = 'driver';
        return next();
      }
      
      // Check if this is a registration token (has phone and type field)
      if (decoded.phone && decoded.type === 'driver_registration') {
        // Verify that the phone has an application in progress
        const application = await DriverApplication.findOne({ phone: decoded.phone });
        console.log(application);
        
        // if (!application) {
        //   return res.status(401).json({
        //     success: false,
        //     message: 'No registration found for this token'
        //   });
        // }

        // if (application.verificationStatus === 'verified' || 
        //     application.verificationStatus === 'submitted') {
        //   return res.status(403).json({
        //     success: false,
        //     message: 'Registration already completed. Please login instead.',
        //     status: application.verificationStatus
        //   });
        // }

        req.phone = decoded.phone;
        // req.application = application;
        req.userType = 'registration';
        return next();
      }

      // If token doesn't match either format
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });

    } catch (jwtError) {
      console.error('JWT verification error:', jwtError);

      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }

      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired'
        });
      }

      throw jwtError;
    }

  } catch (error) {
    console.error('Auth middleware error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export default driverAuthMiddleware;