import express from 'express';
import {
  getAllDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
  updateLocation,
  getAvailableDrivers,
  submitForVerification,
  verifyDriver,
  rejectDriver,
  getPendingVerifications,
  toggleBlockDriver,
  updateDriverDocuments,
  toggleDriverActive
} from '../controllers/driverController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getAllDrivers);
router.get('/available', getAvailableDrivers);
router.get('/pending-verification', getPendingVerifications);
router.get('/:id', getDriverById);
router.post('/', createDriver);
router.put('/:id', updateDriver);
router.delete('/:id', deleteDriver);
router.patch('/:id/location', updateLocation);
router.post('/:id/verify', verifyDriver);
router.post('/:id/reject', rejectDriver);
router.post('/:id/submit-verification', submitForVerification);
router.patch('/:id/toggle-block', toggleBlockDriver);
router.patch('/:id/documents', updateDriverDocuments);
router.patch('/:id/active', toggleDriverActive);

router.post('/test-create', async (req, res) => {
  try {
    const Driver = (await import('../models/Driver.js')).default;
    const { name, phone, vehicleType, vehicleNumber } = req.body;
    const driver = new Driver({
      name: name || 'Test Driver',
      phone: phone || '9999999999',
      vehicleType: vehicleType || 'bike',
      vehicleNumber: vehicleNumber || 'TEST' + Date.now(),
      isActive: true,
      isOnline: false,
      isAvailable: true,
      verificationStatus: 'verified',
      isVerified: true
    });
    await driver.save();
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;