import Pusher from 'pusher';
import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Store active tracking sessions
const activeTrackingSessions = new Map(); // rideId -> { driverId, customerId, lastLocation, channelName }

class PusherService {
  constructor() {
    this.pusher = pusher;
    this.activeSessions = activeTrackingSessions;
  }

  getPusher() {
    return this.pusher;
  }

  getRideChannel(rideId) {
    return `private-ride-${rideId}`;
  }

  authenticate(socketId, channelName) {
    return this.pusher.authenticate(socketId, channelName);
  }

  async joinDriverTracking(driverId, rideId) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      if (!this.activeSessions.has(rideId)) {
        this.activeSessions.set(rideId, {
          driverId: driverId,
          customerId: null,
          lastLocation: null,
          channelName: channelName
        });
      } else {
        const session = this.activeSessions.get(rideId);
        session.driverId = driverId;
        this.activeSessions.set(rideId, session);
      }

      await Driver.findByIdAndUpdate(driverId, {
        isOnline: true,
        isAvailable: false,
        lastOnlineAt: new Date(),
        currentRide: rideId
      });

      console.log(`🚗 Driver ${driverId} joined tracking for ride ${rideId}`);

      await this.pusher.trigger(channelName, 'tracking:joined', {
        rideId,
        userType: 'driver',
        message: 'Successfully joined ride tracking'
      });

      const session = this.activeSessions.get(rideId);
      if (session.customerId) {
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

  async joinCustomerTracking(customerId, rideId) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      if (!this.activeSessions.has(rideId)) {
        this.activeSessions.set(rideId, {
          driverId: null,
          customerId: customerId,
          lastLocation: null,
          channelName: channelName
        });
      } else {
        const session = this.activeSessions.get(rideId);
        session.customerId = customerId;
        this.activeSessions.set(rideId, session);
      }

      console.log(`👤 Customer ${customerId} joined tracking for ride ${rideId}`);

      const ride = await Ride.findOne({ rideId });

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

      const session = this.activeSessions.get(rideId);
      if (session.driverId) {
        await this.pusher.trigger(channelName, 'driver:send-location', {
          rideId,
          customerId
        });

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

  async updateDriverLocation(driverId, rideId, latitude, longitude, bearing = null) {
    try {
      if (!latitude || !longitude) return;

      const channelName = this.getRideChannel(rideId);
      const session = this.activeSessions.get(rideId);

      await Driver.findByIdAndUpdate(driverId, {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      }).catch(err => console.error('Error updating driver location:', err));

      const ride = await Ride.findOne({ rideId, 'driver.driverId': driverId });
      
      let eta = null;
      let etaText = null;
      let remainingDistance = null;

      if (ride) {
        if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
          const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
          const distanceToPickup = this.calculateDistance(latitude, longitude, pickupLat, pickupLon);
          const speed = this.getAverageSpeed(ride.driver?.vehicleType);
          eta = Math.ceil((distanceToPickup / speed) * 60);
          etaText = `${eta} mins`;
          remainingDistance = distanceToPickup;
        } else if (ride.status === 'in_progress') {
          const [dropLon, dropLat] = ride.dropLocation.coordinates;
          const distanceToDrop = this.calculateDistance(latitude, longitude, dropLat, dropLon);
          const speed = this.getAverageSpeed(ride.driver?.vehicleType);
          eta = Math.ceil((distanceToDrop / speed) * 60);
          etaText = `${eta} mins`;
          remainingDistance = distanceToDrop;

          if (distanceToDrop <= 0.1 && !ride.nearDestination) {
            ride.nearDestination = true;
            await ride.save();
            
            if (session?.customerId) {
              await this.pusher.trigger(channelName, 'ride:near-destination', {
                rideId,
                message: 'You are near your destination',
                remainingDistance: distanceToDrop * 1000
              });
            }
          }
        }
      }

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

      if (session) {
        session.lastLocation = locationData;
        this.activeSessions.set(rideId, session);
      }

      await this.pusher.trigger(channelName, 'driver:location-updated', locationData);
      await this.pusher.trigger('admin-rides', 'driver:live-location', locationData);

      return { success: true };
    } catch (error) {
      console.error('Error updating driver location:', error);
      throw error;
    }
  }

  async updateRideStatus(rideId, status, driverId, location = null) {
    try {
      const channelName = this.getRideChannel(rideId);
      
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
      
      await this.pusher.trigger(channelName, 'ride:status-changed', statusData);
      
      if (status === 'completed') {
        this.activeSessions.delete(rideId);
        
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

  async driverArrived(rideId, driverId, location) {
    try {
      const channelName = this.getRideChannel(rideId);
      
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
      
      await this.pusher.trigger(channelName, 'driver:arrived', arrivalData);
      
      return { success: true };
    } catch (error) {
      console.error('Error in driverArrived:', error);
      throw error;
    }
  }

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

  async rideCompleted(rideId, driverId, fare, paymentMethod) {
    try {
      const channelName = this.getRideChannel(rideId);
      
      const ride = await Ride.findOneAndUpdate(
        { rideId },
        {
          status: 'completed',
          rideCompletedAt: new Date()
        },
        { new: true }
      );
      
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
      
      this.activeSessions.delete(rideId);
      
      return { success: true };
    } catch (error) {
      console.error('Error in rideCompleted:', error);
      throw error;
    }
  }

  async handleDriverDisconnect(driverId, rideId) {
    try {
      const session = this.activeSessions.get(rideId);
      if (session && session.driverId === driverId) {
        session.driverId = null;
        this.activeSessions.set(rideId, session);
        
        await Driver.findByIdAndUpdate(driverId, {
          isAvailable: false,
          isOnline: false,
          currentRide: null
        });
        
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

  async handleCustomerDisconnect(customerId, rideId) {
    try {
      const session = this.activeSessions.get(rideId);
      if (session && session.customerId === customerId) {
        session.customerId = null;
        this.activeSessions.set(rideId, session);
      }
    } catch (error) {
      console.error('Error handling customer disconnect:', error);
    }
  }

  cleanupRideSession(rideId) {
    this.activeSessions.delete(rideId);
  }

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

  getSession(rideId) {
    return this.activeSessions.get(rideId);
  }
}

export default new PusherService();