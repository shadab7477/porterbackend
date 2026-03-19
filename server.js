import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import connectDB from './config/database.js';
import initializeSockets from './sockets/socketHandler.js';
import { initializeSupportSockets } from './sockets/supportSocketHandler.js';

// Routes
import driverRoutes from './routes/driverRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import authRoutes from './routes/authRoutes.js';
import driverAuthRoutes from './routes/driverAuthRoutes.js';
import rideRoutes from './routes/rideRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import verificationRoutes from './routes/verificationRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import walletRoutes from './routes/walletRoutes.js';

dotenv.config();

// ES module fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// ✅ Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "https://godelivo.com",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  }
});

// DB connect
connectDB();

// Custom socket handlers
initializeSockets(io);
initializeSupportSockets(io);

app.set('io', io);

// ✅ Middlewares
app.use(cors({
  origin: process.env.CLIENT_URL || "https://godelivo.com",
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== ✅ API ROUTES FIRST ==================

app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/driver', driverAuthRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ================== ✅ REACT BUILD SERVE ==================

app.use(express.static(path.join(__dirname, 'build')));

// ⚡ IMPORTANT: React routing fix
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ================== ✅ SOCKET.IO ==================

io.on('connection', (socket) => {
  console.log('🟢 Client connected:', socket.id);

  // User location update
  socket.on('user:location_update', (data) => {
    const { latitude, longitude } = data;

    socket.broadcast.emit('user:nearby', {
      userId: socket.id,
      latitude,
      longitude
    });
  });

  // Driver location update
  socket.on('driver:location_update', (data) => {
    const { driverId, latitude, longitude, vehicleType } = data;

    socket.broadcast.emit('driver:location_updated', {
      driverId,
      lat: latitude,
      lng: longitude,
      vehicleType,
      timestamp: new Date().toISOString()
    });

    socket.to(`area-${Math.floor(latitude)}-${Math.floor(longitude)}`)
      .emit('driver:moved', data);
  });

  // Join room
  socket.on('join', (room) => {
    socket.join(room);
    console.log(`📡 ${socket.id} joined ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('🔴 Client disconnected:', socket.id);

    socket.broadcast.emit('driver:left_area', {
      driverId: socket.driverId
    });
  });
});

// ================== ✅ ERROR HANDLER ==================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ================== ✅ SERVER START ==================

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⚡ Socket.IO ready`);
});

export { app, server, io };