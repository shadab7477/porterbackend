import express from 'express';
import {
    createPaymentOrder,
    verifyPayment,
    getPaymentStatus,
    getPaymentHistory,
    handleRazorpayWebhook,
    createReceiverPaymentOrder,
    verifyReceiverPayment,
    payWithWallet
} from '../controllers/paymentController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// Public webhook endpoint (no auth required)
router.post('/webhook/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

// All payment routes require customer authentication
router.post('/create-order', customerAuthMiddleware, createPaymentOrder);
router.post('/verify', customerAuthMiddleware, verifyPayment);
router.post('/wallet/pay', customerAuthMiddleware, payWithWallet);   // Instant wallet deduction
router.get('/history', customerAuthMiddleware, getPaymentHistory);
router.get('/:rideId/status', customerAuthMiddleware, getPaymentStatus);

// Driver collects payment from receiver at drop location
router.post('/receiver/create-order', driverAuthMiddleware, createReceiverPaymentOrder);
router.post('/receiver/verify', driverAuthMiddleware, verifyReceiverPayment);

export default router;