import express from 'express';
import { getWalletBalance, createWalletOrder, verifyWalletPayment, requestWithdrawal, requestCustomerWithdrawal } from '../controllers/walletController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// ==================== CUSTOMER ROUTES ====================
router.get('/customer/balance', customerAuthMiddleware, getWalletBalance);
router.post('/customer/create-order', customerAuthMiddleware, createWalletOrder);
router.post('/customer/verify', customerAuthMiddleware, verifyWalletPayment);
router.post('/customer/withdraw', customerAuthMiddleware, requestCustomerWithdrawal);

// ==================== DRIVER ROUTES ====================
router.get('/driver/balance', driverAuthMiddleware, getWalletBalance);
router.post('/driver/create-order', driverAuthMiddleware, createWalletOrder);
router.post('/driver/verify', driverAuthMiddleware, verifyWalletPayment);
router.post('/driver/withdraw', driverAuthMiddleware, requestWithdrawal);

export default router;
