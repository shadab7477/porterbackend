import express from 'express';
import {
  getPublicFAQs,
  getAllFAQs,
  createFAQ,
  updateFAQ,
  deleteFAQ
} from '../controllers/faqController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public — no auth needed
router.get('/public', getPublicFAQs);

// Admin routes — auth required
router.get('/', authMiddleware, getAllFAQs);
router.post('/', authMiddleware, createFAQ);
router.put('/:id', authMiddleware, updateFAQ);
router.delete('/:id', authMiddleware, deleteFAQ);

export default router;
