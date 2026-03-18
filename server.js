import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/database.js';
import initializeSockets from './sockets/socketHandler.js';
import driverRoutes from './routes/driverRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import authRoutes from './routes/authRoutes.js';
import driverAuthRoutes from './routes/driverAuthRoutes.js';
import rideRoutes from './routes/rideRoutes.js';

import supportRoutes from './routes/supportRoutes.js';
import { initializeSupportSockets } from './sockets/supportSocketHandler.js';
import verificationRoutes from './routes/verificationRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  }
});

connectDB();

initializeSockets(io);

app.set('io', io);

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/driver', driverAuthRoutes);
app.use('/api/rides', rideRoutes);

const supportNamespace = initializeSupportSockets(io);

// Add support routes
app.use('/api/support', supportRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});


// Add this to your server.js for driver location updates

io.on('connection', (socket) => {
  console.log('🟢 Client connected:', socket.id);

  // Handle user location updates
  socket.on('user:location_update', (data) => {
    const { latitude, longitude, radius } = data;

    // Broadcast to all drivers in area (you can implement room logic)
    socket.broadcast.emit('user:nearby', {
      userId: socket.id,
      latitude,
      longitude
    });
  });

  // Handle driver location updates (from driver app)
  socket.on('driver:location_update', (data) => {
    const { driverId, latitude, longitude, vehicleType } = data;

    // Broadcast to all users in area
    socket.broadcast.emit('driver:location_updated', {
      driverId,
      lat: latitude,
      lng: longitude,
      vehicleType,
      timestamp: new Date().toISOString()
    });

    // Also emit to specific rooms if needed
    socket.to(`area-${Math.floor(latitude)}-${Math.floor(longitude)}`).emit('driver:moved', data);
  });

  socket.on('join', (room) => {
    socket.join(room);
    console.log(`📡 Socket ${socket.id} joined room: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('🔴 Client disconnected:', socket.id);

    // Notify others that driver left
    socket.broadcast.emit('driver:left_area', {
      driverId: socket.driverId // You'd need to store this on connection
    });
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO server ready for connections`);
});

export { app, server, io };