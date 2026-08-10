import express from 'express';
import {
  getWalletBalance,
  createWalletOrder,
  verifyWalletPayment,
  requestWithdrawal,
  requestCustomerWithdrawal,
  getCustomerBankDetails,
  updateCustomerBankDetails,
  deleteCustomerBankDetails,
  getAdminWithdrawals,
  approveWithdrawal,
  rejectWithdrawal
} from '../controllers/walletController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.adminId) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

// ==================== CUSTOMER ROUTES ====================
router.get('/customer/balance', customerAuthMiddleware, getWalletBalance);
router.post('/customer/create-order', customerAuthMiddleware, createWalletOrder);
router.post('/customer/verify', customerAuthMiddleware, verifyWalletPayment);
router.get('/customer/bank-details', customerAuthMiddleware, getCustomerBankDetails);
router.put('/customer/bank-details', customerAuthMiddleware, updateCustomerBankDetails);
router.delete('/customer/bank-details', customerAuthMiddleware, deleteCustomerBankDetails);
router.post('/customer/withdraw', customerAuthMiddleware, requestCustomerWithdrawal);

// ==================== DRIVER ROUTES ====================
router.get('/driver/balance', driverAuthMiddleware, getWalletBalance);
router.post('/driver/create-order', driverAuthMiddleware, createWalletOrder);
router.post('/driver/verify', driverAuthMiddleware, verifyWalletPayment);
router.post('/driver/withdraw', driverAuthMiddleware, requestWithdrawal);

// ==================== ADMIN ROUTES ====================
router.get('/admin/withdrawals', authMiddleware, adminOnly, getAdminWithdrawals);
router.post('/admin/withdrawals/:id/approve', authMiddleware, adminOnly, approveWithdrawal);
router.post('/admin/withdrawals/:id/reject', authMiddleware, adminOnly, rejectWithdrawal);

export default router;
