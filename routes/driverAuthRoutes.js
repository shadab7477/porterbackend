import express from 'express';
import {
  sendOTP,
  verifyOTP,
  completeRegistration,
  getApplicationStatus,
  getDriverProfile,
  verifyDocument,
  driverLogin,
  driverLogout,
  refreshToken
} from '../controllers/driverAuthController.js';
import {
  getSubscriptionFee,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  getSubscriptionStatus
} from '../controllers/driverSubscriptionController.js';
import { 
  toggleMyOnlineStatus, 
  getMyOnlineStatus,
  updateLocation,
  getDriverStats
} from '../controllers/driverController.js';
import uploadMiddleware from '../middleware/uploadMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
// No authentication required

// OTP routes
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Check application status (public)
router.get('/status/:phone', getApplicationStatus);

// Driver login (explicit login for verified drivers)
router.post('/login', driverLogin);


// ==================== REGISTRATION ROUTES ====================
// Require token from OTP verification

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
    { name: 'vehiclePhoto', maxCount: 1 },
    { name: 'hiredDriverLicense', maxCount: 1 },  // optional — only if hasHiredDriver=true
  ]),
  completeRegistration
);


// ==================== AUTHENTICATED DRIVER ROUTES ====================
// Require valid driver authentication token

// Auth management
router.post('/logout', driverAuthMiddleware, driverLogout);
router.post('/refresh-token', driverAuthMiddleware, refreshToken);

// Profile
router.get('/profile', driverAuthMiddleware, getDriverProfile);

// Online status
router.post('/toggle-online', driverAuthMiddleware, toggleMyOnlineStatus);
router.get('/online-status', driverAuthMiddleware, getMyOnlineStatus);

// Location
router.post('/location', driverAuthMiddleware, updateLocation);

// Stats
router.get('/stats', driverAuthMiddleware, getDriverStats);


// ==================== SUBSCRIPTION PAYMENT ROUTES ====================
// GET  /api/driver/subscription/fee?vehicleType=Bike  (public)
// POST /api/driver/subscription/create-order          (driver auth)
// POST /api/driver/subscription/verify                (driver auth)
// GET  /api/driver/subscription/status/:applicationId (driver auth)

router.get('/subscription/fee', getSubscriptionFee);
router.post('/subscription/create-order', driverAuthMiddleware, createSubscriptionOrder);
router.post('/subscription/verify', driverAuthMiddleware, verifySubscriptionPayment);
router.get('/subscription/status/:applicationId?', driverAuthMiddleware, getSubscriptionStatus);


// ==================== ADMIN ROUTES ====================
// Protected with admin middleware

router.post('/verify-document', adminAuth, verifyDocument);

export default router;