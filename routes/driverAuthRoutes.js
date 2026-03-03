import express from 'express';
import {
  sendOTP,
  verifyOTP,
  registerBasicInfo,
  uploadDocument,
  saveVehicleDetails,
  saveBankDetails,
  submitApplication,
  getApplicationStatus,
  getDriverProfile,
  updateDocument
} from '../controllers/driverAuthController.js';
import uploadMiddleware from '../middleware/uploadMiddleware.js'; // This imports the default export
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// Public routes (no auth required)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.get('/status/:phone', getApplicationStatus);

// Routes that require temp token (registration flow)
router.post('/register', registerBasicInfo);
router.post('/upload/:documentType', uploadMiddleware.single('document'), uploadDocument); // Add .single('document')
router.post('/vehicle-details', saveVehicleDetails);
router.post('/bank-details', saveBankDetails);
router.post('/submit', submitApplication);

// Routes that require full auth (after registration)
router.get('/profile', driverAuthMiddleware, getDriverProfile);
router.put('/update-document/:documentType', driverAuthMiddleware, uploadMiddleware.single('document'), updateDocument); // Add .single('document')

export default router;