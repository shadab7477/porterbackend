// server.js
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
import { initializeRideTrackingSockets } from './sockets/rideTrackingSocket.js';

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

import chatRoutes from './routes/chatRoutes.js';
import shiftingRoutes from './routes/shiftingRoutes.js';
dotenv.config();

// ES module fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: [
      "https://godelivo.com",
      "https://www.godelivo.com",
      "http://godelivo.com",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Initialize global maps
global.activeDrivers = new Map();
global.activeCustomers = new Map();
global.activeRides = new Map();

// Connect to database
connectDB();

// Initialize socket handlers\
initializeRideTrackingSockets(io);

initializeSockets(io);
initializeSupportSockets(io);

app.set('io', io);

// Middleware
app.use(cors({
  origin: [
    "https://godelivo.com",
    "https://www.godelivo.com",
    "http://godelivo.com",
    "http://localhost:3000"
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (important for Nginx)
app.set('trust proxy', 1);

// ================== API ROUTES ==================
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

app.use('/api/chat', chatRoutes);
app.use('/api/shifting', shiftingRoutes);
// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    socketConnections: io.engine?.clientsCount || 0,
    activeDrivers: global.activeDrivers.size,
    activeCustomers: global.activeCustomers.size,
    activeRides: global.activeRides.size
  });
});

// Socket.IO test endpoint
app.get('/socket-test', (req, res) => {
  res.json({ 
    status: 'Socket.IO ready', 
    path: io.path(),
    transports: ['websocket', 'polling'],
    activeConnections: io.engine?.clientsCount || 0
  });
});

// ================== SERVE REACT BUILD ==================
// Serve static files from the React build folder
app.use(express.static(path.join(__dirname, 'build')));

// Handle React routing - serve index.html for any non-API route
app.get(/^\/(?!api|health|socket-test).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ================== ERROR HANDLER ==================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ================== SERVER START ==================
const PORT = process.env.PORT || 5001;

// Listen on localhost only (Nginx will proxy)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Listening on: http://127.0.0.1:${PORT}`);
  console.log(`⚡ Socket.IO ready`);
  console.log(`📦 Serving React build from: ${path.join(__dirname, 'build')}`);
});

export { app, server, io };