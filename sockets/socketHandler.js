import Driver from '../models/Driver.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';

const initializeSockets = (io) => {
  // ============== NAMESPACES ==============
  const adminNsp = io.of('/admin');
  const driversNsp = io.of('/drivers');
  const bookingsNsp = io.of('/bookings');

  // Auto-offline: Mark drivers as offline if no activity for 180 minutes
  const INACTIVITY_TIMEOUT = 180 * 60 * 1000; // 180 minutes
  setInterval(async () => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - INACTIVITY_TIMEOUT);
      
      const inactiveDrivers = await Driver.find({
        isOnline: true,
        lastOnlineAt: { $lt: fiveMinutesAgo }
      });
      
      if (inactiveDrivers.length > 0) {
        console.log(`Auto-offlining ${inactiveDrivers.length} inactive drivers`);
        
        for (const driver of inactiveDrivers) {
          await Driver.findByIdAndUpdate(driver._id, {
            isOnline: false,
            isAvailable: false,
            socketId: null
          });
          
          io.emit('driver:offline', {
            driverId: driver._id,
            reason: 'inactivity',
            timestamp: new Date()
          });
          
          io.emit('drivers:update', {
            type: 'driver_offline',
            driverId: driver._id,
            reason: 'inactivity',
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      console.error('Error in auto-offline check:', error);
    }
  }, 120000); // Check every minute

  // ============== ADMIN NAMESPACE ==============
  adminNsp.on('connection', (socket) => {
    console.log(`Admin connected: ${socket.id}`);
    
    socket.join('admin-room');
    
    // Send initial stats
    emitDashboardStats(socket);
    
    socket.on('disconnect', () => {
      console.log(`Admin disconnected: ${socket.id}`);
    });
  });

  // ============== DRIVERS NAMESPACE ==============
  driversNsp.on('connection', (socket) => {
    console.log(`Driver client connected: ${socket.id}`);
    
    socket.on('driver:join', async (driverId) => {
      if (driverId) {
        socket.join(`driver:${driverId}`);
        socket.driverId = driverId;
        
        await Driver.findByIdAndUpdate(driverId, { 
          socketId: socket.id,
          isAvailable: true,
          isOnline: true,
          lastOnlineAt: new Date()
        });
        
        const driver = await Driver.findById(driverId).select('name phone vehicleType vehicleNumber currentLocation isAvailable isOnline');
        
        console.log(`Driver ${driverId} joined namespace with socket ${socket.id}`);
        
        // Emit driver online event
        driversNsp.emit('driver:online', {
          driverId,
          timestamp: new Date()
        });
        
        adminNsp.to('admin-room').emit('driver:online', {
          driverId,
          timestamp: new Date()
        });
        
        // Emit to driver search subscribers
        io.emit('drivers:update', {
          type: 'driver_online',
          driver,
          timestamp: new Date()
        });
        
        // Emit availability update
        emitAvailabilityUpdate(io, driverId, true);
      }
    });
    
    // Driver heartbeat to detect disconnection
    socket.on('driver:heartbeat', async (data) => {
      try {
        const { driverId } = data;
        if (driverId && socket.driverId === driverId) {
          socket.lastHeartbeat = Date.now();
        }
      } catch (error) {
        console.error('Error in heartbeat:', error);
      }
    });
    
    // Manual driver offline (when driver goes offline intentionally)
    socket.on('driver:offline', async (data) => {
      try {
        const { driverId } = data;
        
        const driver = await Driver.findByIdAndUpdate(driverId, {
          socketId: null,
          isAvailable: false,
          isOnline: false,
          lastOnlineAt: new Date()
        }, { new: true });
        
        if (driver) {
          driversNsp.emit('driver:offline', {
            driverId: driver._id,
            timestamp: new Date()
          });
          
          adminNsp.to('admin-room').emit('driver:offline', {
            driverId: driver._id,
            timestamp: new Date()
          });
          
          io.emit('drivers:update', {
            type: 'driver_offline',
            driverId: driver._id,
            timestamp: new Date()
          });
          
          emitAvailabilityUpdate(io, driver._id, false);
        }
      } catch (error) {
        console.error('Error handling driver offline:', error);
      }
    });
    
    socket.on('driver:location-update', async (data) => {
      try {
        const { driverId, latitude, longitude } = data;
        
        const driver = await Driver.findByIdAndUpdate(
          driverId,
          {
            currentLocation: {
              type: 'Point',
              coordinates: [longitude, latitude]
            }
          },
          { new: true }
        );
        
        if (driver) {
          const locationData = {
            driverId: driver._id,
            location: driver.currentLocation,
            timestamp: new Date()
          };
          
          // Emit to drivers namespace
          driversNsp.emit('driver:location-update', locationData);
          
          // Emit to admin namespace
          adminNsp.to('admin-room').emit('driver:location-update', locationData);
          
          // Emit to specific driver's room
          driversNsp.to(`driver:${driverId}`).emit('driver:location-update', locationData);
          
          // Emit to driver search subscribers
          io.emit('drivers:update', {
            type: 'driver_location',
            driverId: driver._id,
            location: driver.currentLocation,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error updating driver location:', error);
      }
    });
    
    socket.on('driver:availability-update', async (data) => {
      try {
        const { driverId, isAvailable } = data;
        
        const driver = await Driver.findByIdAndUpdate(driverId, { isAvailable }, { new: true });
        
        if (driver) {
          io.emit('drivers:update', {
            type: 'driver_availability',
            driverId: driver._id,
            isAvailable: driver.isAvailable,
            timestamp: new Date()
          });
        }
        
        emitAvailabilityUpdate(io, driverId, isAvailable);
      } catch (error) {
        console.error('Error updating driver availability:', error);
      }
    });
    
    socket.on('driver:accept-booking', async (data) => {
      try {
        const { orderId, driverId } = data;
        
        // Update order status
        await Order.findByIdAndUpdate(orderId, { status: 'accepted' });
        
        const eventData = {
          orderId,
          driverId,
          status: 'accepted',
          timestamp: new Date()
        };
        
        // Emit to bookings namespace
        bookingsNsp.emit('booking:assigned', eventData);
        
        // Emit to admin
        adminNsp.to('admin-room').emit('booking:assigned', eventData);
        
        // Emit to specific driver
        driversNsp.to(`driver:${driverId}`).emit('booking:assigned-to-me', eventData);
        
        // Emit dashboard stats update
        emitDashboardStats(adminNsp);
        
      } catch (error) {
        console.error('Error accepting booking:', error);
      }
    });
    
    socket.on('driver:reject-booking', async (data) => {
      try {
        const { orderId, driverId, reason } = data;
        
        await Driver.findByIdAndUpdate(driverId, { isAvailable: true });
        
        const eventData = {
          orderId,
          driverId,
          reason,
          timestamp: new Date()
        };
        
        bookingsNsp.emit('booking:cancelled', eventData);
        adminNsp.to('admin-room').emit('booking:cancelled', eventData);
        
      } catch (error) {
        console.error('Error rejecting booking:', error);
      }
    });
    
    socket.on('disconnect', async () => {
      console.log(`Driver client disconnected: ${socket.id}`);
      
      try {
        const driver = await Driver.findOneAndUpdate(
          { socketId: socket.id },
          { socketId: null, isAvailable: false, isOnline: false },
          { new: true }
        );
        
        if (driver) {
          // Emit driver offline event
          driversNsp.emit('driver:offline', {
            driverId: driver._id,
            timestamp: new Date()
          });
          
          adminNsp.to('admin-room').emit('driver:offline', {
            driverId: driver._id,
            timestamp: new Date()
          });
          
          // Emit to driver search subscribers
          io.emit('drivers:update', {
            type: 'driver_offline',
            driverId: driver._id,
            timestamp: new Date()
          });
          
          emitAvailabilityUpdate(io, driver._id, false);
        }
      } catch (error) {
        console.error('Error handling driver disconnect:', error);
      }
    });
  });

  // ============== BOOKINGS NAMESPACE ==============
  bookingsNsp.on('connection', (socket) => {
    console.log(`Booking client connected: ${socket.id}`);
    
    socket.on('booking:join', (bookingId) => {
      socket.join(`booking:${bookingId}`);
      console.log(`Client joined booking room: ${bookingId}`);
    });
    
    socket.on('booking:status-update', async (data) => {
      try {
        const { orderId, status, previousStatus } = data;
        
        // Update order in database
        const updateData = { status };
        if (status === 'completed') updateData.completedAt = new Date();
        if (status === 'picked_up') updateData.startedAt = new Date();
        
        await Order.findByIdAndUpdate(orderId, updateData);
        
        const eventData = {
          orderId,
          status,
          previousStatus,
          timestamp: new Date()
        };
        
        // Emit to bookings namespace
        bookingsNsp.emit('booking:status-updated', eventData);
        bookingsNsp.to(`booking:${orderId}`).emit('booking:status-updated', eventData);
        
        // Emit to admin
        adminNsp.to('admin-room').emit('booking:status-updated', eventData);
        
        // Emit dashboard stats update
        emitDashboardStats(adminNsp);
        
        // If completed, emit completed event
        if (status === 'completed') {
          const completedData = {
            orderId,
            timestamp: new Date()
          };
          
          bookingsNsp.emit('booking:completed', completedData);
          adminNsp.to('admin-room').emit('booking:completed', completedData);
        }
        
      } catch (error) {
        console.error('Error updating booking status:', error);
      }
    });
    
    socket.on('disconnect', () => {
      console.log(`Booking client disconnected: ${socket.id}`);
    });
  });

  // ============== MAIN NAMESPACE (for backward compatibility) ==============
  io.on('connection', (socket) => {
    console.log(`Client connected to main namespace: ${socket.id}`);
    
    // Admin joins admin room
    socket.on('join:admin', () => {
      socket.join('admin');
      console.log(`Admin joined main namespace: ${socket.id}`);
      emitDashboardStats(socket);
    });
    
    // Driver joins their room
    socket.on('join:driver', async (driverId) => {
      if (driverId) {
        socket.join(`driver:${driverId}`);
        await Driver.findByIdAndUpdate(driverId, { socketId: socket.id });
        console.log(`Driver ${driverId} joined main namespace: ${socket.id}`);
      }
    });
    
    // Customer joins their room
    socket.on('join:customer', (customerId) => {
      if (customerId) {
        socket.join(`customer:${customerId}`);
        console.log(`Customer ${customerId} joined main namespace: ${socket.id}`);
      }
    });
    
    // Search for available drivers - real-time driver search
    socket.on('drivers:search', async (data) => {
      try {
        const { vehicleType, latitude, longitude, radius = 5000 } = data;
        
        const query = {
          isActive: true,
          isOnline: true,
          isAvailable: true,
          isVerified: true,
          verificationStatus: 'verified'
        };
        
        if (vehicleType) query.vehicleType = vehicleType;
        
        let drivers;
        
        if (latitude && longitude) {
          drivers = await Driver.find({
            ...query,
            currentLocation: {
              $near: {
                $geometry: {
                  type: 'Point',
                  coordinates: [parseFloat(longitude), parseFloat(latitude)]
                },
                $maxDistance: parseInt(radius)
              }
            }
          }).select('name phone vehicleType vehicleNumber currentLocation isAvailable');
        } else {
          drivers = await Driver.find(query).select('name phone vehicleType vehicleNumber currentLocation isAvailable');
        }
        
        socket.emit('drivers:search-results', {
          drivers,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Error searching drivers:', error);
        socket.emit('drivers:search-error', { message: error.message });
      }
    });
    
    // Subscribe to driver updates - real-time driver location/status changes
    socket.on('drivers:subscribe', (data) => {
      const { vehicleType } = data;
      socket.join('drivers-search');
      socket.vehicleTypeFilter = vehicleType;
      console.log(`Client subscribed to driver updates: ${socket.id}, vehicleType: ${vehicleType}`);
    });
    
    // Unsubscribe from driver updates
    socket.on('drivers:unsubscribe', () => {
      socket.leave('drivers-search');
      console.log(`Client unsubscribed from driver updates: ${socket.id}`);
    });
    
    socket.on('disconnect', async () => {
      console.log(`Client disconnected from main namespace: ${socket.id}`);
      
      try {
        await Driver.findOneAndUpdate(
          { socketId: socket.id },
          { socketId: null }
        );
      } catch (error) {
        console.error('Error clearing driver socket:', error);
      }
    });
  });
  
  // Emit real-time driver updates to all subscribed clients
  const emitDriverUpdate = (driverData) => {
    io.emit('drivers:update', driverData);
  };

  // ============== HELPER FUNCTIONS ==============
  
  async function emitDashboardStats(socketOrNsp) {
    try {
      const [
        totalOrders,
        pendingOrders,
        activeOrders,
        completedOrders,
        totalDrivers,
        onlineDrivers,
        totalCustomers,
        todayOrders
      ] = await Promise.all([
        Order.countDocuments(),
        Order.countDocuments({ status: 'pending' }),
        Order.countDocuments({ status: { $in: ['assigned', 'accepted', 'picked_up', 'in_progress'] } }),
        Order.countDocuments({ status: 'completed' }),
        Driver.countDocuments({ isActive: true }),
        Driver.countDocuments({ isActive: true, isAvailable: true }),
        Customer.countDocuments(),
        Order.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      ]);
      
      const stats = {
        totalOrders,
        pendingOrders,
        activeOrders,
        completedOrders,
        totalDrivers,
        onlineDrivers,
        totalCustomers,
        todayOrders,
        timestamp: new Date()
      };
      
      if (socketOrNsp.emit) {
        // It's a socket
        socketOrNsp.emit('dashboard:stats-update', stats);
      } else {
        // It's a namespace
        socketOrNsp.to('admin-room').emit('dashboard:stats-update', stats);
      }
    } catch (error) {
      console.error('Error emitting dashboard stats:', error);
    }
  }
  
  function emitAvailabilityUpdate(io, driverId, isAvailable) {
    const eventData = {
      driverId,
      isAvailable,
      timestamp: new Date()
    };
    
    io.emit('driver:availability-update', eventData);
    
    if (adminNsp) {
      adminNsp.to('admin-room').emit('driver:availability-update', eventData);
    }
    
    if (driversNsp) {
      driversNsp.emit('driver:availability-update', eventData);
    }
  }
  
  // Expose emitDashboardStats for use in controllers
  io.emitDashboardStats = emitDashboardStats;
  
  return io;
};

export default initializeSockets;
