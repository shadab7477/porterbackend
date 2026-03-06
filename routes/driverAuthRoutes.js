import express from 'express';
import {
  sendOTP,
  verifyOTP,
  completeRegistration,
  getApplicationStatus,
  getDriverProfile,
  verifyDocument
} from '../controllers/driverAuthController.js';
import uploadMiddleware from '../middleware/uploadMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.get('/status/:phone', getApplicationStatus);

// Protected routes (require temp token)
router.post(
  '/register',
  driverAuthMiddleware,
  uploadMiddleware.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 },
    { name: 'vehicleRC', maxCount: 1 },
    { name: 'vehiclePhoto', maxCount: 1 }
  ]),
  completeRegistration
);

// Get driver profile (requires auth)
router.get('/profile', driverAuthMiddleware, getDriverProfile);

// Admin routes for document verification
router.post('/verify-document', verifyDocument);

export default router;