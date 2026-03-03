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

router.use(authMiddleware);

router.get('/', getAllVehicles);
router.get('/active', getActiveVehicles);
router.get('/type/:type', getVehicleByType);
router.get('/:id', getVehicleById);
router.post('/', createVehicle);
router.put('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);
router.post('/calculate-fare', calculateFare);

// Image routes - Single image only
router.post(
  '/:id/image',
  upload.single('image'),
  handleMulterError,
  uploadVehicleImage
);
router.delete('/:id/image', deleteVehicleImage);

export default router;