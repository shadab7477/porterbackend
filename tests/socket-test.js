#!/usr/bin/env node

/**
 * Socket.IO Test Script for Logistics Dashboard
 * 
 * This script tests all Socket.IO namespaces and events:
 * - /admin namespace (dashboard stats, live updates)
 * - /drivers namespace (driver online/offline, location, availability)
 * - /bookings namespace (booking lifecycle events)
 * 
 * Usage: node socket-test.js
 */

const { io } = require('socket.io-client');

const API_URL = process.env.API_URL || 'http://localhost:5000';
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logEvent(namespace, event, data) {
  console.log(`\n${colors.cyan}[${namespace}] ${colors.yellow}${event}:${colors.reset}`);
  console.log(JSON.stringify(data, null, 2));
}

class SocketTester {
  constructor() {
    this.sockets = {};
    this.testResults = [];
  }

  async connectAdmin() {
    log('\n📊 Connecting to /admin namespace...', 'magenta');
    
    return new Promise((resolve) => {
      const socket = io(`${API_URL}/admin`);
      this.sockets.admin = socket;

      socket.on('connect', () => {
        log('✅ Admin connected', 'green');
        resolve();
      });

      socket.on('dashboard:stats-update', (data) => {
        logEvent('admin', 'dashboard:stats-update', data);
      });

      socket.on('booking:new', (data) => {
        logEvent('admin', 'booking:new', data);
      });

      socket.on('booking:assigned', (data) => {
        logEvent('admin', 'booking:assigned', data);
      });

      socket.on('booking:status-updated', (data) => {
        logEvent('admin', 'booking:status-updated', data);
      });

      socket.on('booking:completed', (data) => {
        logEvent('admin', 'booking:completed', data);
      });

      socket.on('booking:cancelled', (data) => {
        logEvent('admin', 'booking:cancelled', data);
      });

      socket.on('driver:online', (data) => {
        logEvent('admin', 'driver:online', data);
      });

      socket.on('driver:offline', (data) => {
        logEvent('admin', 'driver:offline', data);
      });

      socket.on('driver:location-update', (data) => {
        logEvent('admin', 'driver:location-update', data);
      });

      socket.on('driver:availability-update', (data) => {
        logEvent('admin', 'driver:availability-update', data);
      });

      socket.on('disconnect', () => {
        log('❌ Admin disconnected', 'red');
      });
    });
  }

  async connectDriver(driverId = 'test-driver-001') {
    log(`\n🚗 Connecting to /drivers namespace (Driver: ${driverId})...`, 'magenta');
    
    return new Promise((resolve) => {
      const socket = io(`${API_URL}/drivers`);
      this.sockets.driver = socket;

      socket.on('connect', () => {
        log('✅ Driver client connected', 'green');
        
        // Join driver room
        socket.emit('driver:join', driverId);
        resolve();
      });

      socket.on('driver:online', (data) => {
        logEvent('drivers', 'driver:online', data);
      });

      socket.on('driver:offline', (data) => {
        logEvent('drivers', 'driver:offline', data);
      });

      socket.on('driver:location-update', (data) => {
        logEvent('drivers', 'driver:location-update', data);
      });

      socket.on('driver:availability-update', (data) => {
        logEvent('drivers', 'driver:availability-update', data);
      });

      socket.on('booking:assigned-to-me', (data) => {
        logEvent('drivers', 'booking:assigned-to-me', data);
      });

      socket.on('disconnect', () => {
        log('❌ Driver disconnected', 'red');
      });
    });
  }

  async connectBooking(bookingId = 'test-booking-001') {
    log(`\n📦 Connecting to /bookings namespace (Booking: ${bookingId})...`, 'magenta');
    
    return new Promise((resolve) => {
      const socket = io(`${API_URL}/bookings`);
      this.sockets.booking = socket;

      socket.on('connect', () => {
        log('✅ Booking client connected', 'green');
        
        // Join booking room
        socket.emit('booking:join', bookingId);
        resolve();
      });

      socket.on('booking:assigned', (data) => {
        logEvent('bookings', 'booking:assigned', data);
      });

      socket.on('booking:status-updated', (data) => {
        logEvent('bookings', 'booking:status-updated', data);
      });

      socket.on('booking:completed', (data) => {
        logEvent('bookings', 'booking:completed', data);
      });

      socket.on('booking:cancelled', (data) => {
        logEvent('bookings', 'booking:cancelled', data);
      });

      socket.on('disconnect', () => {
        log('❌ Booking client disconnected', 'red');
      });
    });
  }

  // Simulate driver actions
  async simulateDriverLocationUpdate(driverId = 'test-driver-001') {
    log('\n📍 Simulating driver location update...', 'blue');
    
    if (this.sockets.driver) {
      this.sockets.driver.emit('driver:location-update', {
        driverId,
        latitude: 28.6139 + (Math.random() - 0.5) * 0.1,
        longitude: 77.2090 + (Math.random() - 0.5) * 0.1
      });
    }
  }

  async simulateDriverAvailability(driverId = 'test-driver-001', isAvailable = true) {
    log(`\n🔄 Simulating driver availability update (isAvailable: ${isAvailable})...`, 'blue');
    
    if (this.sockets.driver) {
      this.sockets.driver.emit('driver:availability-update', {
        driverId,
        isAvailable
      });
    }
  }

  async simulateAcceptBooking(driverId = 'test-driver-001', orderId = 'test-order-001') {
    log('\n✅ Simulating driver accepting booking...', 'blue');
    
    if (this.sockets.driver) {
      this.sockets.driver.emit('driver:accept-booking', {
        driverId,
        orderId
      });
    }
  }

  async simulateBookingStatusUpdate(orderId = 'test-order-001', status = 'completed') {
    log(`\n📝 Simulating booking status update (status: ${status})...`, 'blue');
    
    if (this.sockets.booking) {
      this.sockets.booking.emit('booking:status-update', {
        orderId,
        status,
        previousStatus: 'assigned'
      });
    }
  }

  async runTests() {
    log('\n' + '='.repeat(60), 'bright');
    log('🚀 Socket.IO Test Suite Started', 'bright');
    log('='.repeat(60), 'bright');

    try {
      // Connect all namespaces
      await this.connectAdmin();
      await this.connectDriver();
      await this.connectBooking();

      // Wait a bit for connections to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Run simulations
      log('\n' + '-'.repeat(60), 'yellow');
      log('🎮 Running Event Simulations', 'yellow');
      log('-'.repeat(60), 'yellow');

      await this.simulateDriverLocationUpdate();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.simulateDriverAvailability('test-driver-001', false);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.simulateAcceptBooking();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.simulateBookingStatusUpdate('test-order-001', 'picked_up');
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.simulateBookingStatusUpdate('test-order-001', 'completed');
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.simulateDriverAvailability('test-driver-001', true);

      // Keep connections alive for a while
      log('\n⏳ Keeping connections alive for 5 seconds...', 'cyan');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Disconnect all
      log('\n🔌 Disconnecting all clients...', 'red');
      this.disconnectAll();

      log('\n' + '='.repeat(60), 'bright');
      log('✨ Socket.IO Test Suite Completed', 'green');
      log('='.repeat(60), 'bright');

    } catch (error) {
      log(`\n❌ Test Error: ${error.message}`, 'red');
      console.error(error);
    }
  }

  disconnectAll() {
    Object.values(this.sockets).forEach(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
  }
}

// Run tests if executed directly
if (require.main === module) {
  const tester = new SocketTester();
  tester.runTests();
}

module.exports = SocketTester;
