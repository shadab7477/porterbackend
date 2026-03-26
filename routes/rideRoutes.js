import express from 'express';
import Ride from '../models/Ride.js';
import {
  requestRide,
  acceptRide,
  rejectRide,
  driverArrived,
  startRide,
  completeRide,
  cancelRide,
  trackRide,
  getRideStatus,
  rateDriver,
  rateCustomer,
  getCustomerRideHistory,
  getDriverRideHistory,
  getNearbyDrivers,
  calculateFareEstimate,
  getDriverPendingRequests,
  getRideTrackingInfo,
} from '../controllers/rideController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';
import { validateCancelRide } from '../middleware/validateCancelRide.js';

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
router.get('/:rideId/tracking-info', authMiddleware, getRideTrackingInfo);

// ==================== DRIVER ROUTES ====================
router.get('/driver/pending-requests', driverAuthMiddleware, getDriverPendingRequests);
router.post('/accept', driverAuthMiddleware, acceptRide);
router.post('/reject', driverAuthMiddleware, rejectRide);
router.post('/arrived', driverAuthMiddleware, driverArrived);
router.post('/start', driverAuthMiddleware, startRide);
router.post('/complete', driverAuthMiddleware, completeRide);
router.get('/driver/history', driverAuthMiddleware, getDriverRideHistory);
router.post('/:rideId/rate-customer', driverAuthMiddleware, rateCustomer);

// ==================== SHARED ROUTES ====================
router.post('/:rideId/cancel', authMiddleware, validateCancelRide, cancelRide);
// router.get('/', authMiddleware, getAllRides);

export default router;