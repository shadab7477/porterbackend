import express from 'express';
import { createPaymentIntent, confirmPayment, getPaymentStatus } from '../controllers/paymentController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';

const router = express.Router();

// All payment routes require customer authentication
router.post('/create-intent', customerAuthMiddleware, createPaymentIntent);
router.post('/confirm', customerAuthMiddleware, confirmPayment);
router.get('/:rideId/status', customerAuthMiddleware, getPaymentStatus);

export default router;
