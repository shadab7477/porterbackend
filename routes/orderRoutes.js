import express from 'express';
import {
  getAllOrders,
  getOrderById,
  createOrder,
  assignDriver,
  updateStatus,
  cancelOrder,
  getDriverOrders,
  getCustomerOrders,
  updateOrder,
  deleteOrder
} from '../controllers/orderController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getAllOrders);
router.get('/:id', getOrderById);
router.post('/', createOrder);
router.patch('/:id/assign', assignDriver);
router.patch('/:id/status', updateStatus);
router.patch('/:id/cancel', cancelOrder);
router.get('/driver/:driverId', getDriverOrders);
router.get('/customer/:customerId', getCustomerOrders);
router.put('/:id', updateOrder);
router.delete('/:id', deleteOrder);

export default router;