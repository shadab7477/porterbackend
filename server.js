// server.js or index.js - Updated with production-ready configuration
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

dotenv.config();

// ES module fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// ✅ Enhanced Socket.IO configuration for production
const io = new Server(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "https://godelivo.com",
      "http://godelivo.com",
      "https://www.godelivo.com",
      "http://www.godelivo.com"
    ],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  // Critical settings for VPS
  path: '/socket.io/',  // Default path, ensure this matches client
  transports: ['websocket', 'polling'],  // Allow both, websocket preferred
  allowEIO3: true,  // Allow Engine.IO v3 clients
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6,  // 1 MB
  // For production behind proxy (nginx)
  serveClient: false,  // Don't serve client file
  // Connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,  // 2 minutes
    skipMiddlewares: true,
  }
});

// Initialize global maps
global.activeDrivers = new Map();
global.activeCustomers = new Map();
global.activeRides = new Map();

// DB connect
connectDB();

// Initialize all socket handlers
initializeSockets(io);
initializeSupportSockets(io);
initializeRideTrackingSockets(io);

app.set('io', io);

// ✅ Enhanced CORS for production
app.use(cors({
  origin: [
    process.env.CLIENT_URL || "http://localhost:3000",
    "https://godelivo.com",
    "http://godelivo.com",
    "https://www.godelivo.com",
    "http://www.godelivo.com"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ✅ Body parsing with increased limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Trust proxy - IMPORTANT for VPS behind reverse proxy
app.set('trust proxy', 1);  // Trust first proxy (like nginx)

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

// ✅ Socket.IO connection test endpoint
app.get('/socket-test', (req, res) => {
  res.json({ 
    status: 'Socket.IO ready', 
    path: io.path(),
    transports: io.engine?.transports || ['websocket', 'polling'],
    activeConnections: io.engine?.clientsCount || 0
  });
});

// Health check with detailed info
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

// ================== ✅ REACT BUILD SERVE ==================
app.use(express.static(path.join(__dirname, 'build')));

app.get(/^\/(?!api|socket-test|health).*/, (req, res) => {
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

server.listen(PORT, '0.0.0.0', () => {  // Listen on all interfaces
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Server address: ${process.env.SERVER_URL || `http://localhost:${PORT}`}`);
  console.log(`⚡ Socket.IO path: ${io.path()}`);
  console.log(`🔌 Socket.IO transports: ${io.engine?.transports?.join(', ') || 'websocket, polling'}`);
  console.log(`🌐 CORS enabled for: ${process.env.CLIENT_URL || 'http://localhost:3000, https://godelivo.com'}`);
});

export { app, server, io };