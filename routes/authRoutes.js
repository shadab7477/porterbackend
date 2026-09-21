import express from 'express';
import { login, getMe, logout } from '../controllers/AdminauthController.js';
import { 
  sendOtp, 
  verifyOtp, 
  resendOtp,
  getCustomerProfile,
  updateCustomerProfile,
  customerLogout 
} from '../controllers/mobileAuthController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';

const router = express.Router();

// Admin routes
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

// Mobile OTP routes (for customer app)
router.post('/mobile/send-otp', sendOtp);
router.post('/mobile/verify-otp', verifyOtp);
router.post('/mobile/resend-otp', resendOtp);
router.get('/mobile/profile', customerAuthMiddleware, getCustomerProfile);
router.put('/mobile/profile', customerAuthMiddleware, updateCustomerProfile);
router.post('/mobile/logout', customerAuthMiddleware, customerLogout);

export default router;