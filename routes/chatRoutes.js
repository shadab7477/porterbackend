// routes/chatRoutes.js
import express from 'express';
import {
  sendMessage,
  getChatHistory
} from '../controllers/chatController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

import jwt from 'jsonwebtoken';

// Unified auth for both driver and customer
const chatAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.decode(token);
    
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Check if it's a customer
    if (decoded.role === 'customer' || !decoded.type) {
      let isNextCalled = false;
      await customerAuthMiddleware(req, res, () => { isNextCalled = true; });
      if (isNextCalled && req.customerId) {
        req.userId = req.customerId.toString();
        req.userType = 'customer';
        return next();
      }
      return; // If next wasn't called, response was already sent by middleware
    } 
    // Check if it's a driver
    else if (decoded.type === 'driver_auth' || decoded.role === 'driver') {
      let isNextCalled = false;
      await driverAuthMiddleware(req, res, () => { isNextCalled = true; });
      if (isNextCalled && req.driver) {
        req.userId = req.driver.id.toString();
        req.userType = 'driver';
        return next();
      }
      return; // If next wasn't called, response was already sent by middleware
    }
    
    if (!res.headersSent) {
      res.status(401).json({ success: false, message: 'Authentication failed: Unknown role' });
    }
  } catch (error) {
    console.error('Chat auth error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Server error during authentication' });
    }
  }
};

// Apply auth to all routes
router.use(chatAuth);

// Chat endpoints
router.post('/message', sendMessage);
router.get('/history/:rideId', getChatHistory);

export default router;