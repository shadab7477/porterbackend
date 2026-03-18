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

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(decoded);
    
    // Check token type
    if (decoded.type === 'driver_registration') {
      // For registration flow, just attach phone to request
      req.phone = decoded.phone;
      next();
    } 
    else if (decoded.type === 'driver_auth') {
      // For authenticated driver, fetch driver details
      const driver = await Driver.findById(decoded.id).select('-__v');
      
      if (!driver) {
        return res.status(401).json({
          success: false,
          message: 'Driver not found'
        });
      }
      
      if (driver.isBlocked) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been blocked. Please contact support.'
        });
      }
      
      req.driver = {
        id: driver._id,
        driverId: driver.driverId,
        phone: driver.phone,
        name: driver.name,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable
      };
      next();
    }
    else {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};


export default driverAuthMiddleware;