import Driver from '../models/Driver.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';

const initializeSockets = (io) => {
  // ============== NAMESPACES ==============
  const adminNsp = io.of('/admin');
  const driversNsp = io.of('/drivers');
  const bookingsNsp = io.of('/bookings');

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
          isAvailable: true 
        });
        
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
        
        // Emit availability update
        emitAvailabilityUpdate(io, driverId, true);
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
        }
      } catch (error) {
        console.error('Error updating driver location:', error);
      }
    });
    
    socket.on('driver:availability-update', async (data) => {
      try {
        const { driverId, isAvailable } = data;
        
        await Driver.findByIdAndUpdate(driverId, { isAvailable });
        
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
          { socketId: null, isAvailable: false },
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
