import axios from 'axios';
import Driver from '../models/Driver.js';
import Ride from '../models/Ride.js';

class PusherService {
  constructor() {
    this.appId = process.env.PUSHER_APP_ID;
    this.key = process.env.PUSHER_KEY;
    this.secret = process.env.PUSHER_SECRET;
    this.cluster = process.env.PUSHER_CLUSTER;
    this.activeSessions = new Map();
    
    // Use HTTPS with standard port 443 (Hostinger allows this)
    this.apiBaseUrl = `https://api-${this.cluster}.pusher.com`;
  }

  // Generate Pusher auth signature
  generateAuthSignature(method, path, body, timestamp) {
    const crypto = require('crypto');
    const stringToSign = `${method}\n${path}\n${JSON.stringify(body)}\n${timestamp}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('hex');
    return signature;
  }

  // Send event via HTTP POST (standard HTTPS, not WebSocket)
  async triggerEvent(channel, event, data) {
    try {
      const path = `/apps/${this.appId}/events`;
      const timestamp = Math.floor(Date.now() / 1000);
      const body = {
        name: event,
        channel: channel,
        data: JSON.stringify(data)
      };
      
      const signature = this.generateAuthSignature('POST', path, body, timestamp);
      
      // Use axios with timeout and retry
      const response = await axios({
        method: 'POST',
        url: `${this.apiBaseUrl}${path}`,
        params: {
          auth_key: this.key,
          auth_timestamp: timestamp,
          auth_version: '1.0',
          auth_signature: signature,
          body_md5: require('crypto').createHash('md5').update(JSON.stringify(body)).digest('hex')
        },
        data: body,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });
      
      return response.data;
    } catch (error) {
      // Log error but don't crash
      console.error('Pusher trigger error:', error.response?.data || error.message);
      return null;
    }
  }

  getRideChannel(rideId) {
    return `private-ride-${rideId}`;
  }

  // Client authentication (this is just string generation, no network call)
  authenticate(socketId, channelName) {
    const crypto = require('crypto');
    const stringToSign = `${socketId}:${channelName}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('hex');
    
    return {
      auth: `${this.key}:${signature}`
    };
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

      await this.triggerEvent(channelName, 'tracking:joined', {
        rideId,
        userType: 'driver',
        message: 'Successfully joined ride tracking'
      });

      const session = this.activeSessions.get(rideId);
      if (session.customerId) {
        await this.triggerEvent(channelName, 'driver:online', {
          driverId,
          rideId,
          message: 'Driver is online and tracking started'
        });
      }

      return { success: true, channelName };
    } catch (error) {
      console.error('Error in joinDriverTracking:', error);
      return { success: false, error: error.message };
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

      await this.triggerEvent(channelName, 'tracking:joined', {
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
        await this.triggerEvent(channelName, 'driver:send-location', {
          rideId,
          customerId
        });

        const driver = await Driver.findById(session.driverId);
        if (driver && driver.currentLocation) {
          const [lng, lat] = driver.currentLocation.coordinates;
          await this.triggerEvent(channelName, 'driver:location-updated', {
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
      return { success: false, error: error.message };
    }
  }

  async updateDriverLocation(driverId, rideId, latitude, longitude, bearing = null) {
    try {
      if (!latitude || !longitude) return { success: false };

      const channelName = this.getRideChannel(rideId);
      const session = this.activeSessions.get(rideId);

      // Update DB (don't await - let it run in background)
      Driver.findByIdAndUpdate(driverId, {
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
              await this.triggerEvent(channelName, 'ride:near-destination', {
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

      // Fire and forget - don't wait for response
      this.triggerEvent(channelName, 'driver:location-updated', locationData).catch(e => console.error);
      this.triggerEvent('admin-rides', 'driver:live-location', locationData).catch(e => console.error);

      return { success: true };
    } catch (error) {
      console.error('Error updating driver location:', error);
      return { success: false, error: error.message };
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
      
      await this.triggerEvent(channelName, 'ride:status-changed', statusData);
      
      if (status === 'completed') {
        this.activeSessions.delete(rideId);
        
        await this.triggerEvent(channelName, 'ride:completed', {
          rideId,
          message: 'Ride completed successfully',
          timestamp: new Date()
        });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error updating ride status:', error);
      return { success: false, error: error.message };
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
      
      await this.triggerEvent(channelName, 'driver:arrived', arrivalData);
      
      return { success: true };
    } catch (error) {
      console.error('Error in driverArrived:', error);
      return { success: false, error: error.message };
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
      
      await this.triggerEvent(channelName, 'ride:started', startData);
      
      return { success: true };
    } catch (error) {
      console.error('Error in rideStarted:', error);
      return { success: false, error: error.message };
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
      
      await this.triggerEvent(channelName, 'ride:completed', completeData);
      
      this.activeSessions.delete(rideId);
      
      return { success: true };
    } catch (error) {
      console.error('Error in rideCompleted:', error);
      return { success: false, error: error.message };
    }
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
      'bike': 30, 'auto': 25, 'car': 30,
      'mini_truck': 25, 'truck': 20,
      'Tata Ace': 30, 'Eicher': 25, 'Mahindra Pickup': 28,
      'Tata 407': 25, 'Ashok Leyland': 22, 'Force Trump': 23,
      'BharatBenz': 22, 'Mahindra Furio': 25, 'Tata Ultra': 24
    };
    return speeds[vehicleType] || 25;
  }

  getSession(rideId) {
    return this.activeSessions.get(rideId);
  }
}

export default new PusherService();