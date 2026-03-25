// middleware/validateCancelRide.js
export const validateCancelRide = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    const userId = req.customerId || req.driver?.id;
    const userType = req.customerId ? 'customer' : (req.driver ? 'driver' : null);

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
        message: 'Ride not found'
      });
    }

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
    const cancellableStatuses = ['requested', 'searching', 'driver_assigned'];
    if (!cancellableStatuses.includes(ride.status)) {
      return res.status(400).json({
        success: false,
        message: `Ride cannot be cancelled. Current status: ${ride.status}`
      });
    }

    // Check authorization
    if (userType === 'customer') {
      if (ride.customer.customerId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to cancel this ride'
        });
      }
    } else if (userType === 'driver') {
      if (!ride.driver || ride.driver.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to cancel this ride'
        });
      }
    }

    // Store ride in request for later use
    req.ride = ride;
    next();

  } catch (error) {
    console.error('Cancel ride validation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to validate cancellation'
    });
  }
};