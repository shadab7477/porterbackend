import express from 'express';
import {
  createBooking,
  confirmDeposit,
  getAdminBookings,
  assignDriver,
  updateBookingStatus
} from '../controllers/packerBookingController.js';

import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';

const router = express.Router();

router.post('/book', customerAuthMiddleware, createBooking);
router.post('/:id/payment-webhook', confirmDeposit);
router.get('/admin/pending', getAdminBookings);
router.patch('/admin/:id/assign', assignDriver);
router.patch('/:id/status', updateBookingStatus);

export default router;
