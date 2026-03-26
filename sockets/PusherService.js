// services/pusherService.js
import Pusher from 'pusher';
import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';

// Initialize Pusher server-side
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Store active tracking sessions (in-memory)
const activeTrackingSessions = new Map(); // rideId -> { driverId, customerId, lastLocation, channelName }

class PusherService {
  constructor() {
    this.pusher = pusher;
    this.activeSessions = activeTrackingSessions;
  }

  // Get Pusher instance
  getPusher() {
    return this.pusher;
  }

  // Generate channel name for ride tracking
  getRideChannel(rideId) {
    return `private-ride-${rideId}`;
  }

  // Authenticate private channel
  authenticate(socketId, channelName) {
    return this.pusher.authenticate(socketId, channelName);
  }

  // Join driver to ride tracking
  async joinDriverTracking(driverId, rideId, socketId) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      // Store session
      if (!this.activeSessions.has(rideId)) {
        this.activeSessions.set(rideId, {
          driverId: driverId,
          customerId: null,
          lastLocation: null,
          channelName: channelName,
          driverSocketId: socketId,
          customerSocketId: null
        });
      } else {
        const session = this.activeSessions.get(rideId);
        session.driverId = driverId;
        session.driverSocketId = socketId;
        this.activeSessions.set(rideId, session);
      }

      // Update driver status in database
      await Driver.findByIdAndUpdate(driverId, {
        isOnline: true,
        isAvailable: false,
        lastOnlineAt: new Date(),
        currentRide: rideId
      });

      console.log(`🚗 Driver ${driverId} joined tracking for ride ${rideId}`);

      // Trigger confirmation to driver
      await this.pusher.trigger(channelName, 'tracking:joined', {
        rideId,
        userType: 'driver',
        message: 'Successfully joined ride tracking'
      });

      // If customer is already tracking, notify them
      const session = this.activeSessions.get(rideId);
      if (session.customerSocketId) {
        await this.pusher.trigger(channelName, 'driver:online', {
          driverId,
          rideId,
          message: 'Driver is online and tracking started'
        });
      }

