import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';

// Store active tracking sessions
const activeTrackingSessions = new Map(); // rideId -> session object

export const initializeRideTrackingSockets = (io) => {
  
  io.on('connection', (socket) => {
    console.log(`🟢 Ride tracking client connected: ${socket.id}`);
    
    // ==================== DRIVER TRACKING ====================
    
    /**
     * Driver joins tracking for a specific ride
     */
    socket.on('driver:join-tracking', async (data) => {
      try {
        const { driverId, rideId } = data;
        
        if (!driverId || !rideId) {
          socket.emit('error', { message: 'Driver ID and Ride ID are required' });
          return;
        }
        
        // Store driver connection data on socket
        socket.driverId = driverId;
        socket.rideId = rideId;
        socket.userType = 'driver';
        
        // Join ride-specific room
        socket.join(`ride:${rideId}`);
        
        // Update or create tracking session
        if (!activeTrackingSessions.has(rideId)) {
          activeTrackingSessions.set(rideId, {
            driverSocketId: socket.id,
            customerSocketId: null,
            lastLocation: null,
            driverId: driverId,
            customerId: null,
            startedAt: new Date()
          });
        } else {
          const session = activeTrackingSessions.get(rideId);
          session.driverSocketId = socket.id;
          session.driverId = driverId;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Update global active drivers map
        global.activeDrivers.set(driverId, {
          socketId: socket.id,
          rideId: rideId,
          lastLocation: null,
          isOnline: true,
          lastUpdate: new Date()
        });
        
        // Update driver status in database
        await Driver.findByIdAndUpdate(driverId, {
          socketId: socket.id,
          isOnline: true,
          isAvailable: false,
          currentRideId: rideId,
          lastActive: new Date()
        });
        
        console.log(`🚗 Driver ${driverId} joined tracking for ride ${rideId}`);
        
        // Send confirmation to driver
        socket.emit('tracking:joined', {
          success: true,
          rideId,
          userType: 'driver',
          message: 'Successfully joined ride tracking',
          timestamp: new Date()
        });
        
        // If customer is already tracking, notify them
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:online', {
            driverId,
            rideId,
            message: 'Driver is online and tracking started',
            timestamp: new Date()
          });
        }
        
      } catch (error) {
        console.error('Error in driver join tracking:', error);
        socket.emit('error', { 
          message: error.message,
          code: 'JOIN_TRACKING_ERROR'
        });
      }
    });
    
    // ==================== CUSTOMER TRACKING ====================
    
    /**
     * Customer joins to track their ride
     */
    socket.on('customer:join-tracking', async (data) => {
      try {
        const { customerId, rideId } = data;
        
        if (!customerId || !rideId) {
          socket.emit('error', { message: 'Customer ID and Ride ID are required' });
          return;
        }
        
        // Store customer connection data
        socket.customerId = customerId;
        socket.rideId = rideId;
        socket.userType = 'customer';
        
        // Join ride room
        socket.join(`ride:${rideId}`);
        
        // Update tracking session
        if (!activeTrackingSessions.has(rideId)) {
          activeTrackingSessions.set(rideId, {
            driverSocketId: null,
            customerSocketId: socket.id,
            lastLocation: null,
            driverId: null,
            customerId: customerId,
            startedAt: new Date()
          });
        } else {
          const session = activeTrackingSessions.get(rideId);
          session.customerSocketId = socket.id;
          session.customerId = customerId;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Update global customers map
        global.activeCustomers.set(customerId, {
          socketId: socket.id,
          rideId: rideId
        });
        
        console.log(`👤 Customer ${customerId} joined tracking for ride ${rideId}`);
        
        // Get ride details with populated data
        const ride = await Ride.findById(rideId)
          .populate('driver.driverId', 'name phone email profileImage vehicleType vehicleNumber rating')
          .populate('customerId', 'name phone email profileImage');
        
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }
        
        // Send initial ride info
        socket.emit('tracking:joined', {
          success: true,
          rideId,
          userType: 'customer',
          rideDetails: {
            rideId: ride._id,
            pickupLocation: ride.pickupLocation,
            dropLocation: ride.dropLocation,
            status: ride.status,
            fare: ride.fare,
            estimatedDistance: ride.estimatedDistance,
            estimatedDuration: ride.estimatedDuration,
            driver: ride.driver ? {
              id: ride.driver.driverId?._id,
              name: ride.driver.driverId?.name,
              phone: ride.driver.driverId?.phone,
              profileImage: ride.driver.driverId?.profileImage,
              vehicleType: ride.driver.driverId?.vehicleType,
              vehicleNumber: ride.driver.driverId?.vehicleNumber,
              rating: ride.driver.driverId?.rating
            } : null,
            customer: ride.customerId
          },
          timestamp: new Date()
        });
        
        // If driver is already tracking, request immediate location
        const session = activeTrackingSessions.get(rideId);
        if (session && session.driverSocketId && ride.driver?.driverId?._id) {
          // Request current location from driver
          io.to(session.driverSocketId).emit('driver:send-location', {
            rideId,
            customerId
          });
          
          // Send driver details and last known location
          const driver = await Driver.findById(ride.driver.driverId._id);
          if (driver && driver.currentLocation && driver.currentLocation.coordinates) {
            const [lng, lat] = driver.currentLocation.coordinates;
            socket.emit('driver:location-updated', {
              driverId: driver._id,
              latitude: lat,
              longitude: lng,
              rideId,
              timestamp: new Date(),
              driverDetails: {
                name: driver.name,
                phone: driver.phone,
                vehicleType: driver.vehicleType,
                vehicleNumber: driver.vehicleNumber,
                rating: driver.rating,
                profileImage: driver.profileImage
              }
            });
          }
        }
        
      } catch (error) {
        console.error('Error in customer join tracking:', error);
        socket.emit('error', { 
          message: error.message,
          code: 'JOIN_TRACKING_ERROR'
        });
      }
    });
    
    // ==================== LOCATION UPDATES ====================
    
    /**
     * Driver sends real-time location updates (high frequency)
     */
    socket.on('driver:location-update', async (data) => {
      try {
        const { driverId, rideId, latitude, longitude, bearing, speed, accuracy } = data;
        
        if (!latitude || !longitude || !rideId) {
          return;
        }
        
        // Update database asynchronously (fire and forget for performance)
        Driver.findByIdAndUpdate(driverId, {
          currentLocation: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          currentBearing: bearing,
          currentSpeed: speed,
          lastActive: new Date()
        }).catch(err => console.error('Error updating driver location in DB:', err));
        
        // Update global active drivers map
        const driverData = global.activeDrivers.get(driverId);
        if (driverData) {
          driverData.lastLocation = { latitude, longitude, bearing, speed };
          driverData.lastUpdate = new Date();
          global.activeDrivers.set(driverId, driverData);
        }
        
        // Get ride and calculate ETA
        let ride;
        try {
          ride = await Ride.findById(rideId);
        } catch (err) {
          // If ID is invalid, try to find by custom rideId field
          ride = await Ride.findOne({ rideId: rideId });
        }
        
        if (!ride) return;
        
        let eta = null;
        let etaMinutes = null;
        let remainingDistance = null;
        let statusMessage = null;
        
        // Calculate ETA based on ride status
        if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
          // Going to pickup location
          if (ride.pickupLocation && ride.pickupLocation.coordinates) {
            const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
            const distanceToPickup = calculateDistance(latitude, longitude, pickupLat, pickupLon);
            const speedKmh = getAverageSpeed(ride.vehicleType || ride.driver?.vehicleType);
            etaMinutes = Math.ceil((distanceToPickup / speedKmh) * 60);
            eta = etaMinutes;
            remainingDistance = distanceToPickup;
            statusMessage = `Arriving in ${etaMinutes} minutes`;
            
            // Check if near pickup (within 100m)
            if (distanceToPickup <= 0.1 && ride.status !== 'driver_arrived') {
              // Notify driver they're near pickup
              socket.emit('ride:near-pickup', {
                rideId,
                distance: distanceToPickup * 1000,
                message: 'You are near pickup location'
              });
            }
          }
        } else if (ride.status === 'in_progress') {
          // Going to drop location
          if (ride.dropLocation && ride.dropLocation.coordinates) {
            const [dropLon, dropLat] = ride.dropLocation.coordinates;
            const distanceToDrop = calculateDistance(latitude, longitude, dropLat, dropLon);
            const speedKmh = getAverageSpeed(ride.vehicleType || ride.driver?.vehicleType);
            etaMinutes = Math.ceil((distanceToDrop / speedKmh) * 60);
            eta = etaMinutes;
            remainingDistance = distanceToDrop;
            statusMessage = `${etaMinutes} minutes to destination`;
            
            // Check if near destination (within 100m)
            if (distanceToDrop <= 0.1 && !ride.nearDestination) {
              ride.nearDestination = true;
              await ride.save();
              
              // Notify customer they're near destination
              const session = activeTrackingSessions.get(rideId);
              if (session && session.customerSocketId) {
                io.to(session.customerSocketId).emit('ride:near-destination', {
                  rideId,
                  remainingDistance: distanceToDrop * 1000,
                  message: 'You are near your destination'
                });
              }
            }
          }
        }
        
        // Prepare location data
        const locationData = {
          driverId,
          latitude,
          longitude,
          rideId,
          timestamp: new Date(),
          eta,
          etaMinutes,
          etaText: etaMinutes ? `${etaMinutes} min` : null,
          remainingDistance,
          remainingDistanceText: remainingDistance ? `${remainingDistance.toFixed(1)} km` : null,
          bearing: bearing || null,
          speed: speed || null,
          statusMessage,
          accuracy: accuracy || null
        };
        
        // Store last location in session
        const session = activeTrackingSessions.get(rideId);
        if (session) {
          session.lastLocation = locationData;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Update global ride tracking
        const rideTrackData = global.activeRides.get(rideId);
        if (rideTrackData) {
          rideTrackData.lastLocation = locationData;
          global.activeRides.set(rideId, rideTrackData);
        }
        
        // Broadcast to all clients in ride room (customer, admin, etc.)
        io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        
        // Also emit specifically to customer if we have their socket ID
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:location-updated', locationData);
        }
        
        // Broadcast to admin monitoring room
        io.to('admin-monitoring').emit('driver:live-location', {
          ...locationData,
          driverDetails: driverData
        });
        
      } catch (error) {
        console.error('Error updating driver location:', error);
      }
    });
    
    /**
     * Driver responds to location request
     */
    socket.on('driver:send-location-response', async (data) => {
      try {
        const { driverId, rideId, latitude, longitude, customerId } = data;
        
        if (!latitude || !longitude) return;
        
        const locationData = {
          driverId,
          latitude,
          longitude,
          rideId,
          timestamp: new Date()
        };
        
        // Send directly to requesting customer
        if (customerId) {
          const customerData = global.activeCustomers.get(customerId);
          if (customerData && customerData.socketId) {
            io.to(customerData.socketId).emit('driver:location-updated', locationData);
          }
        }
        
        // Also broadcast to ride room
        io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        
      } catch (error) {
        console.error('Error sending location response:', error);
      }
    });
    
    // ==================== RIDE STATUS UPDATES ====================
    
    /**
     * Driver updates their status (online/offline/available)
     */
    socket.on('driver:status-change', async (data) => {
      try {
        const { driverId, rideId, isOnline, isAvailable } = data;
        
        await Driver.findByIdAndUpdate(driverId, {
          isOnline: isOnline,
          isAvailable: isAvailable,
          lastOnlineAt: isOnline ? new Date() : null,
          ...(isAvailable ? { currentRideId: null } : {})
        });
        
        // Update global map
        const driverData = global.activeDrivers.get(driverId);
        if (driverData) {
          driverData.isOnline = isOnline;
          global.activeDrivers.set(driverId, driverData);
        }
        
        const statusData = {
          driverId,
          isOnline,
          isAvailable,
          rideId,
          timestamp: new Date()
        };
        
        // Broadcast to customer if ride exists
        if (rideId) {
          io.to(`ride:${rideId}`).emit('driver:status-changed', statusData);
        }
        
        // Broadcast to admin
        io.to('admin-monitoring').emit('driver:status-changed', statusData);
        
      } catch (error) {
        console.error('Error updating driver status:', error);
      }
    });
    
    /**
     * Ride status update (accepted, arrived, started, completed)
     */
    socket.on('ride:status-update', async (data) => {
      try {
        const { rideId, status, driverId, location, reason } = data;
        
        // Update ride in database
        const ride = await Ride.findById(rideId);
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }
        
        // Update status with timestamps
        ride.status = status;
        switch(status) {
          case 'accepted':
            ride.acceptedAt = new Date();
            break;
          case 'driver_assigned':
            ride.driverAssignedAt = new Date();
            break;
          case 'driver_arrived':
            ride.driverArrivedAt = new Date();
            break;
          case 'in_progress':
            ride.rideStartedAt = new Date();
            break;
          case 'completed':
            ride.rideCompletedAt = new Date();
            break;
          case 'cancelled':
            ride.cancelledAt = new Date();
            ride.cancellationReason = reason;
            break;
        }
        
        await ride.save();
        
        const statusData = {
          rideId,
          status,
          driverId,
          location,
          timestamp: new Date(),
          message: getStatusMessage(status)
        };
        
        // Broadcast to ride room
        io.to(`ride:${rideId}`).emit('ride:status-changed', statusData);
        
        // Update global rides map
        const rideTrackData = global.activeRides.get(rideId);
        if (rideTrackData) {
          rideTrackData.status = status;
          global.activeRides.set(rideId, rideTrackData);
        }
        
        // Handle ride completion
        if (status === 'completed') {
          // Clean up tracking session after delay
          setTimeout(() => {
            activeTrackingSessions.delete(rideId);
          }, 5000);
          
          // Notify both parties
          io.to(`ride:${rideId}`).emit('ride:completed', {
            rideId,
            message: 'Ride completed successfully',
            fare: ride.fare,
            timestamp: new Date()
          });
          
          // Update driver availability
          if (driverId) {
            await Driver.findByIdAndUpdate(driverId, {
              isAvailable: true,
              currentRideId: null
            });
          }
        }
        
        // Handle ride cancellation
        if (status === 'cancelled') {
          // Clean up tracking immediately
          activeTrackingSessions.delete(rideId);
          
          io.to(`ride:${rideId}`).emit('ride:cancelled', {
            rideId,
            message: 'Ride has been cancelled',
            reason: reason,
            timestamp: new Date()
          });
          
          // Update driver availability if driver was assigned
          if (driverId) {
            await Driver.findByIdAndUpdate(driverId, {
              isAvailable: true,
              currentRideId: null
            });
          }
        }
        
      } catch (error) {
        console.error('Error updating ride status:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    /**
     * Driver arrived at pickup location
     */
    socket.on('driver:arrived', async (data) => {
      try {
        const { rideId, driverId, location } = data;
        
        // Update ride status
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          {
            status: 'driver_arrived',
            driverArrivedAt: new Date()
          },
          { new: true }
        );
        
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }
        
        const arrivalData = {
          rideId,
          driverId,
          location,
          timestamp: new Date(),
          message: 'Driver has arrived at pickup location'
        };
        
        // Notify customer
        io.to(`ride:${rideId}`).emit('driver:arrived', arrivalData);
        
        // Send push notification to customer
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            await sendPushNotification(customer.fcmToken, {
              title: 'Driver Arrived',
              body: 'Your driver has arrived at the pickup location',
              data: { rideId, type: 'driver_arrived' }
            });
          }
        }
        
      } catch (error) {
        console.error('Error in driver arrived:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    /**
     * Ride started
     */
    socket.on('ride:started', async (data) => {
      try {
        const { rideId, driverId } = data;
        
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          {
            status: 'in_progress',
            rideStartedAt: new Date()
          },
          { new: true }
        );
        
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }
        
        const startData = {
          rideId,
          driverId,
          timestamp: new Date(),
          message: 'Ride has started'
        };
        
        // Notify customer
        io.to(`ride:${rideId}`).emit('ride:started', startData);
        
        // Send push notification
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            await sendPushNotification(customer.fcmToken, {
              title: 'Ride Started',
              body: 'Your ride has started. You can track your journey in real-time.',
              data: { rideId, type: 'ride_started' }
            });
          }
        }
        
      } catch (error) {
        console.error('Error in ride started:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    /**
     * Ride completed by driver
     */
    socket.on('ride:completed', async (data) => {
      try {
        const { rideId, driverId, fare, paymentMethod, tip } = data;
        
        // Update ride
        const ride = await Ride.findByIdAndUpdate(
          rideId,
          {
            status: 'completed',
            rideCompletedAt: new Date(),
            fare: fare,
            paymentMethod: paymentMethod,
            tip: tip || 0
          },
          { new: true }
        );
        
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }
        
        // Update driver stats
        await Driver.findByIdAndUpdate(driverId, {
          $inc: {
            totalTrips: 1,
            totalEarnings: fare
          },
          isAvailable: true,
          currentRideId: null
        });
        
        const completeData = {
          rideId,
          driverId,
          fare,
          paymentMethod,
          tip,
          timestamp: new Date(),
          message: 'Ride completed successfully'
        };
        
        // Notify customer
        io.to(`ride:${rideId}`).emit('ride:completed', completeData);
        
        // Send receipt and rating request
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            await sendPushNotification(customer.fcmToken, {
              title: 'Ride Completed',
              body: `Your ride is complete. Total fare: ₹${fare}`,
              data: { rideId, type: 'ride_completed', fare: fare.toString() }
            });
          }
        }
        
        // Clean up tracking session after delay
        setTimeout(() => {
          activeTrackingSessions.delete(rideId);
          global.activeRides.delete(rideId);
        }, 10000);
        
      } catch (error) {
        console.error('Error in ride completed:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    // ==================== DISCONNECTION HANDLING ====================
    
    /**
     * Handle client disconnection
     */
    socket.on('disconnect', async () => {
      console.log(`🔴 Client disconnected from ride tracking: ${socket.id}`);
      
      // Handle driver disconnection
      if (socket.userType === 'driver' && socket.driverId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.driverSocketId === socket.id) {
          session.driverSocketId = null;
          session.driverReconnectAttempts = (session.driverReconnectAttempts || 0) + 1;
          activeTrackingSessions.set(socket.rideId, session);
          
          // Notify customer about driver disconnection
          if (session.customerSocketId) {
            io.to(session.customerSocketId).emit('driver:disconnected', {
              driverId: socket.driverId,
              rideId: socket.rideId,
              message: 'Driver lost connection, reconnecting...',
              timestamp: new Date()
            });
          }
        }
        
        // Update driver status in database
        await Driver.findByIdAndUpdate(socket.driverId, {
          socketId: null,
          isAvailable: false,
          isOnline: false,
          lastDisconnect: new Date()
        }).catch(err => console.error('Error updating driver on disconnect:', err));
        
        // Remove from global map
        global.activeDrivers.delete(socket.driverId);
      }
      
      // Handle customer disconnection
      if (socket.userType === 'customer' && socket.customerId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.customerSocketId === socket.id) {
          session.customerSocketId = null;
          activeTrackingSessions.set(socket.rideId, session);
        }
        
        // Remove from global map
        global.activeCustomers.delete(socket.customerId);
      }
      
      // Leave all rooms
      if (socket.rideId) {
        socket.leave(`ride:${socket.rideId}`);
      }
    });
  });
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Get average speed based on vehicle type (km/h)
 * @param {string} vehicleType - Type of vehicle
 * @returns {number} Average speed in km/h
 */
function getAverageSpeed(vehicleType) {
  const speeds = {
    'bike': 30,
    'auto': 25,
    'auto_rickshaw': 25,
    'car': 35,
    'sedan': 35,
    'suv': 32,
    'mini_truck': 28,
    'truck': 22,
    'Tata Ace': 28,
    'Eicher': 25,
    'Mahindra Pickup': 28,
    'Tata 407': 25,
    'Ashok Leyland': 22,
    'Force Trump': 23,
    'BharatBenz': 22,
    'Mahindra Furio': 25,
    'Tata Ultra': 24
  };
  
  return speeds[vehicleType] || 25;
}

/**
 * Get status message for ride status
 * @param {string} status - Ride status
 * @returns {string} User-friendly status message
 */
function getStatusMessage(status) {
  const messages = {
    'pending': 'Ride request pending',
    'accepted': 'Driver accepted your ride',
    'driver_assigned': 'Driver assigned to your ride',
    'driver_arrived': 'Driver has arrived',
    'in_progress': 'Ride in progress',
    'completed': 'Ride completed',
    'cancelled': 'Ride cancelled'
  };
  
  return messages[status] || 'Status updated';
}

// Export for use in other files
export { calculateDistance, getAverageSpeed, getStatusMessage };