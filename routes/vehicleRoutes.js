import express from 'express';
import {
  getAllVehicles,
  getVehicleById,
  getVehicleByType,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  calculateFare,
  getActiveVehicles,
  uploadVehicleImage,
  deleteVehicleImage
} from '../controllers/vehicleController.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public routes (auth optional for merchant check)
router.get('/', optionalAuthMiddleware, getAllVehicles);
router.get('/active', optionalAuthMiddleware, getActiveVehicles);
router.get('/type/:type', getVehicleByType);
router.get('/:id', getVehicleById);
router.post('/calculate-fare', optionalAuthMiddleware, calculateFare);

// Protected routes (auth required)
router.post('/', authMiddleware, createVehicle);
router.put('/:id', authMiddleware, updateVehicle);
router.delete('/:id', authMiddleware, deleteVehicle);

// Image routes (protected)
router.post(
  '/:id/image/:index',
  authMiddleware,
  upload.single('image'),
  handleMulterError,
  uploadVehicleImage
);

router.delete('/:id/image/:index', authMiddleware, deleteVehicleImage);

export default router;