      return { success: true, channelName };
    } catch (error) {
      console.error('Error in joinDriverTracking:', error);
      throw error;
    }
  }

  // Join customer to ride tracking
  async joinCustomerTracking(customerId, rideId, socketId) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      // Store session
      if (!this.activeSessions.has(rideId)) {
        this.activeSessions.set(rideId, {
          driverId: null,
          customerId: customerId,
          lastLocation: null,
          channelName: channelName,
          driverSocketId: null,
          customerSocketId: socketId
        });
      } else {
        const session = this.activeSessions.get(rideId);
        session.customerId = customerId;
        session.customerSocketId = socketId;
        this.activeSessions.set(rideId, session);
      }

      console.log(`👤 Customer ${customerId} joined tracking for ride ${rideId}`);

      // Get ride details
      const ride = await Ride.findOne({ rideId });

      // Send initial ride info
      await this.pusher.trigger(channelName, 'tracking:joined', {
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
      const session = this.activeSessions.get(rideId);
      if (session.driverId) {
        // Request current location from driver
        await this.pusher.trigger(channelName, 'driver:send-location', {
          rideId,
          customerId
        });

        // Send driver details and last known location
        const driver = await Driver.findById(session.driverId);
        if (driver && driver.currentLocation) {
          const [lng, lat] = driver.currentLocation.coordinates;
          await this.pusher.trigger(channelName, 'driver:location-updated', {
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

      return { success: true, channelName };
    } catch (error) {
      console.error('Error in joinCustomerTracking:', error);
      throw error;
    }
  }

  // Update driver location
  async updateDriverLocation(driverId, rideId, latitude, longitude, bearing = null) {
    try {
      if (!latitude || !longitude) return;

      const channelName = this.getRideChannel(rideId);
      const session = this.activeSessions.get(rideId);

      // Update database asynchronously
      Driver.findByIdAndUpdate(driverId, {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      }).catch(err => console.error('Error updating driver location:', err));

      // Get ride and calculate ETA
      const ride = await Ride.findOne({ rideId, 'driver.driverId': driverId });
      
      let eta = null;
      let etaText = null;
      let remainingDistance = null;

      if (ride) {
        if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
          // Going to pickup
          const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
          const distanceToPickup = this.calculateDistance(latitude, longitude, pickupLat, pickupLon);
          const speed = this.getAverageSpeed(ride.driver?.vehicleType);
          eta = Math.ceil((distanceToPickup / speed) * 60);
          etaText = `${eta} mins`;
          remainingDistance = distanceToPickup;
        } else if (ride.status === 'in_progress') {
          // Going to drop
          const [dropLon, dropLat] = ride.dropLocation.coordinates;
          const distanceToDrop = this.calculateDistance(latitude, longitude, dropLat, dropLon);
          const speed = this.getAverageSpeed(ride.driver?.vehicleType);
          eta = Math.ceil((distanceToDrop / speed) * 60);
          etaText = `${eta} mins`;
          remainingDistance = distanceToDrop;

          // Check if near destination (within 100m)
          if (distanceToDrop <= 0.1 && !ride.nearDestination) {
            ride.nearDestination = true;
            await ride.save();
            
            // Notify customer
            if (session && session.customerId) {
              await this.pusher.trigger(channelName, 'ride:near-destination', {
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
        bearing: bearing || null
      };

      // Store last location
      if (session) {
        session.lastLocation = locationData;
        this.activeSessions.set(rideId, session);
      }

      // Broadcast to all clients in ride channel
      await this.pusher.trigger(channelName, 'driver:location-updated', locationData);

      // Also broadcast to admin for monitoring
      await this.pusher.trigger('admin-rides', 'driver:live-location', locationData);

      return { success: true };
    } catch (error) {
      console.error('Error updating driver location:', error);
      throw error;
    }
  }

  // Update ride status
  async updateRideStatus(rideId, status, driverId, location = null) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      // Update ride in database
      const ride = await Ride.findOne({ rideId });
      if (ride) {
        ride.updateStatus(status);
        
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
      
      // Broadcast to ride channel
      await this.pusher.trigger(channelName, 'ride:status-changed', statusData);
      
      // If ride completed, clean up tracking session
      if (status === 'completed') {
        this.activeSessions.delete(rideId);
        
        // Notify completion
        await this.pusher.trigger(channelName, 'ride:completed', {
          rideId,
          message: 'Ride completed successfully',
          timestamp: new Date()
        });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error updating ride status:', error);
      throw error;
    }
  }

  // Driver arrived at pickup
  async driverArrived(rideId, driverId, location) {
    try {
      const channelName = this.getRideChannel(rideId);
      
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
      await this.pusher.trigger(channelName, 'driver:arrived', arrivalData);
      
      return { success: true };
    } catch (error) {
      console.error('Error in driverArrived:', error);
      throw error;
    }
  }

  // Ride started
  async rideStarted(rideId, driverId) {
    try {
      const channelName = this.getRideChannel(rideId);
      
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
      
      await this.pusher.trigger(channelName, 'ride:started', startData);
      
      return { success: true };
    } catch (error) {
      console.error('Error in rideStarted:', error);
      throw error;
    }
  }

  // Ride completed
  async rideCompleted(rideId, driverId, fare, paymentMethod) {
    try {
      const channelName = this.getRideChannel(rideId);
      
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
        isAvailable: true,
        currentRide: null
      });
      
      const completeData = {
        rideId,
        driverId,
        fare,
        paymentMethod,
        timestamp: new Date(),
        message: 'Ride completed successfully'
      };
      
      await this.pusher.trigger(channelName, 'ride:completed', completeData);
      
      // Clean up tracking session
      this.activeSessions.delete(rideId);
      
      return { success: true };
    } catch (error) {
      console.error('Error in rideCompleted:', error);
      throw error;
    }
  }

  // Handle driver disconnection
  async handleDriverDisconnect(driverId, rideId, socketId) {
    try {
      const session = this.activeSessions.get(rideId);
      if (session && session.driverSocketId === socketId) {
        session.driverSocketId = null;
        session.driverId = null;
        this.activeSessions.set(rideId, session);
        
        // Update driver status
        await Driver.findByIdAndUpdate(driverId, {
          isAvailable: false,
          isOnline: false,
          currentRide: null
        });
        
        // Notify customer if connected
        if (session.customerId) {
          const channelName = this.getRideChannel(rideId);
          await this.pusher.trigger(channelName, 'driver:disconnected', {
            driverId,
            rideId,
            message: 'Driver lost connection, reconnecting...'
          });
        }
      }
    } catch (error) {
      console.error('Error handling driver disconnect:', error);
    }
  }

  // Handle customer disconnection
  async handleCustomerDisconnect(customerId, rideId, socketId) {
    try {
      const session = this.activeSessions.get(rideId);
      if (session && session.customerSocketId === socketId) {
        session.customerSocketId = null;
        session.customerId = null;
        this.activeSessions.set(rideId, session);
      }
    } catch (error) {
      console.error('Error handling customer disconnect:', error);
    }
  }

  // Clean up ride session
  cleanupRideSession(rideId) {
    this.activeSessions.delete(rideId);
  }

  // Helper: Calculate distance using Haversine formula
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Helper: Get average speed based on vehicle type
  getAverageSpeed(vehicleType) {
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

  // Get active session
  getSession(rideId) {
    return this.activeSessions.get(rideId);
  }
}

export default new PusherService();