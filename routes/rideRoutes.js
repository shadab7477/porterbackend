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
  updateRideStatus,
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
  updateDriverLocation,
  getDriverLocationForTracking,
  getRideTrackingInfo,
  acceptRideWithSocket,
  updateDriverLocationWithSocket,
  verifyRidePayment
} from '../controllers/rideController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import driverAuthMiddleware from '../middleware/driverAuthMiddleware.js';

import { validateCancelRide } from '../middleware/validateCancelRide.js';
export const getAllRides = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const query = {};
    if (status) query.status = status;

    if (search) {
      query['$or'] = [
        { rideId: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.phone': { $regex: search, $options: 'i' } },
        { 'driver.name': { $regex: search, $options: 'i' } },
        { 'driver.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const rides = await Ride.find(query)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Ride.countDocuments(query);

    res.json({
      success: true,
      data: rides,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all rides error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get rides'
    });
  }
};

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
router.get('/nearby-drivers', getNearbyDrivers);
router.get('/fare-estimate', calculateFareEstimate);

// ==================== CUSTOMER ROUTES ====================
router.post('/request', customerAuthMiddleware, requestRide);
router.post('/:rideId/verify-payment', customerAuthMiddleware, verifyRidePayment);
router.get('/history', customerAuthMiddleware, getCustomerRideHistory);
router.get('/:rideId/status', authMiddleware, getRideStatus);
router.get('/:rideId/track', customerAuthMiddleware, trackRide);
router.post('/:rideId/rate-driver', customerAuthMiddleware, rateDriver);
// Add these routes to your existing rideRoutes.js
// Add this route
router.post('/update-location-socket', driverAuthMiddleware, updateDriverLocationWithSocket);
// Customer tracking routes
router.get('/:rideId/driver-location', customerAuthMiddleware, getDriverLocationForTracking);
router.get('/:rideId/tracking-info', authMiddleware, getRideTrackingInfo);

// Enhanced driver routes (replace existing ones if you want to use socket version)
router.post('/accept-with-socket', driverAuthMiddleware, acceptRideWithSocket);
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
router.post('/:rideId/cancel', authMiddleware, validateCancelRide, cancelRide);
router.patch('/:rideId/status', authMiddleware, updateRideStatus);
router.get('/', authMiddleware, getAllRides);

export default router;
