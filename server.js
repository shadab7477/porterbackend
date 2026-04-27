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
import { initializePackerSockets } from './sockets/packerSocketHandler.js';

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
import faqRoutes from './routes/faqRoutes.js';
import adminNotificationRoutes from './routes/adminNotificationRoutes.js';
import adminRestrictedItemsRoutes from './routes/adminRestrictedItemsRoutes.js';
import adminGoodsItemsRoutes from './routes/adminGoodsItemsRoutes.js';
import adminPricingRoutes from './routes/adminPricingRoutes.js';
import packerBookingRoutes from './routes/packerBookingRoutes.js';

dotenv.config();

// ES module fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);


// ================== ✅ CORS CONFIG ==================

const allowedOrigins = [
  "https://godelivo.com",
  "https://www.godelivo.com",
  "http://godelivo.com",
  "http://localhost:3000"
];

// Dynamic CORS function
const corsOptions = {
  origin: function (origin, callback) {
    // allow no origin (Postman, mobile apps)
    if (!origin) return callback(null, true);

    // allow localhost any port
    if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
      return callback(null, true);
    }

    // allow listed domains
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS not allowed: " + origin), false);
  },
  credentials: true
};

app.use(cors(corsOptions));


// ================== 🔥 SOCKET.IO ==================

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1") ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback("Socket CORS not allowed: " + origin);
      }
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});


// ================== 🌍 GLOBAL MAPS ==================

global.activeDrivers = new Map();
global.activeCustomers = new Map();
global.activeRides = new Map();


// ================== 🗄️ DATABASE ==================

connectDB();


// ================== ⚡ SOCKET HANDLERS ==================

initializeRideTrackingSockets(io);
initializeSockets(io);
initializeSupportSockets(io);
initializePackerSockets(io);

app.set('io', io);


// ================== 🧱 MIDDLEWARE ==================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (NGINX)
app.set('trust proxy', 1);


// ================== 📡 ROUTES ==================

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
app.use('/api/faq', faqRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/restricted-items', adminRestrictedItemsRoutes);
app.use('/api/admin/goods-items', adminGoodsItemsRoutes);
app.use('/api/admin/pricing', adminPricingRoutes);
app.use('/api/packer-bookings', packerBookingRoutes);


// ================== ❤️ HEALTH CHECK ==================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    time: new Date().toISOString(),
    connections: io.engine?.clientsCount || 0,
    drivers: global.activeDrivers.size,
    customers: global.activeCustomers.size,
    rides: global.activeRides.size
  });
});


// ================== 🔌 SOCKET TEST ==================

app.get('/socket-test', (req, res) => {
  res.json({ 
    status: 'Socket.IO ready',
    connections: io.engine?.clientsCount || 0
  });
});


// ================== 📦 REACT BUILD ==================

app.use(express.static(path.join(__dirname, 'build')));

app.get(/^\/(?!api|health|socket-test).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});


// ================== ❌ ERROR HANDLER ==================

app.use((err, req, res, next) => {
  console.error("ERROR:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});


// ================== 🚀 SERVER START ==================

const PORT = process.env.PORT || 5001;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${PORT}`);
});