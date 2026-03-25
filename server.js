// server.js or index.js - Update your existing file
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
import { initializeRideTrackingSockets } from './sockets/rideTrackingSocket.js'; // New file we'll create

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

// ✅ Socket.IO setup with enhanced configuration
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || ["http://localhost:3000", "https://godelivo.com"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Store active connections globally
global.activeDrivers = new Map(); // driverId -> socketId
global.activeCustomers = new Map(); // customerId -> socketId
global.activeRides = new Map(); // rideId -> { driverId, customerId, driverSocket, customerSocket }

// DB connect
connectDB();

// Initialize all socket handlers
initializeSockets(io);
initializeSupportSockets(io);
initializeRideTrackingSockets(io); // New ride tracking socket handler

app.set('io', io);

// ✅ Middlewares
app.use(cors({
  origin: process.env.CLIENT_URL || ["http://localhost:3000", "https://godelivo.com"],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== ✅ API ROUTES ==================
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

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
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