// sockets/rideTrackingSocket.js
import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';
import ChatMessage from '../models/ChatMessage.js';

// Store active tracking sessions
const activeTrackingSessions = new Map(); // rideId -> session object

// Enhanced logging function
const logWithTimestamp = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logPrefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    console.log(`${logPrefix} ${message}`);
    console.log(`${logPrefix} Data:`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${logPrefix} ${message}`);
  }
};

export const initializeRideTrackingSockets = (io) => {

  io.on('connection', (socket) => {
    logWithTimestamp('info', `🟢 Ride tracking client connected: ${socket.id}`);
    logWithTimestamp('debug', `Socket handshake details:`, {
      id: socket.id,
      headers: socket.handshake.headers,
      query: socket.handshake.query,
      address: socket.handshake.address
    });

    // Debug listener for all events
    socket.onAny((eventName, ...args) => {
      console.log(`📡 [SOCKET RECEIVE] Event: "${eventName}" | Args:`, JSON.stringify(args, null, 2));
    });

    // ==================== DRIVER TRACKING ====================

    /**
     * Driver joins tracking for a specific ride
     */
    socket.on('driver:join-tracking', async (data) => {
      logWithTimestamp('info', `🚗 Driver join tracking event received`, data);

      try {
        const { driverId, rideId } = data;

        if (!driverId || !rideId) {
          logWithTimestamp('error', `Missing required fields: driverId=${driverId}, rideId=${rideId}`);
          socket.emit('error', { message: 'Driver ID and Ride ID are required' });
          return;
        }

        logWithTimestamp('debug', `Processing driver join tracking`, { driverId, rideId, socketId: socket.id });

        // Store driver connection data on socket
        socket.driverId = driverId;
        socket.rideId = rideId;
        socket.userType = 'driver';
        socket.joinedTracking = true;

        // Join ride-specific room
        socket.join(`ride:${rideId}`);
        logWithTimestamp('debug', `Driver joined room: ride:${rideId}`);

        // Update or create tracking session
        let session = activeTrackingSessions.get(rideId);
        if (!session) {
          logWithTimestamp('debug', `Creating new tracking session for ride ${rideId}`);
          session = {
            driverSocketId: socket.id,
            customerSocketId: null,
            lastLocation: null,
            driverId: driverId,
            customerId: null,
            driverConnected: true,
            startedAt: new Date(),
            events: []
          };
          activeTrackingSessions.set(rideId, session);
        } else {
          logWithTimestamp('debug', `Updating existing tracking session for ride ${rideId}`, {
            oldDriverSocketId: session.driverSocketId,
            newDriverSocketId: socket.id
          });
          session.driverSocketId = socket.id;
          session.driverId = driverId;
          session.driverConnected = true;
          activeTrackingSessions.set(rideId, session);
        }

        // Update global active drivers map - CRITICAL FIX
        const existingDriver = global.activeDrivers.get(driverId);
        logWithTimestamp('debug', `Updating global active drivers map`, {
          driverId,
          existingDriver: existingDriver ? 'exists' : 'new',
          socketId: socket.id
        });

        global.activeDrivers.set(driverId, {
          socketId: socket.id,
          rideId: rideId,
          lastLocation: null,
          isOnline: true,
          isAvailable: false,
          joinedAt: new Date(),
          lastUpdate: new Date()
        });

        // Verify driver was added
        const verifyDriver = global.activeDrivers.get(driverId);
        logWithTimestamp('debug', `Driver added to global map verification`, {
          driverId,
          inMap: !!verifyDriver,
          socketId: verifyDriver?.socketId
        });

        // Update driver status in database with socket ID
        logWithTimestamp('info', `Updating driver in database`, { driverId, rideId });
        const updatedDriver = await Driver.findByIdAndUpdate(driverId, {
          socketId: socket.id,
          isOnline: true,
          isAvailable: false,
          currentRideId: rideId,
          lastActive: new Date()
        }, { new: true });

        logWithTimestamp('debug', `Driver database update result`, {
          driverId,
          updated: !!updatedDriver,
          socketIdSaved: updatedDriver?.socketId,
          isOnline: updatedDriver?.isOnline,
          isAvailable: updatedDriver?.isAvailable,
          currentRideId: updatedDriver?.currentRideId
        });

        logWithTimestamp('info', `🚗 Driver ${driverId} joined tracking for ride ${rideId}`);

        // Fetch ride details to return in tracking:joined
        const ride = await Ride.findOne({ rideId: rideId })
          .populate('driver.driverId', 'name phone email profileImage vehicleType vehicleNumber rating')
          .populate('customer.customerId', 'name phone email profileImage');

        // Send confirmation to driver
        const confirmationData = {
          success: true,
          rideId,
          userType: 'driver',
          message: 'Successfully joined ride tracking',
          rideDetails: ride ? {
            rideId: ride.rideId,
            pickupLocation: ride.pickupLocation,
            dropLocation: ride.dropLocation,
            dropLocations: ride.dropLocations || [],
            status: ride.status,
            fare: ride.fare,
            distance: ride.distance,
            distanceText: ride.routeInfo?.distanceText || `${ride.distance} km`,
            duration: ride.duration,
            durationText: ride.routeInfo?.durationText || `${ride.duration} mins`,
            driver: ride.driver ? {
              id: ride.driver.driverId?._id,
              name: ride.driver.driverId?.name || ride.driver.name,
              phone: ride.driver.driverId?.phone || ride.driver.phone,
              profileImage: ride.driver.driverId?.profileImage,
              vehicleType: ride.driver.driverId?.vehicleType || ride.driver.vehicleType,
              vehicleNumber: ride.driver.driverId?.vehicleNumber || ride.driver.vehicleNumber,
              rating: ride.driver.driverId?.rating || ride.driver.rating || 0
            } : null,
            customer: ride.customer ? {
              id: ride.customer.customerId?._id,
              name: ride.customer.customerId?.name || ride.customer.name,
              phone: ride.customer.customerId?.phone || ride.customer.phone,
              profileImage: ride.customer.customerId?.profileImage,
              rating: ride.customer.customerId?.rating || ride.customer.rating || 0
            } : null
          } : null,
          timestamp: new Date(),
          socketId: socket.id
        };
        socket.emit('tracking:joined', confirmationData);
        logWithTimestamp('debug', `Sent tracking:joined confirmation to driver`, confirmationData);

        // If customer is already tracking, notify them
        const currentSession = activeTrackingSessions.get(rideId);
        if (currentSession && currentSession.customerSocketId) {
          logWithTimestamp('info', `Customer already tracking, notifying them about driver`, {
            rideId,
            customerSocketId: currentSession.customerSocketId,
            driverId
          });

          io.to(currentSession.customerSocketId).emit('driver:online', {
            driverId,
            rideId,
            message: 'Driver is online and tracking started',
            timestamp: new Date()
          });
        } else {
          logWithTimestamp('debug', `No customer tracking yet for ride ${rideId}`);
        }

      } catch (error) {
        logWithTimestamp('error', `Error in driver join tracking:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
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
      logWithTimestamp('info', `👤 Customer join tracking event received`, data);

      try {
        const { customerId, rideId } = data;

        if (!customerId || !rideId) {
          logWithTimestamp('error', `Missing required fields: customerId=${customerId}, rideId=${rideId}`);
          socket.emit('error', { message: 'Customer ID and Ride ID are required' });
          return;
        }

        logWithTimestamp('debug', `Processing customer join tracking`, { customerId, rideId, socketId: socket.id });

        // Store customer connection data
        socket.customerId = customerId;
        socket.rideId = rideId;
        socket.userType = 'customer';

        // Join ride room
        socket.join(`ride:${rideId}`);
        logWithTimestamp('debug', `Customer joined room: ride:${rideId}`);

        // Update tracking session
        let session = activeTrackingSessions.get(rideId);
        if (!session) {
          logWithTimestamp('debug', `Creating new tracking session for ride ${rideId}`);
          session = {
            driverSocketId: null,
            customerSocketId: socket.id,
            lastLocation: null,
            driverId: null,
            customerId: customerId,
            startedAt: new Date(),
            events: []
          };
          activeTrackingSessions.set(rideId, session);
        } else {
          logWithTimestamp('debug', `Updating existing tracking session for ride ${rideId}`, {
            oldCustomerSocketId: session.customerSocketId,
            newCustomerSocketId: socket.id
          });
          session.customerSocketId = socket.id;
          session.customerId = customerId;
          activeTrackingSessions.set(rideId, session);
        }

        // Update global customers map
        const existingCustomer = global.activeCustomers.get(customerId);
        logWithTimestamp('debug', `Updating global active customers map`, {
          customerId,
          existingCustomer: existingCustomer ? 'exists' : 'new',
          socketId: socket.id
        });

        global.activeCustomers.set(customerId, {
          socketId: socket.id,
          rideId: rideId
        });

        logWithTimestamp('info', `👤 Customer ${customerId} joined tracking for ride ${rideId}`);

        // Get ride details with populated data - FIX: use findOne with rideId
        logWithTimestamp('debug', `Fetching ride details from database`, { rideId });
        const ride = await Ride.findOne({ rideId: rideId })
          .populate('driver.driverId', 'name phone email profileImage vehicleType vehicleNumber rating')
          .populate('customer.customerId', 'name phone email profileImage');

        if (!ride) {
          logWithTimestamp('error', `Ride not found in database`, { rideId });
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        logWithTimestamp('debug', `Ride details retrieved`, {
          rideId: ride.rideId,
          mongoId: ride._id,
          status: ride.status,
          hasDriver: !!ride.driver,
          driverId: ride.driver?.driverId?._id,
          hasCustomer: !!ride.customer
        });

        // Send initial ride info
        const initialRideInfo = {
          success: true,
          rideId,
          userType: 'customer',
          rideDetails: {
            rideId: ride.rideId,
            pickupLocation: ride.pickupLocation,
            dropLocation: ride.dropLocation,
            dropLocations: ride.dropLocations || [],
            status: ride.status,
            fare: ride.fare,
            distance: ride.distance,
            distanceText: ride.routeInfo?.distanceText || `${ride.distance} km`,
            duration: ride.duration,
            durationText: ride.routeInfo?.durationText || `${ride.duration} mins`,
            driver: ride.driver ? {
              id: ride.driver.driverId?._id,
              name: ride.driver.driverId?.name || ride.driver.name,
              phone: ride.driver.driverId?.phone || ride.driver.phone,
              profileImage: ride.driver.driverId?.profileImage,
              vehicleType: ride.driver.driverId?.vehicleType || ride.driver.vehicleType,
              vehicleNumber: ride.driver.driverId?.vehicleNumber || ride.driver.vehicleNumber,
              rating: ride.driver.driverId?.rating || ride.driver.rating || 0
            } : null,
            customer: ride.customer ? {
              id: ride.customer.customerId?._id,
              name: ride.customer.customerId?.name || ride.customer.name,
              phone: ride.customer.customerId?.phone || ride.customer.phone,
              profileImage: ride.customer.customerId?.profileImage,
              rating: ride.customer.customerId?.rating || ride.customer.rating || 0
            } : null
          },
          timestamp: new Date()
        };

        socket.emit('tracking:joined', initialRideInfo);
        logWithTimestamp('debug', `Sent tracking:joined info to customer`, {
          rideId,
          hasDriver: !!initialRideInfo.rideDetails.driver,
          rideStatus: initialRideInfo.rideDetails.status
        });

        // If driver is already tracking, request immediate location
        const currentSession = activeTrackingSessions.get(rideId);
        if (currentSession && currentSession.driverSocketId && ride.driver?.driverId?._id) {
          logWithTimestamp('info', `Driver already tracking, requesting location`, {
            rideId,
            driverSocketId: currentSession.driverSocketId,
            driverId: ride.driver.driverId._id
          });

          // Request current location from driver
          io.to(currentSession.driverSocketId).emit('driver:send-location', {
            rideId,
            customerId
          });
          logWithTimestamp('debug', `Sent driver:send-location request to driver`, { rideId, customerId });

          // Send driver details and last known location
          const driver = await Driver.findById(ride.driver.driverId._id);
          if (driver && driver.currentLocation && driver.currentLocation.coordinates) {
            const [lng, lat] = driver.currentLocation.coordinates;
            const locationData = {
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
            };

            socket.emit('driver:location-updated', locationData);
            logWithTimestamp('debug', `Sent driver's last known location to customer`, locationData);
          } else {
            logWithTimestamp('warning', `Driver has no current location`, { driverId: ride.driver.driverId._id });
          }
        } else {
          logWithTimestamp('debug', `Driver not yet tracking for ride ${rideId}`, {
            hasDriverSocket: currentSession?.driverSocketId ? true : false,
            hasDriverInRide: !!ride.driver?.driverId?._id
          });
        }

      } catch (error) {
        logWithTimestamp('error', `Error in customer join tracking:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
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
      const { driverId, rideId, latitude, longitude, bearing, speed, accuracy } = data;

      logWithTimestamp('debug', `📍 Location update received`, {
        driverId,
        rideId,
        lat: latitude,
        lng: longitude,
        bearing,
        speed,
        accuracy,
        socketId: socket.id,
        hasJoinedTracking: socket.joinedTracking
      });

      try {
        if (!latitude || !longitude || !rideId) {
          logWithTimestamp('warning', `Incomplete location data received`, { driverId, rideId, latitude, longitude });
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
        }).then(() => {
          logWithTimestamp('debug', `Driver location saved to database`, { driverId });
        }).catch(err => {
          logWithTimestamp('error', `Error updating driver location in DB:`, err);
        });

        // Update global active drivers map - AUTO-ADD IF MISSING
        let driverData = global.activeDrivers.get(driverId);
        if (!driverData) {
          logWithTimestamp('warning', `Driver not found in global active drivers map, auto-adding now`, { driverId });
          driverData = {
            socketId: socket.id,
            rideId: rideId,
            lastLocation: { latitude, longitude, bearing, speed },
            isOnline: true,
            isAvailable: false,
            autoAdded: true,
            lastUpdate: new Date()
          };
          global.activeDrivers.set(driverId, driverData);
          logWithTimestamp('debug', `Driver auto-added to global map`, { driverId });
        } else {
          driverData.lastLocation = { latitude, longitude, bearing, speed };
          driverData.lastUpdate = new Date();
          global.activeDrivers.set(driverId, driverData);

          logWithTimestamp('debug', `Updated global active drivers map`, {
            driverId,
            lastLocation: driverData.lastLocation
          });
        }

        // ========== CRITICAL FIX: Find ride by custom rideId field ==========
        let ride;
        try {
          // FIRST: Try to find by custom rideId field (string like "RID89939650165")
          ride = await Ride.findOne({ rideId: rideId });

          if (!ride) {
            // SECOND: If not found, try to find by MongoDB _id (fallback)
            try {
              ride = await Ride.findById(rideId);
            } catch (err) {
              logWithTimestamp('debug', `Ride not found by _id, using custom rideId only`);
            }
          }
        } catch (err) {
          logWithTimestamp('error', `Error finding ride:`, { rideId, error: err.message });
          ride = await Ride.findOne({ rideId: rideId });
        }

        if (!ride) {
          logWithTimestamp('warning', `Ride not found for location update`, { rideId });
          // Still broadcast location even if ride not found
          io.to(`ride:${rideId}`).emit('driver:location-updated', {
            driverId,
            latitude,
            longitude,
            rideId,
            timestamp: new Date()
          });
          return;
        }

        logWithTimestamp('debug', `Found ride for location update`, {
          rideId: ride.rideId,
          mongoId: ride._id,
          status: ride.status,
          pickupCoordinates: ride.pickupLocation?.coordinates
        });

        let eta = null;
        let etaMinutes = null;
        let remainingDistance = null;
        let statusMessage = null;

        // Calculate ETA based on ride status
        logWithTimestamp('debug', `Calculating ETA for ride status: ${ride.status}`, { rideId, status: ride.status });

        if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
          // Going to pickup location
          if (ride.pickupLocation && ride.pickupLocation.coordinates) {
            const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
            const distanceToPickup = calculateDistance(latitude, longitude, pickupLat, pickupLon);
            const speedKmh = getAverageSpeed(ride.driver?.vehicleType || ride.vehicleType);
            etaMinutes = Math.ceil((distanceToPickup / speedKmh) * 60);
            eta = etaMinutes;
            remainingDistance = distanceToPickup;
            statusMessage = `Arriving in ${etaMinutes} minutes`;

            logWithTimestamp('debug', `ETA to pickup calculated`, {
              rideId,
              distanceToPickup: distanceToPickup.toFixed(2) + 'km',
              speed: speedKmh + 'km/h',
              etaMinutes,
              statusMessage
            });

            // Check if near pickup (within 100m)
            if (distanceToPickup <= 0.1 && ride.status !== 'driver_arrived') {
              logWithTimestamp('info', `Driver near pickup location`, {
                rideId,
                distance: (distanceToPickup * 1000).toFixed(0) + 'm'
              });

              // Notify driver they're near pickup
              socket.emit('ride:near-pickup', {
                rideId,
                distance: distanceToPickup * 1000,
                message: 'You are near pickup location'
              });
            }
          } else {
            logWithTimestamp('warning', `No pickup location coordinates for ride`, { rideId });
          }
        } else if (ride.status === 'in_progress') {
          // Going to drop location
          if (ride.dropLocation && ride.dropLocation.coordinates) {
            const [dropLon, dropLat] = ride.dropLocation.coordinates;
            const distanceToDrop = calculateDistance(latitude, longitude, dropLat, dropLon);
            const speedKmh = getAverageSpeed(ride.driver?.vehicleType || ride.vehicleType);
            etaMinutes = Math.ceil((distanceToDrop / speedKmh) * 60);
            eta = etaMinutes;
            remainingDistance = distanceToDrop;
            statusMessage = `${etaMinutes} minutes to destination`;

            logWithTimestamp('debug', `ETA to destination calculated`, {
              rideId,
              distanceToDrop: distanceToDrop.toFixed(2) + 'km',
              speed: speedKmh + 'km/h',
              etaMinutes,
              statusMessage
            });

            // Check if near destination (within 100m)
            if (distanceToDrop <= 0.1 && !ride.nearDestination) {
              logWithTimestamp('info', `Ride near destination`, {
                rideId,
                distance: (distanceToDrop * 1000).toFixed(0) + 'm'
              });

              ride.nearDestination = true;
              await ride.save();
              logWithTimestamp('debug', `Updated ride nearDestination flag`, { rideId });

              // Notify customer they're near destination
              const session = activeTrackingSessions.get(rideId);
              if (session && session.customerSocketId) {
                io.to(session.customerSocketId).emit('ride:near-destination', {
                  rideId,
                  remainingDistance: distanceToDrop * 1000,
                  message: 'You are near your destination'
                });
                logWithTimestamp('debug', `Sent near-destination notification to customer`, {
                  rideId,
                  customerSocketId: session.customerSocketId
                });
              }
            }
          } else {
            logWithTimestamp('warning', `No drop location coordinates for ride`, { rideId });
          }
        } else {
          logWithTimestamp('debug', `Ride status ${ride.status} does not require ETA calculation`);
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

        logWithTimestamp('debug', `Prepared location data for broadcast`, locationData);

        // Store last location in session - CREATE IF MISSING
        let session = activeTrackingSessions.get(rideId);
        if (!session) {
          logWithTimestamp('warning', `No tracking session found for ride ${rideId}, creating one`);
          session = {
            driverSocketId: socket.id,
            customerSocketId: null,
            lastLocation: locationData,
            driverId: driverId,
            customerId: null,
            driverConnected: true,
            startedAt: new Date()
          };
          activeTrackingSessions.set(rideId, session);
          logWithTimestamp('debug', `Created new tracking session during location update`, { rideId });
        } else {
          const previousLocation = session.lastLocation;
          session.lastLocation = locationData;
          activeTrackingSessions.set(rideId, session);

          logWithTimestamp('debug', `Updated tracking session with location`, {
            rideId,
            hadPreviousLocation: !!previousLocation
          });
        }

        // Update global ride tracking
        const rideTrackData = global.activeRides.get(rideId);
        if (rideTrackData) {
          rideTrackData.lastLocation = locationData;
          global.activeRides.set(rideId, rideTrackData);
          logWithTimestamp('debug', `Updated global active rides map`, { rideId });
        }

        // Broadcast to all clients in ride room (customer, admin, etc.)
        io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        logWithTimestamp('debug', `Broadcast location to ride room: ride:${rideId}`);

        // Also emit specifically to customer if we have their socket ID
        const currentSession = activeTrackingSessions.get(rideId);
        if (currentSession && currentSession.customerSocketId) {
          io.to(currentSession.customerSocketId).emit('driver:location-updated', locationData);
          logWithTimestamp('debug', `Emitted location directly to customer socket: ${currentSession.customerSocketId}`);
        }

        // Broadcast to admin monitoring room
        io.to('admin-monitoring').emit('driver:live-location', {
          ...locationData,
          driverDetails: driverData
        });
        logWithTimestamp('debug', `Broadcast location to admin monitoring room`);

      } catch (error) {
        logWithTimestamp('error', `Error updating driver location:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
      }
    });

    /**
     * Driver responds to location request
     */
    socket.on('driver:send-location-response', async (data) => {
      logWithTimestamp('info', `Driver sending location response`, data);

      try {
        const { driverId, rideId, latitude, longitude, customerId } = data;

        if (!latitude || !longitude) {
          logWithTimestamp('warning', `Incomplete location response data`, { driverId, rideId, latitude, longitude });
          return;
        }

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
            logWithTimestamp('debug', `Sent location response to customer`, {
              customerId,
              customerSocketId: customerData.socketId,
              location: locationData
            });
          } else {
            logWithTimestamp('warning', `Customer not found or not connected`, { customerId });
          }
        }

        // Also broadcast to ride room
        io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        logWithTimestamp('debug', `Broadcast location response to ride room: ride:${rideId}`);

      } catch (error) {
        logWithTimestamp('error', `Error sending location response:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
      }
    });

    // ==================== RIDE STATUS UPDATES ====================

    /**
     * Driver updates their status (online/offline/available)
     */
    socket.on('driver:status-change', async (data) => {
      logWithTimestamp('info', `Driver status change event`, data);

      try {
        const { driverId, rideId, isOnline, isAvailable } = data;

        logWithTimestamp('debug', `Updating driver status in database`, {
          driverId,
          isOnline,
          isAvailable,
          rideId
        });

        const updatedDriver = await Driver.findByIdAndUpdate(driverId, {
          isOnline: isOnline,
          isAvailable: isAvailable,
          socketId: isOnline ? socket.id : null,
          lastOnlineAt: isOnline ? new Date() : null,
          ...(isAvailable ? { currentRideId: null } : {})
        }, { new: true });

        logWithTimestamp('debug', `Driver database update result`, {
          driverId,
          updated: !!updatedDriver,
          isOnline: updatedDriver?.isOnline,
          isAvailable: updatedDriver?.isAvailable
        });

        // Update global map
        const driverData = global.activeDrivers.get(driverId);
        if (driverData) {
          driverData.isOnline = isOnline;
          driverData.isAvailable = isAvailable;
          global.activeDrivers.set(driverId, driverData);
          logWithTimestamp('debug', `Updated global active drivers map`, { driverId, isOnline });
        } else if (isOnline) {
          global.activeDrivers.set(driverId, {
            socketId: socket.id,
            rideId: rideId,
            lastLocation: null,
            isOnline: isOnline,
            isAvailable: isAvailable,
            lastUpdate: new Date()
          });
          logWithTimestamp('debug', `Added driver to global map`, { driverId });
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
          logWithTimestamp('debug', `Broadcast status change to ride room: ride:${rideId}`);
        }

        // Broadcast to admin
        io.to('admin-monitoring').emit('driver:status-changed', statusData);
        logWithTimestamp('debug', `Broadcast status change to admin monitoring`);

      } catch (error) {
        logWithTimestamp('error', `Error updating driver status:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
      }
    });

    /**
     * Ride status update (accepted, arrived, started, completed)
     */
    socket.on('ride:status-update', async (data) => {
      logWithTimestamp('info', `Ride status update event`, data);

      try {
        const { rideId, status, driverId, location, reason } = data;

        // FIX: Update ride using findOne with custom rideId
        logWithTimestamp('debug', `Fetching ride for status update`, { rideId });
        const ride = await Ride.findOne({ rideId: rideId });

        if (!ride) {
          logWithTimestamp('error', `Ride not found for status update`, { rideId });
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        logWithTimestamp('debug', `Current ride status: ${ride.status}, updating to: ${status}`, {
          rideId: ride.rideId,
          mongoId: ride._id,
          oldStatus: ride.status,
          newStatus: status
        });

        // Update status with timestamps
        ride.status = status;
        switch (status) {
          case 'accepted':
            ride.acceptedAt = new Date();
            logWithTimestamp('info', `Ride accepted`, { rideId, driverId });
            break;
          case 'driver_assigned':
            ride.driverAssignedAt = new Date();
            logWithTimestamp('info', `Driver assigned to ride`, { rideId, driverId });
            break;
          case 'driver_arrived':
            ride.driverArrivedAt = new Date();
            logWithTimestamp('info', `Driver arrived at pickup`, { rideId, driverId });
            break;
          case 'in_progress':
            ride.rideStartedAt = new Date();
            logWithTimestamp('info', `Ride started`, { rideId, driverId });
            break;
          case 'completed':
            ride.rideCompletedAt = new Date();
            logWithTimestamp('info', `Ride completed`, { rideId, driverId });
            break;
          case 'cancelled':
            ride.cancelledAt = new Date();
            ride.cancellationReason = reason;
            logWithTimestamp('info', `Ride cancelled`, { rideId, driverId, reason });
            break;
        }

        await ride.save();
        logWithTimestamp('debug', `Ride status updated in database`, { rideId: ride.rideId, status });

        const statusData = {
          rideId: ride.rideId,
          status,
          driverId,
          location,
          timestamp: new Date(),
          message: getStatusMessage(status)
        };

        // Broadcast to ride room
        io.to(`ride:${rideId}`).emit('ride:status-changed', statusData);
        logWithTimestamp('debug', `Broadcast status change to ride room: ride:${rideId}`, statusData);

        // Update global rides map
        const rideTrackData = global.activeRides.get(rideId);
        if (rideTrackData) {
          rideTrackData.status = status;
          global.activeRides.set(rideId, rideTrackData);
          logWithTimestamp('debug', `Updated global active rides map`, { rideId, status });
        }

        // Handle ride completion
        if (status === 'completed') {
          logWithTimestamp('info', `Processing ride completion cleanup`, { rideId });

          // Clean up tracking session after delay
          setTimeout(() => {
            activeTrackingSessions.delete(rideId);
            logWithTimestamp('debug', `Deleted tracking session for completed ride`, { rideId });
          }, 5000);

          // Notify both parties
          const completionData = {
            rideId,
            message: 'Ride completed successfully',
            fare: ride.fare,
            timestamp: new Date()
          };
          io.to(`ride:${rideId}`).emit('ride:completed', completionData);
          logWithTimestamp('info', `Sent ride completion notification`, completionData);

          // Update driver availability
          if (driverId) {
            const updatedDriver = await Driver.findByIdAndUpdate(driverId, {
              isAvailable: true,
              currentRideId: null
            }, { new: true });
            logWithTimestamp('debug', `Updated driver availability after completion`, {
              driverId,
              isAvailable: updatedDriver?.isAvailable
            });
          }
        }

        // Handle ride cancellation
        if (status === 'cancelled') {
          logWithTimestamp('info', `Processing ride cancellation cleanup`, { rideId });

          // Clean up tracking immediately
          activeTrackingSessions.delete(rideId);
          logWithTimestamp('debug', `Deleted tracking session for cancelled ride`, { rideId });

          const cancellationData = {
            rideId,
            message: 'Ride has been cancelled',
            reason: reason,
            timestamp: new Date()
          };
          io.to(`ride:${rideId}`).emit('ride:cancelled', cancellationData);
          logWithTimestamp('info', `Sent ride cancellation notification`, cancellationData);

          // Update driver availability if driver was assigned
          if (driverId) {
            const updatedDriver = await Driver.findByIdAndUpdate(driverId, {
              isAvailable: true,
              currentRideId: null
            }, { new: true });
            logWithTimestamp('debug', `Updated driver availability after cancellation`, {
              driverId,
              isAvailable: updatedDriver?.isAvailable
            });
          }
        }

      } catch (error) {
        logWithTimestamp('error', `Error updating ride status:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
        socket.emit('error', { message: error.message });
      }
    });

    /**
     * Driver arrived at pickup location
     */
    socket.on('driver:arrived', async (data) => {
      logWithTimestamp('info', `Driver arrived event`, data);

      try {
        const { rideId, driverId, location } = data;

        logWithTimestamp('debug', `Processing driver arrival`, { rideId, driverId, location });

        // FIX: Update ride using findOne with custom rideId
        const ride = await Ride.findOneAndUpdate(
          { rideId: rideId },
          {
            status: 'driver_arrived',
            driverArrivedAt: new Date()
          },
          { new: true }
        );

        if (!ride) {
          logWithTimestamp('error', `Ride not found for driver arrival`, { rideId });
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        logWithTimestamp('debug', `Ride status updated to driver_arrived`, { rideId: ride.rideId });

        const arrivalData = {
          rideId,
          driverId,
          location,
          timestamp: new Date(),
          message: 'Driver has arrived at pickup location'
        };

        // Notify customer
        io.to(`ride:${rideId}`).emit('driver:arrived', arrivalData);
        logWithTimestamp('info', `Sent driver arrived notification to customer`, { rideId });

        // Send push notification to customer
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          logWithTimestamp('debug', `Sending push notification to customer`, { customerId: session.customerId });

          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            logWithTimestamp('debug', `Customer has FCM token, would send push notification`, {
              customerId: session.customerId,
              token: customer.fcmToken.substring(0, 20) + '...'
            });
            // await sendPushNotification(customer.fcmToken, {
            //   title: 'Driver Arrived',
            //   body: 'Your driver has arrived at the pickup location',
            //   data: { rideId, type: 'driver_arrived' }
            // });
          } else {
            logWithTimestamp('warning', `Customer has no FCM token`, { customerId: session.customerId });
          }
        }

      } catch (error) {
        logWithTimestamp('error', `Error in driver arrived:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
        socket.emit('error', { message: error.message });
      }
    });

    /**
     * Ride started
     */
    socket.on('ride:started', async (data) => {
      logWithTimestamp('info', `Ride started event`, data);

      try {
        const { rideId, driverId } = data;

        logWithTimestamp('debug', `Processing ride start`, { rideId, driverId });

        // FIX: Update ride using findOne with custom rideId
        const ride = await Ride.findOneAndUpdate(
          { rideId: rideId },
          {
            status: 'in_progress',
            rideStartedAt: new Date()
          },
          { new: true }
        );

        if (!ride) {
          logWithTimestamp('error', `Ride not found for ride start`, { rideId });
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        logWithTimestamp('debug', `Ride status updated to in_progress`, { rideId: ride.rideId });

        const startData = {
          rideId,
          driverId,
          timestamp: new Date(),
          message: 'Ride has started'
        };

        // Notify customer
        io.to(`ride:${rideId}`).emit('ride:started', startData);
        logWithTimestamp('info', `Sent ride started notification to customer`, { rideId });

        // Send push notification
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          logWithTimestamp('debug', `Sending push notification to customer`, { customerId: session.customerId });

          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            logWithTimestamp('debug', `Customer has FCM token, would send push notification`, {
              customerId: session.customerId,
              token: customer.fcmToken.substring(0, 20) + '...'
            });
            // await sendPushNotification(customer.fcmToken, {
            //   title: 'Ride Started',
            //   body: 'Your ride has started. You can track your journey in real-time.',
            //   data: { rideId, type: 'ride_started' }
            // });
          }
        }

      } catch (error) {
        logWithTimestamp('error', `Error in ride started:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
        socket.emit('error', { message: error.message });
      }
    });

    /**
     * Ride completed by driver
     */
    socket.on('ride:completed', async (data) => {
      logWithTimestamp('info', `Ride completed event`, data);

      try {
        const { rideId, driverId, fare, paymentMethod, tip } = data;

        logWithTimestamp('debug', `Processing ride completion`, {
          rideId,
          driverId,
          fare,
          paymentMethod,
          tip
        });

        // FIX: Update ride using findOne with custom rideId
        const ride = await Ride.findOneAndUpdate(
          { rideId: rideId },
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
          logWithTimestamp('error', `Ride not found for completion`, { rideId });
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        logWithTimestamp('debug', `Ride status updated to completed`, { rideId: ride.rideId });

        // Update driver stats
        const updatedDriver = await Driver.findByIdAndUpdate(driverId, {
          $inc: {
            totalTrips: 1,
            totalEarnings: fare
          },
          isAvailable: true,
          currentRideId: null
        }, { new: true });

        logWithTimestamp('debug', `Updated driver stats after completion`, {
          driverId,
          totalTrips: updatedDriver?.totalTrips,
          totalEarnings: updatedDriver?.totalEarnings,
          isAvailable: updatedDriver?.isAvailable
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
        logWithTimestamp('info', `Sent ride completion notification to customer`, { rideId, fare });

        // Send receipt and rating request
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerId) {
          logWithTimestamp('debug', `Sending completion notification to customer`, { customerId: session.customerId });

          const customer = await Customer.findById(session.customerId);
          if (customer && customer.fcmToken) {
            logWithTimestamp('debug', `Customer has FCM token, would send push notification`, {
              customerId: session.customerId,
              fare
            });
            // await sendPushNotification(customer.fcmToken, {
            //   title: 'Ride Completed',
            //   body: `Your ride is complete. Total fare: ₹${fare}`,
            //   data: { rideId, type: 'ride_completed', fare: fare.toString() }
            // });
          }
        }

        // Clean up tracking session after delay
        setTimeout(() => {
          activeTrackingSessions.delete(rideId);
          global.activeRides.delete(rideId);
          logWithTimestamp('debug', `Cleaned up tracking session after completion`, { rideId });
        }, 10000);

      } catch (error) {
        logWithTimestamp('error', `Error in ride completed:`, {
          error: error.message,
          stack: error.stack,
          data: data
        });
        socket.emit('error', { message: error.message });
      }
    });

    // ==================== SIMPLE CHAT ====================

    /**
     * User joins chat for a ride
     */
    socket.on('chat:join', (data) => {
      try {
        const { rideId, userId, userType } = data;
        console.log("🚀 ~ socket.on ~ chat:join ~ data:", data)
        if (!rideId || !userId) {
          socket.emit('error', { message: 'Ride ID and User ID required' });
          return;
        }
        console.log("🚀 ~ socket.on ~ chat:join ~ rideId:", rideId)
        console.log("🚀 ~ socket.on ~ chat:join ~ userId:", userId)
        console.log("🚀 ~ socket.on ~ chat:join ~ userType:", userType)

        // Store chat info on socket
        socket.chatRideId = rideId;
        socket.chatUserId = userId;
        socket.chatUserType = userType;

        // Join user room for direct messages
        const userRoom = `${userType}:${userId}`;
        socket.join(userRoom);
        logWithTimestamp('debug', `User joined chat: ${userRoom}`);

        // Join ride chat room
        socket.join(`chat:${rideId}`);
        logWithTimestamp('debug', `User joined chat room: chat:${rideId}`);

        // Send confirmation
        socket.emit('chat:joined', {
          success: true,
          rideId,
          message: 'Joined chat successfully'
        });

      } catch (error) {
        logWithTimestamp('error', `Error joining chat:`, error);
        socket.emit('error', { message: error.message });
      }
    });

    /**
     * User leaves chat
     */
    socket.on('chat:leave', (data) => {
      try {
        if (socket.chatRideId) {
          // Leave rooms
          socket.leave(`chat:${socket.chatRideId}`);
          socket.leave(`${socket.chatUserType}:${socket.chatUserId}`);

          // Clear data
          delete socket.chatRideId;
          delete socket.chatUserId;
          delete socket.chatUserType;
        }

        socket.emit('chat:left', { success: true });

      } catch (error) {
        logWithTimestamp('error', `Error leaving chat:`, error);
      }
    });

    /**
     * Send message via socket
     */
    socket.on('chat:send_message', async (data) => {
      try {
        const { rideId, message } = data;
        const userId = socket.chatUserId;
        const userType = socket.chatUserType;

        if (!rideId || !message) {
          socket.emit('error', { message: 'Ride ID and message required' });
          return;
        }

        // Get ride details
        const ride = await Ride.findOne({ rideId: rideId });
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        // Determine receiver
        let senderName, receiverId, receiverType;

        if (userType === 'driver') {
          senderName = ride.driver.name;
          receiverId = ride.customer.customerId;
          receiverType = 'customer';
        } else {
          senderName = ride.customer.name;
          receiverId = ride.driver.driverId;
          receiverType = 'driver';
        }

        // Save to database
        const chatMessage = new ChatMessage({
          rideId,
          senderId: userId,
          senderType: userType,
          senderName,
          receiverId,
          receiverType,
          message
        });

        await chatMessage.save();

        // Prepare message data
        const messageData = {
          _id: chatMessage._id,
          rideId,
          senderId: userId,
          senderType: userType,
          senderName,
          message,
          createdAt: chatMessage.createdAt
        };

        // Send to receiver's personal room
        const receiverRoom = `${receiverType}:${receiverId}`;
        io.to(receiverRoom).emit('chat:new_message', messageData);

        // Also send to ride chat room
        io.to(`chat:${rideId}`).emit('chat:new_message', messageData);

        logWithTimestamp('debug', `Chat message sent: ${rideId}`, {
          from: userType,
          message: message.substring(0, 50)
        });

      } catch (error) {
        logWithTimestamp('error', `Error sending message:`, error);
        socket.emit('error', { message: error.message });
      }
    });

    // ==================== DISCONNECTION HANDLING ====================

    /**
     * Handle client disconnection
     */
    socket.on('disconnect', async (reason) => {
      logWithTimestamp('info', `🔴 Client disconnected from ride tracking`, {
        socketId: socket.id,
        reason,
        userType: socket.userType,
        driverId: socket.driverId,
        customerId: socket.customerId,
        rideId: socket.rideId
      });

      // Handle driver disconnection
      if (socket.userType === 'driver' && socket.driverId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.driverSocketId === socket.id) {
          const reconnectAttempts = (session.driverReconnectAttempts || 0) + 1;
          session.driverSocketId = null;
          session.driverReconnectAttempts = reconnectAttempts;
          session.driverConnected = false;
          activeTrackingSessions.set(socket.rideId, session);

          logWithTimestamp('warning', `Driver disconnected during active ride`, {
            driverId: socket.driverId,
            rideId: socket.rideId,
            reconnectAttempts,
            customerSocketId: session.customerSocketId
          });

          // Notify customer about driver disconnection
          if (session.customerSocketId) {
            io.to(session.customerSocketId).emit('driver:disconnected', {
              driverId: socket.driverId,
              rideId: socket.rideId,
              message: 'Driver lost connection, reconnecting...',
              reconnectAttempts,
              timestamp: new Date()
            });
            logWithTimestamp('debug', `Notified customer about driver disconnection`, {
              rideId: socket.rideId,
              customerSocketId: session.customerSocketId
            });
          }
        }

        // Update driver status in database
        const updatedDriver = await Driver.findByIdAndUpdate(socket.driverId, {
          socketId: null,
          isAvailable: false,
          isOnline: false,
          lastDisconnect: new Date()
        }, { new: true }).catch(err => {
          logWithTimestamp('error', `Error updating driver on disconnect:`, err);
          return null;
        });

        if (updatedDriver) {
          logWithTimestamp('debug', `Updated driver status in database after disconnect`, {
            driverId: socket.driverId,
            isOnline: updatedDriver.isOnline,
            isAvailable: updatedDriver.isAvailable
          });
        }

        // Remove from global map
        const removed = global.activeDrivers.delete(socket.driverId);
        logWithTimestamp('debug', `Removed driver from global active drivers map`, {
          driverId: socket.driverId,
          wasRemoved: removed
        });
      }

      // Handle customer disconnection
      if (socket.userType === 'customer' && socket.customerId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.customerSocketId === socket.id) {
          session.customerSocketId = null;
          activeTrackingSessions.set(socket.rideId, session);
          logWithTimestamp('warning', `Customer disconnected from tracking`, {
            customerId: socket.customerId,
            rideId: socket.rideId
          });
        }

        // Remove from global map
        const removed = global.activeCustomers.delete(socket.customerId);
        logWithTimestamp('debug', `Removed customer from global active customers map`, {
          customerId: socket.customerId,
          wasRemoved: removed
        });
      }

      // Handle chat disconnection cleanup
      if (socket.chatRideId) {
        socket.leave(`chat:${socket.chatRideId}`);
        socket.leave(`${socket.chatUserType}:${socket.chatUserId}`);
        logWithTimestamp('debug', `Cleaned up chat rooms for disconnected user`, {
          chatRideId: socket.chatRideId,
          chatUserType: socket.chatUserType,
          chatUserId: socket.chatUserId
        });
      }

      // Leave all rooms
      if (socket.rideId) {
        socket.leave(`ride:${socket.rideId}`);
        logWithTimestamp('debug', `Client left ride room`, { rideId: socket.rideId });
      }

      // Log current state after disconnect
      logWithTimestamp('debug', `Current tracking sessions count: ${activeTrackingSessions.size}`, {
        activeDrivers: global.activeDrivers.size,
        activeCustomers: global.activeCustomers.size,
        activeRides: global.activeRides.size
      });
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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  // Log distance calculation for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] Distance calculation: ${lat1},${lon1} -> ${lat2},${lon2} = ${distance.toFixed(2)}km`);
  }

  return distance;
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

  const speed = speeds[vehicleType] || 25;

  // Log speed for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] Vehicle type: ${vehicleType}, average speed: ${speed}km/h`);
  }

  return speed;
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

  const message = messages[status] || 'Status updated';

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] Status message for ${status}: ${message}`);
  }

  return message;
}

// Export for use in other files
export { calculateDistance, getAverageSpeed, getStatusMessage };