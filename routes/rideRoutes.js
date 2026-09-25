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
    const {
      page = 1,
      limit = 20,
      status,
      search,
      pickupLocation,
      dropLocation,
      startDate,
      endDate,
      datePreset,
      vehicleType,
      paymentStatus,
      paymentMethod,
      minFare,
      maxFare,
      tab
    } = req.query;

    const query = {};

    // Tab filter
    const activeRideStatuses = ['requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'no_drivers'];
    if (tab === 'active') {
      query.status = { $in: activeRideStatuses };
    } else if (tab === 'completed') {
      query.status = 'completed';
    } else if (tab === 'cancelled') {
      query.status = { $in: ['cancelled', 'no_drivers'] };
    } else if (status) {
      query.status = status;
    }

    // Advanced search
    if (search && search.trim()) {
      const cleanSearch = search.trim();
      const searchRegex = { $regex: cleanSearch, $options: 'i' };
      query['$or'] = [
        { rideId: searchRegex },
        { 'customer.name': searchRegex },
        { 'customer.phone': searchRegex },
        { 'driver.name': searchRegex },
        { 'driver.phone': searchRegex },
        { 'driver.vehicleNumber': searchRegex },
        { 'driver.vehicleType': searchRegex },
        { 'pickupLocation.address': searchRegex },
        { 'dropLocation.address': searchRegex },
        { 'dropLocations.address': searchRegex },
        { 'receiver.name': searchRegex },
        { 'receiver.phone': searchRegex }
      ];
    }

    // Location filters
    if (pickupLocation && pickupLocation.trim()) {
      query['pickupLocation.address'] = { $regex: pickupLocation.trim(), $options: 'i' };
    }
    if (dropLocation && dropLocation.trim()) {
      const dropRegex = { $regex: dropLocation.trim(), $options: 'i' };
      query['$and'] = query['$and'] || [];
      query['$and'].push({
        $or: [
          { 'dropLocation.address': dropRegex },
          { 'dropLocations.address': dropRegex }
        ]
      });
    }

    // Vehicle Type
    if (vehicleType && vehicleType.trim()) {
      const vRegex = { $regex: vehicleType.trim(), $options: 'i' };
      query['$or'] = query['$or'] || [];
      query['$or'].push(
        { requestedVehicleType: vRegex },
        { 'driver.vehicleType': vRegex }
      );
    }

    // Payment filters
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    // Fare range
    if (minFare || maxFare) {
      query['$or'] = query['$or'] || [];
      const fareCondition = {};
      if (minFare) fareCondition.$gte = parseFloat(minFare);
      if (maxFare) fareCondition.$lte = parseFloat(maxFare);
      query['fare.finalAmount'] = fareCondition;
    }

    // Date filters
    const dateQuery = {};
    if (datePreset) {
      const now = new Date();
      if (datePreset === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        dateQuery.$gte = start;
        dateQuery.$lte = end;
      } else if (datePreset === 'yesterday') {
        const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
        dateQuery.$gte = yStart;
        dateQuery.$lte = yEnd;
      } else if (datePreset === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateQuery.$gte = weekAgo;
      } else if (datePreset === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateQuery.$gte = monthAgo;
      }
    }

    if (startDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      dateQuery.$gte = s;
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      dateQuery.$lte = e;
    }

    if (Object.keys(dateQuery).length > 0) {
      query.requestedAt = dateQuery;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit) || 20));

    const [rides, total, totalAll, totalActive, totalCompleted, totalCancelled] = await Promise.all([
      Ride.find(query)
        .sort({ requestedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Ride.countDocuments(query),
      Ride.countDocuments({}),
      Ride.countDocuments({ status: { $in: activeRideStatuses } }),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ status: { $in: ['cancelled', 'no_drivers'] } })
    ]);

    res.json({
      success: true,
      data: rides,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1
      },
      counts: {
        all: totalAll,
        active: totalActive,
        completed: totalCompleted,
        cancelled: totalCancelled
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
