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
import { authMiddleware } from '../middleware/authMiddleware.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public routes (no auth)
router.get('/', getAllVehicles);
router.get('/active', getActiveVehicles);
router.get('/type/:type', getVehicleByType);
router.get('/:id', getVehicleById);
router.post('/calculate-fare', calculateFare);

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