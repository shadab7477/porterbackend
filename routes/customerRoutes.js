import express from 'express';
import {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  toggleBlockStatus,
  searchByPhone,
  getCustomerStats
} from '../controllers/customerController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Stats route (must be before /:id route)
router.get('/stats', getCustomerStats);

// Search by phone
router.get('/search/:phone', searchByPhone);

// Main CRUD routes
router.get('/', getAllCustomers);
router.get('/:id', getCustomerById);
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.patch('/:id/toggle-block', toggleBlockStatus);

export default router;