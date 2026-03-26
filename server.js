import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import connectDB from './config/database.js';
import pusherService from './services/pusherService.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Store active connections globally
global.activeDrivers = new Map();
global.activeCustomers = new Map();
global.activeRides = new Map();

// DB connect
connectDB();

// Make pusher service available globally
app.set('pusherService', pusherService);

// Middlewares
app.use(cors({
  origin: process.env.CLIENT_URL || ["http://localhost:3000", "https://godelivo.com"],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pusher authentication endpoint
app.post('/pusher/auth', (req, res) => {
  const { socket_id, channel_name } = req.body;
  const auth = pusherService.authenticate(socket_id, channel_name);
  res.send(auth);
});

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ================== REACT BUILD SERVE ==================
app.use(express.static(path.join(__dirname, 'build')));

app.get(/^\/(?!api).*/, (req, res) => {
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
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⚡ Pusher ready`);
});

export { app, server };