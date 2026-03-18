import express from 'express';
import {
  requestRide,
  acceptRide,
  rejectRide,
  driverArrived,
  startRide,
  completeRide,
  cancelRide,
  updateRideLocation,
  trackRide,
  getRideStatus,
  rateDriver,
  rateCustomer,
  getCustomerRideHistory,
  getDriverRideHistory,
  getNearbyDrivers,
  calculateFareEstimate,
  getDriverPendingRequests,
  updateDriverLocation  // Add this import
} from '../controllers/rideController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
router.get('/nearby-drivers', getNearbyDrivers);
router.get('/fare-estimate', calculateFareEstimate);

// ==================== CUSTOMER ROUTES ====================
router.post('/request', customerAuthMiddleware, requestRide);
router.get('/history', customerAuthMiddleware, getCustomerRideHistory);
router.get('/:rideId/status', customerAuthMiddleware, getRideStatus);
router.get('/:rideId/track', customerAuthMiddleware, trackRide);
router.post('/:rideId/rate-driver', customerAuthMiddleware, rateDriver);

// ==================== DRIVER ROUTES ====================
router.get('/driver/pending-requests', driverAuthMiddleware, getDriverPendingRequests);  // Add this route
// In your routes file (e.g., driverRoutes.js)
router.post('/update-location', driverAuthMiddleware, updateDriverLocation);
router.post('/accept', driverAuthMiddleware, acceptRide);
router.post('/reject', driverAuthMiddleware, rejectRide);
router.post('/arrived', driverAuthMiddleware, driverArrived);
router.post('/start', driverAuthMiddleware, startRide);
router.post('/complete', driverAuthMiddleware, completeRide);
router.post('/location', driverAuthMiddleware, updateRideLocation);
router.get('/driver/history', driverAuthMiddleware, getDriverRideHistory);
router.post('/:rideId/rate-customer', driverAuthMiddleware, rateCustomer);

// ==================== SHARED ROUTES ====================
router.post('/:rideId/cancel', authMiddleware, cancelRide);

export default router;