import express from 'express';
import {
  getAllDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
  updateLocation,
  updateAvailability,
  getAvailableDrivers,
  submitForVerification,
  verifyDriver,
  rejectDriver,
  getPendingVerifications,
  toggleBlockDriver,
  updateDriverDocuments
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
router.patch('/:id/availability', updateAvailability);
router.post('/:id/verify', verifyDriver);
router.post('/:id/reject', rejectDriver);
router.post('/:id/submit-verification', submitForVerification);
router.patch('/:id/toggle-block', toggleBlockDriver);
router.patch('/:id/documents', updateDriverDocuments);

export default router;