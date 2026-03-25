// sockets/rideTrackingSocket.js
import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';

// Store active tracking sessions
const activeTrackingSessions = new Map(); // rideId -> { driverSocketId, customerSocketId, lastLocation }

export const initializeRideTrackingSockets = (io) => {
  const rideTrackingNsp = io.of('/ride-tracking');
  
  rideTrackingNsp.on('connection', (socket) => {
    console.log(`🟢 Ride tracking client connected: ${socket.id}`);
    console.log(socket);
    
    // Driver joins for real-time location updates
    socket.on('driver:join-tracking', async (data) => {
      try {
        const { driverId, rideId } = data;
        
        if (!driverId || !rideId) {
          socket.emit('error', { message: 'Driver ID and Ride ID are required' });
          return;
        }
        
        // Store driver connection
        socket.driverId = driverId;
        socket.rideId = rideId;
        socket.userType = 'driver';
        
        // Join ride room
        socket.join(`ride:${rideId}`);
        
        // Update global tracking
        if (!activeTrackingSessions.has(rideId)) {
          activeTrackingSessions.set(rideId, {
            driverSocketId: socket.id,
            customerSocketId: null,
            lastLocation: null,
            driverId: driverId,
            customerId: null
          });
        } else {
          const session = activeTrackingSessions.get(rideId);
          session.driverSocketId = socket.id;
          session.driverId = driverId;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Update driver in global map
        global.activeDrivers?.set(driverId, socket.id);
        
        // Update driver status in database
        await Driver.findByIdAndUpdate(driverId, {
          socketId: socket.id,
          isOnline: true,
          isAvailable: false,
          lastOnlineAt: new Date()
        });
        
        console.log(`🚗 Driver ${driverId} joined tracking for ride ${rideId}`);
        
        // Send confirmation
        socket.emit('tracking:joined', {
          rideId,
          userType: 'driver',
          message: 'Successfully joined ride tracking'
        });
        
        // If there's a customer already tracking, notify them
        const session = activeTrackingSessions.get(rideId);
        if (session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:online', {
            driverId,
            rideId,
            message: 'Driver is online and tracking started'
          });
        }
        
      } catch (error) {
        console.error('Error in driver join tracking:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    // Customer joins to track driver
    socket.on('customer:join-tracking', async (data) => {
      try {
        const { customerId, rideId } = data;
        
        if (!customerId || !rideId) {
          socket.emit('error', { message: 'Customer ID and Ride ID are required' });
          return;
        }
        
        // Store customer connection
        socket.customerId = customerId;
        socket.rideId = rideId;
        socket.userType = 'customer';
        
        // Join ride room
        socket.join(`ride:${rideId}`);
        
        // Update global tracking
        if (!activeTrackingSessions.has(rideId)) {
          activeTrackingSessions.set(rideId, {
            driverSocketId: null,
            customerSocketId: socket.id,
            lastLocation: null,
            driverId: null,
            customerId: customerId
          });
        } else {
          const session = activeTrackingSessions.get(rideId);
          session.customerSocketId = socket.id;
          session.customerId = customerId;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Update customer in global map
        global.activeCustomers?.set(customerId, socket.id);
        
        console.log(`👤 Customer ${customerId} joined tracking for ride ${rideId}`);
        
        // Get ride details
        const ride = await Ride.findOne({ rideId });
        
        // Send initial ride info
        socket.emit('tracking:joined', {
          rideId,
          userType: 'customer',
          rideDetails: {
            pickupLocation: ride?.pickupLocation,
            dropLocation: ride?.dropLocation,
            status: ride?.status,
            fare: ride?.fare,
            driver: ride?.driver
          }
        });
        
        // If driver is already tracking, request immediate location
        const session = activeTrackingSessions.get(rideId);
        if (session.driverSocketId) {
          // Request current location from driver
          io.to(session.driverSocketId).emit('driver:send-location', {
            rideId,
            customerId
          });
          
          // Send driver details
          const driver = await Driver.findById(session.driverId);
          if (driver && driver.currentLocation) {
            const [lng, lat] = driver.currentLocation.coordinates;
            socket.emit('driver:location-updated', {
              driverId: session.driverId,
              latitude: lat,
              longitude: lng,
              rideId,
              timestamp: new Date(),
              driverDetails: {
                name: driver.name,
                phone: driver.phone,
                vehicleType: driver.vehicleType,
                vehicleNumber: driver.vehicleNumber,
                rating: driver.rating
              }
            });
          }
        }
        
      } catch (error) {
        console.error('Error in customer join tracking:', error);
        socket.emit('error', { message: error.message });
      }
    });
    
    // Driver sends location update (high frequency)
    socket.on('driver:location-update', async (data) => {
      try {
        const { driverId, rideId, latitude, longitude } = data;
        
        if (!latitude || !longitude) {
          return;
        }
        
        // Update database (async, don't await for performance)
        Driver.findByIdAndUpdate(driverId, {
          currentLocation: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          lastActive: new Date()
        }).catch(err => console.error('Error updating driver location in DB:', err));
        
        // Get ride and calculate ETA
        const ride = await Ride.findOne({ rideId, 'driver.driverId': driverId });
        
        let eta = null;
        let etaText = null;
        let remainingDistance = null;
        
        if (ride) {
          // Calculate ETA based on ride status
          if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
            // Going to pickup
            const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
            const distanceToPickup = calculateDistance(latitude, longitude, pickupLat, pickupLon);
            const speed = getAverageSpeed(ride.driver.vehicleType);
            eta = Math.ceil((distanceToPickup / speed) * 60);
            etaText = `${eta} mins`;
            remainingDistance = distanceToPickup;
          } else if (ride.status === 'in_progress') {
            // Going to drop
            const [dropLon, dropLat] = ride.dropLocation.coordinates;
            const distanceToDrop = calculateDistance(latitude, longitude, dropLat, dropLon);
            const speed = getAverageSpeed(ride.driver.vehicleType);
            eta = Math.ceil((distanceToDrop / speed) * 60);
            etaText = `${eta} mins`;
            remainingDistance = distanceToDrop;
            
            // Check if near destination (within 100m)
            if (distanceToDrop <= 0.1 && !ride.nearDestination) {
              ride.nearDestination = true;
              await ride.save();
              
              // Notify customer
              const session = activeTrackingSessions.get(rideId);
              if (session && session.customerSocketId) {
                io.to(session.customerSocketId).emit('ride:near-destination', {
                  rideId,
                  message: 'You are near your destination',
                  remainingDistance: distanceToDrop * 1000
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
          etaText,
          remainingDistance,
          bearing: data.bearing || null // Optional: direction
        };
        
        // Store last location
        const session = activeTrackingSessions.get(rideId);
        if (session) {
          session.lastLocation = locationData;
          activeTrackingSessions.set(rideId, session);
        }
        
        // Broadcast to customer in the same ride room
        socket.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        
        // Also emit to specific customer if known
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:location-updated', locationData);
        }
        
        // Broadcast to admin for monitoring (optional)
        io.of('/admin').to('admin-room').emit('driver:live-location', locationData);
        
      } catch (error) {
        console.error('Error updating driver location:', error);
      }
    });
    
    // Driver sends location on request (single update)
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
          const customerSocketId = global.activeCustomers?.get(customerId);
          if (customerSocketId) {
            io.to(customerSocketId).emit('driver:location-updated', locationData);
          }
        }
        
        // Also broadcast to ride room
        io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
        
      } catch (error) {
        console.error('Error sending location response:', error);
      }
    });
    
    // Driver status change (online/offline, available/busy)
    socket.on('driver:status-change', async (data) => {
      try {
        const { driverId, rideId, isOnline, isAvailable } = data;
        
        await Driver.findByIdAndUpdate(driverId, {
          isOnline,
          isAvailable,
          lastOnlineAt: isOnline ? new Date() : null
        });
        
        const statusData = {
          driverId,
          isOnline,
          isAvailable,
          rideId,
          timestamp: new Date()
        };
        
        // Broadcast to customer
        if (rideId) {
          socket.to(`ride:${rideId}`).emit('driver:status-changed', statusData);
        }
        
        // Broadcast to admin
        io.of('/admin').to('admin-room').emit('driver:status-changed', statusData);
        
      } catch (error) {
        console.error('Error updating driver status:', error);
      }
    });
    
    // Ride status update (accepted, arrived, started, completed)
    socket.on('ride:status-update', async (data) => {
      try {
        const { rideId, status, driverId, location } = data;
        
        // Update ride in database
        const ride = await Ride.findOne({ rideId });
        if (ride) {
          ride.updateStatus(status);
          
          // Update timestamps based on status
          switch(status) {
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
          }
          
          await ride.save();
        }
        
        const statusData = {
          rideId,
          status,
          driverId,
          location,
          timestamp: new Date()
        };
        
        // Broadcast to ride room
        io.to(`ride:${rideId}`).emit('ride:status-changed', statusData);
        
        // If ride completed, clean up tracking session
        if (status === 'completed') {
          const session = activeTrackingSessions.get(rideId);
          if (session) {
            activeTrackingSessions.delete(rideId);
          }
          
          // Notify both parties
          io.to(`ride:${rideId}`).emit('ride:completed', {
            rideId,
            message: 'Ride completed successfully',
            timestamp: new Date()
          });
        }
        
      } catch (error) {
        console.error('Error updating ride status:', error);
      }
    });
    
    // Driver arrived at pickup
    socket.on('driver:arrived', async (data) => {
      try {
        const { rideId, driverId, location } = data;
        
        // Update ride status
        await Ride.findOneAndUpdate(
          { rideId },
          {
            status: 'driver_arrived',
            driverArrivedAt: new Date()
          }
        );
        
        const arrivalData = {
          rideId,
          driverId,
          location,
          timestamp: new Date(),
          message: 'Driver has arrived at pickup location'
        };
        
        // Notify customer
        socket.to(`ride:${rideId}`).emit('driver:arrived', arrivalData);
        
        // Also notify through specific customer socket
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:arrived', arrivalData);
        }
        
      } catch (error) {
        console.error('Error in driver arrived:', error);
      }
    });
    
    // Ride started
    socket.on('ride:started', async (data) => {
      try {
        const { rideId, driverId } = data;
        
        await Ride.findOneAndUpdate(
          { rideId },
          {
            status: 'in_progress',
            rideStartedAt: new Date()
          }
        );
        
        const startData = {
          rideId,
          driverId,
          timestamp: new Date(),
          message: 'Ride has started'
        };
        
        socket.to(`ride:${rideId}`).emit('ride:started', startData);
        
        // Notify customer
        const session = activeTrackingSessions.get(rideId);
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('ride:started', startData);
        }
        
      } catch (error) {
        console.error('Error in ride started:', error);
      }
    });
    
    // Ride completed
    socket.on('ride:completed', async (data) => {
      try {
        const { rideId, driverId, fare, paymentMethod } = data;
        
        // Update ride
        const ride = await Ride.findOneAndUpdate(
          { rideId },
          {
            status: 'completed',
            rideCompletedAt: new Date()
          },
          { new: true }
        );
        
        // Update driver stats
        await Driver.findByIdAndUpdate(driverId, {
          $inc: {
            totalTrips: 1,
            totalEarnings: fare
          },
          isAvailable: true
        });
        
        const completeData = {
          rideId,
          driverId,
          fare,
          paymentMethod,
          timestamp: new Date(),
          message: 'Ride completed successfully'
        };
        
        socket.to(`ride:${rideId}`).emit('ride:completed', completeData);
        
        // Clean up tracking session
        activeTrackingSessions.delete(rideId);
        
      } catch (error) {
        console.error('Error in ride completed:', error);
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`🔴 Client disconnected from ride tracking: ${socket.id}`);
      
      // Clean up based on user type
      if (socket.userType === 'driver' && socket.driverId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.driverSocketId === socket.id) {
          session.driverSocketId = null;
          activeTrackingSessions.set(socket.rideId, session);
        }
        
        // Update driver status in database
        await Driver.findByIdAndUpdate(socket.driverId, {
          socketId: null,
          isAvailable: false,
          isOnline: false
        }).catch(err => console.error('Error updating driver on disconnect:', err));
        
        // Notify customer if connected
        if (session && session.customerSocketId) {
          io.to(session.customerSocketId).emit('driver:disconnected', {
            driverId: socket.driverId,
            rideId: socket.rideId,
            message: 'Driver lost connection, reconnecting...'
          });
        }
      }
      
      if (socket.userType === 'customer' && socket.customerId && socket.rideId) {
        const session = activeTrackingSessions.get(socket.rideId);
        if (session && session.customerSocketId === socket.id) {
          session.customerSocketId = null;
          activeTrackingSessions.set(socket.rideId, session);
        }
      }
    });
  });
};

// Helper function to calculate distance using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Helper function to get average speed based on vehicle type (km/h)
function getAverageSpeed(vehicleType) {
  const speeds = {
    'bike': 30,
    'auto': 25,
    'car': 30,
    'mini_truck': 25,
    'truck': 20,
    'Tata Ace': 30,
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