import express from 'express';
import {
  createShiftingRequest,
  getAllShiftingRequests,
  updateShiftingRequestStatus,
  deleteShiftingRequest
} from '../controllers/shiftingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public route — no auth needed (customer form submission)
router.post('/', createShiftingRequest);

// Admin routes — auth required
router.get('/', authMiddleware, getAllShiftingRequests);
router.patch('/:id/status', authMiddleware, updateShiftingRequestStatus);
router.delete('/:id', authMiddleware, deleteShiftingRequest);

export default router;
