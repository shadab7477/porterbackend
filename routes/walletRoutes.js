import express from 'express';
import { getWalletBalance, addMoneyIntent, confirmAddMoney } from '../controllers/walletController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// ==================== CUSTOMER ROUTES ====================
router.get('/customer/balance', customerAuthMiddleware, getWalletBalance);
router.post('/customer/add-money', customerAuthMiddleware, addMoneyIntent);
router.post('/customer/confirm', customerAuthMiddleware, confirmAddMoney);

// ==================== DRIVER ROUTES ====================
router.get('/driver/balance', driverAuthMiddleware, getWalletBalance);
router.post('/driver/add-money', driverAuthMiddleware, addMoneyIntent);
router.post('/driver/confirm', driverAuthMiddleware, confirmAddMoney);

export default router;
