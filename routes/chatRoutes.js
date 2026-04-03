// routes/chatRoutes.js
import express from 'express';
import {
  sendMessage,
  getChatHistory
} from '../controllers/chatController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// Unified auth for both driver and customer
const chatAuth = async (req, res, next) => {
  // Try driver auth
  if (req.headers.authorization) {
    try {
      await driverAuthMiddleware(req, res, () => {});
      if (req.driver) {
        req.userId = req.driver.id;
        req.userType = 'driver';
        return next();
      }
    } catch (e) {
      // Not a driver
    }
    
    // Try customer auth
    try {
      await customerAuthMiddleware(req, res, () => {});
      if (req.customerId) {
        req.userId = req.customerId;
        req.userType = 'customer';
        return next();
      }
    } catch (e) {
      // Not a customer
    }
  }
  
  res.status(401).json({
    success: false,
    message: 'Authentication required'
  });
};

// Apply auth to all routes
router.use(chatAuth);

// Chat endpoints
router.post('/message', sendMessage);
router.get('/history/:rideId', getChatHistory);

export default router;