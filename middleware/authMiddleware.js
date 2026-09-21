// middleware/authMiddleware.js - Update to set proper ID

import jwt from 'jsonwebtoken';

export const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // FIX: Store the appropriate ID based on token type
    if (decoded.role === 'admin' || decoded.role === 'admin_auth') {
      req.adminId = decoded.id;
      req.adminRole = decoded.role;
      console.log('🔐 Admin authenticated:', { adminId: req.adminId, role: decoded.role });
    } 
    else if (decoded.role === 'driver' || decoded.type === 'driver_auth') {
      req.driver = { id: decoded.id, role: decoded.role };
      console.log('🔐 Driver authenticated:', { driverId: req.driver.id });
    }
    else if (decoded.role === 'customer' || decoded.role === 'customer_auth') {
      req.customerId = decoded.id;
      console.log('🔐 Customer authenticated:', { customerId: req.customerId });
    }
    else {
      // Default - store as adminId for backward compatibility
      req.adminId = decoded.id;
      req.adminRole = decoded.role;
      console.log('🔐 User authenticated:', { id: req.adminId, role: decoded.role });
    }
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired. Please login again.' 
      });
    }
    
    console.error('❌ Auth error:', error.message);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.role === 'admin' || decoded.role === 'admin_auth') {
        req.adminId = decoded.id;
        req.adminRole = decoded.role;
      } 
      else if (decoded.role === 'driver' || decoded.type === 'driver_auth') {
        req.driver = { id: decoded.id, role: decoded.role };
      }
      else if (decoded.role === 'customer' || decoded.role === 'customer_auth') {
        req.customerId = decoded.id;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};