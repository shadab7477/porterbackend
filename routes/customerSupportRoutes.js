import express from 'express';
import {
  getMyTickets,
  createTicket,
  getTicket,
  addMessage,
  getStats
} from '../controllers/customerSupportController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';

const router = express.Router();

// All routes require customer authentication
router.use(customerAuthMiddleware);

router.get('/tickets', getMyTickets);
router.get('/tickets/stats', getStats);
router.get('/tickets/:id', getTicket);
router.post('/tickets', createTicket);
router.post('/tickets/:id/messages', addMessage);

export default router;