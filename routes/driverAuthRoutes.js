import express from 'express';
import {
  sendOTP,
  verifyOTP,
  completeRegistration,
  getApplicationStatus,
  getDriverProfile,
  verifyDocument,
  driverLogin
} from '../controllers/driverAuthController.js';
import { 
  toggleMyOnlineStatus, 
  getMyOnlineStatus,
  updateLocation,
  getDriverStats
} from '../controllers/driverController.js';
import uploadMiddleware from '../middleware/uploadMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
// No authentication required

// OTP routes
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Check application status
router.get('/status/:phone', getApplicationStatus);

// Driver login (after approval)
router.post('/login', driverLogin);


// ==================== REGISTRATION ROUTES ====================
// Require temporary token from OTP verification

// Complete registration with documents
router.post(
  '/register',
  driverAuthMiddleware, // Verifies temp token
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


// ==================== AUTHENTICATED DRIVER ROUTES ====================
// Require valid driver authentication token (after approval)

// Get driver profile
router.get('/profile', driverAuthMiddleware, getDriverProfile);

// Online status management
router.post('/toggle-online', driverAuthMiddleware, toggleMyOnlineStatus);
router.get('/online-status', driverAuthMiddleware, getMyOnlineStatus);

// Location updates
router.post('/location', driverAuthMiddleware, updateLocation);

// Driver stats
router.get('/stats', driverAuthMiddleware, getDriverStats);


// ==================== ADMIN ROUTES ====================
// Should be protected with admin middleware

router.post('/verify-document', verifyDocument);

export default router;