// middleware/authMiddleware.js - Update to set proper ID

import jwt from 'jsonwebtoken';

export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.split(' ')[1] 
      : authHeader;
    
    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = (decoded.role || decoded.type || '').toString().toLowerCase();
    const id = decoded.id || decoded._id || decoded.userId || decoded.adminId || decoded.customerId || decoded.driverId;
    
    // Store the appropriate ID based on token type
    if (
      role === 'admin' || 
      role === 'super_admin' || 
      role === 'admin_auth' || 
      role.includes('admin')
    ) {
      req.adminId = id;
      req.adminRole = decoded.role || 'admin';
      req.admin = { _id: id, id, role: req.adminRole, username: decoded.username, name: decoded.name || 'Admin' };
      console.log('🔐 Admin authenticated:', { adminId: req.adminId, role: req.adminRole });
    } 
    else if (role === 'driver' || role === 'driver_auth') {
      req.driver = { id, role: decoded.role || 'driver', phone: decoded.phone, name: decoded.name };
      console.log('🔐 Driver authenticated:', { driverId: req.driver.id });
    }
    else if (role === 'customer' || role === 'customer_auth') {
      req.customerId = id;
      req.customer = { _id: id, id, role: decoded.role || 'customer', phone: decoded.phone, name: decoded.name };
      console.log('🔐 Customer authenticated:', { customerId: req.customerId });
    }
    else {
      // Default - store as adminId for backward compatibility
      req.adminId = id;
      req.adminRole = decoded.role || 'admin';
      req.admin = { _id: id, id, role: req.adminRole, username: decoded.username, name: decoded.name || 'Admin' };
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
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.split(' ')[1] 
      : authHeader;
    
    if (token && token !== 'null' && token !== 'undefined') {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const role = (decoded.role || decoded.type || '').toString().toLowerCase();
      const id = decoded.id || decoded._id || decoded.userId || decoded.adminId || decoded.customerId || decoded.driverId;
      
      if (
        role === 'admin' || 
        role === 'super_admin' || 
        role === 'admin_auth' || 
        role.includes('admin')
      ) {
        req.adminId = id;
        req.adminRole = decoded.role || 'admin';
        req.admin = { _id: id, id, role: req.adminRole, username: decoded.username, name: decoded.name || 'Admin' };
      } 
      else if (role === 'driver' || role === 'driver_auth') {
        req.driver = { id, role: decoded.role || 'driver', phone: decoded.phone, name: decoded.name };
      }
      else if (role === 'customer' || role === 'customer_auth') {
        req.customerId = id;
        req.customer = { _id: id, id, role: decoded.role || 'customer', phone: decoded.phone, name: decoded.name };
      }
      else {
        req.adminId = id;
        req.adminRole = decoded.role || 'admin';
        req.admin = { _id: id, id, role: req.adminRole, username: decoded.username, name: decoded.name || 'Admin' };
      }
    }
    
    next();
  } catch (error) {
    // If token decoding fails, continue unauthenticated
    next();
  }
};