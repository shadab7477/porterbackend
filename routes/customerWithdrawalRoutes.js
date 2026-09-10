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
import { verifyToken, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// --- CUSTOMER ROUTES ---
// Customers must be authenticated
router.post('/request', verifyToken, createWithdrawalRequest);
router.get('/my-requests', verifyToken, getMyWithdrawalRequests);
router.post('/:id/cancel', verifyToken, cancelWithdrawalRequest);

// --- ADMIN ROUTES ---
// Admins must be authenticated
router.get('/admin/stats', verifyAdmin, getWithdrawalStats);
router.get('/admin/all', verifyAdmin, getAllWithdrawalRequests);
router.get('/admin/:id', verifyAdmin, getWithdrawalRequestById);
router.put('/admin/:id/approve', verifyAdmin, approveWithdrawalRequest);
router.put('/admin/:id/mark-paid', verifyAdmin, markWithdrawalPaid);
router.put('/admin/:id/reject', verifyAdmin, rejectWithdrawalRequest);

export default router;
