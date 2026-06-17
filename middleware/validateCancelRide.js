// middleware/validateCancelRide.js
import Ride from "../models/Ride.js";

export const validateCancelRide = async (req, res, next) => {
  try {
    const rideId = req.params.rideId || req.body.rideId;

    // FIX: Properly determine user type and ID
    let userType = null;
    let userId = null;

    // Check if it's a customer (has customerId from customerAuthMiddleware)
    if (req.customerId) {
      userType = 'customer';
      userId = req.customerId;
      console.log('🔍 Validation - Customer:', { userId, rideId });
    }
    // Check if it's a driver (has driver from driverAuthMiddleware)
    else if (req.driver && req.driver.id) {
      userType = 'driver';
      userId = req.driver.id;
      console.log('🔍 Validation - Driver:', { userId, rideId });
    }
    // Check if it's admin (has adminId from authMiddleware)
    else if (req.adminId) {
      userType = 'admin';
      userId = req.adminId;
      console.log('🔍 Validation - Admin:', { userId, rideId });
    }

    if (!userType || !userId) {
      console.error('❌ Validation failed: No user type or ID found', {
        hasCustomerId: !!req.customerId,
        hasDriver: !!req.driver,
        hasAdminId: !!req.adminId,
        body: req.body
      });
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login as customer or driver.'
      });
    }

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID is required'
      });
    }

    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: `Ride with ID ${rideId} not found`
      });
    }

    console.log('🔍 Ride found for validation:', {
      rideId: ride.rideId,
      status: ride.status,
      customerId: ride.customer?.customerId,
      driverId: ride.driver?.driverId
    });

    // Check if ride is already completed or cancelled
    if (ride.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Ride is already completed and cannot be cancelled'
      });
    }

    if (ride.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Ride is already cancelled'
      });
    }

    // Check if ride can be cancelled based on status
    const cancellableStatuses = ['requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'no_drivers'];
    if (!cancellableStatuses.includes(ride.status)) {
      return res.status(400).json({
        success: false,
        message: `Ride cannot be cancelled. Current status: ${ride.status}. Only ${cancellableStatuses.join(', ')} rides can be cancelled.`
      });
    }

    // Check authorization
    let isAuthorized = false;

    if (userType === 'customer') {
      const rideCustomerId = ride.customer?.customerId?.toString();
      if (rideCustomerId === userId.toString()) {
        isAuthorized = true;
        console.log('✅ Customer validation passed');
      } else {
        console.log('❌ Customer validation failed:', { rideCustomerId, userId });
      }
    }
    else if (userType === 'driver') {
      const rideDriverId = ride.driver?.driverId?.toString();
      if (rideDriverId === userId.toString()) {
        isAuthorized = true;
        console.log('✅ Driver validation passed');
      } else {
        console.log('❌ Driver validation failed:', { rideDriverId, userId });
      }
    }
    else if (userType === 'admin') {
      isAuthorized = true;
      console.log('✅ Admin validation passed');
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: `Not authorized to cancel this ride. You are logged in as ${userType} but this ride does not belong to you.`
      });
    }

    // Store ride and user info in request for later use
    req.ride = ride;
    req.userType = userType;
    req.userId = userId;
    next();

  } catch (error) {
    console.error('❌ Cancel ride validation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to validate cancellation'
    });
  }
};