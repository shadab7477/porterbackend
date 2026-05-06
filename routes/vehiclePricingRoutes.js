import express from 'express';
import multer from 'multer';
import {
  getAllVehiclePricing,
  createVehiclePricing,
  updateVehiclePricing,
  deleteVehiclePricing
} from '../controllers/vehiclePricingController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public route for mobile app to fetch pricing
router.get('/', getAllVehiclePricing);

// Admin routes (Protected by authMiddleware)
router.post('/', authMiddleware, upload.fields([{ name: 'image', maxCount: 1 }]), createVehiclePricing);
router.put('/:id', authMiddleware, upload.fields([{ name: 'image', maxCount: 1 }]), updateVehiclePricing);
router.delete('/:id', authMiddleware, deleteVehiclePricing);

export default router;
