import express from 'express';
import {
    createPaymentOrder,  // Changed from createPaymentIntent
    verifyPayment,       // Changed from confirmPayment
    getPaymentStatus,
    getPaymentHistory,   // Added for wallet and other payment history
    handleRazorpayWebhook
} from '../controllers/paymentController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';

const router = express.Router();

// Public webhook endpoint (no auth required)
router.post('/webhook/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

// All payment routes require customer authentication
router.post('/create-order', customerAuthMiddleware, createPaymentOrder);     // Changed from create-intent
router.post('/verify', customerAuthMiddleware, verifyPayment);                 // Changed from confirm
router.get('/history', customerAuthMiddleware, getPaymentHistory);             // New wallet & ride history endpoint
router.get('/:rideId/status', customerAuthMiddleware, getPaymentStatus);

export default router;