import express from 'express';
import {
  createWithdrawalRequest,
  getMyWithdrawalRequests,
  cancelWithdrawalRequest,
  getAllWithdrawalRequests,
  getWithdrawalRequestById,
  approveWithdrawalRequest,
  markWithdrawalPaid,
  rejectWithdrawalRequest,
  getWithdrawalStats
} from '../controllers/customerWithdrawalController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// --- CUSTOMER ROUTES ---
// Customers must be authenticated
router.post('/request', customerAuthMiddleware, createWithdrawalRequest);
router.get('/my-requests', customerAuthMiddleware, getMyWithdrawalRequests);
router.post('/:id/cancel', customerAuthMiddleware, cancelWithdrawalRequest);

// --- ADMIN ROUTES ---
// Admins must be authenticated
router.get('/admin/stats', adminAuth, getWithdrawalStats);
router.get('/admin/all', adminAuth, getAllWithdrawalRequests);
router.get('/admin/:id', adminAuth, getWithdrawalRequestById);
router.put('/admin/:id/approve', adminAuth, approveWithdrawalRequest);
router.put('/admin/:id/mark-paid', adminAuth, markWithdrawalPaid);
router.put('/admin/:id/reject', adminAuth, rejectWithdrawalRequest);

export default router;
