#!/usr/bin/env node

/**
 * Comprehensive Ride Socket.IO Test Script
 *
 * This script tests all ride-related Socket.IO events from rideTrackingSocket.js:
 * - Driver tracking events (join, location updates, status changes)
 * - Customer tracking events (join, location requests)
 * - Ride lifecycle events (start, complete, cancel, arrived)
 * - Chat events
 * - Admin monitoring events
 *
 * Usage: node ride-socket-test.js
 */

import { io } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://127.0.0.1:5001';
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logEvent(namespace, event, data, direction = 'received') {
  const arrow = direction === 'sent' ? '📤' : '📥';
  console.log(`\n${colors.cyan}[${namespace}] ${arrow} ${colors.yellow}${event}:${colors.reset}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

class RideSocketTester {
  constructor() {
    this.sockets = {};
    this.testResults = [];
    this.testRideId = 'RID' + Date.now();
    this.testDriverId = '507f1f77bcf86cd799439011'; // Example MongoDB ObjectId
    this.testCustomerId = '507f1f77bcf86cd799439012'; // Example MongoDB ObjectId
  }

  async connectMainNamespace() {
    log('\n🔌 Connecting to main namespace...', 'magenta');

    return new Promise((resolve) => {
      const socket = io(API_URL);
      this.sockets.main = socket;

      socket.on('connect', () => {
        log('✅ Main namespace connected', 'green');
        resolve();
      });

      // Driver events
      socket.on('driver:location-updated', (data) => {
        logEvent('main', 'driver:location-updated', data);
      });

      socket.on('driver:arrived', (data) => {
        logEvent('main', 'driver:arrived', data);
      });

      socket.on('driver:status-change', (data) => {
        logEvent('main', 'driver:status-change', data);
      });

      // Ride events
      socket.on('ride:started', (data) => {
        logEvent('main', 'ride:started', data);
      });

      socket.on('ride:completed', (data) => {
        logEvent('main', 'ride:completed', data);
      });

      socket.on('ride:cancelled', (data) => {
        logEvent('main', 'ride:cancelled', data);
      });

      // Chat events
      socket.on('chat:message', (data) => {
        logEvent('main', 'chat:message', data);
      });

      socket.on('chat:typing', (data) => {
        logEvent('main', 'chat:typing', data);
      });

      socket.on('error', (data) => {
        logEvent('main', 'error', data);
      });

      socket.on('disconnect', () => {
        log('❌ Main namespace disconnected', 'red');
      });
    });
  }

  async connectAdminNamespace() {
    log('\n📊 Connecting to /admin namespace...', 'magenta');

    return new Promise((resolve) => {
      const socket = io(`${API_URL}/admin`);
      this.sockets.admin = socket;

      socket.on('connect', () => {
        log('✅ Admin namespace connected', 'green');
        resolve();
      });

      socket.on('driver:live-location', (data) => {
        logEvent('admin', 'driver:live-location', data);
      });

      socket.on('disconnect', () => {
        log('❌ Admin namespace disconnected', 'red');
      });
    });
  }

  // ==================== DRIVER TRACKING TESTS ====================

  async testDriverJoinTracking() {
    log('\n🚗 Testing driver:join-tracking...', 'blue');

    const data = {
      driverId: this.testDriverId,
      rideId: this.testRideId
    };

    logEvent('main', 'driver:join-tracking', data, 'sent');
    this.sockets.main.emit('driver:join-tracking', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testDriverLocationUpdate() {
    log('\n📍 Testing driver:location-update...', 'blue');

    const data = {
      driverId: this.testDriverId,
      rideId: this.testRideId,
      latitude: 28.6139, // Delhi coordinates
      longitude: 77.2090,
      bearing: 45,
      speed: 30,
      accuracy: 10
    };

    logEvent('main', 'driver:location-update', data, 'sent');
    this.sockets.main.emit('driver:location-update', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testDriverStatusChange() {
    log('\n🔄 Testing driver:status-change...', 'blue');

    const data = {
      driverId: this.testDriverId,
      status: 'online',
      isAvailable: true,
      vehicleType: 'bike'
    };

    logEvent('main', 'driver:status-change', data, 'sent');
    this.sockets.main.emit('driver:status-change', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testDriverSendLocationResponse() {
    log('\n📤 Testing driver:send-location-response...', 'blue');

    const data = {
      driverId: this.testDriverId,
      rideId: this.testRideId,
      latitude: 28.6139,
      longitude: 77.2090,
      customerId: this.testCustomerId
    };

    logEvent('main', 'driver:send-location-response', data, 'sent');
    this.sockets.main.emit('driver:send-location-response', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ==================== CUSTOMER TRACKING TESTS ====================

  async testCustomerJoinTracking() {
    log('\n👤 Testing customer:join-tracking...', 'blue');

    const data = {
      customerId: this.testCustomerId,
      rideId: this.testRideId
    };

    logEvent('main', 'customer:join-tracking', data, 'sent');
    this.sockets.main.emit('customer:join-tracking', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testCustomerRequestLocation() {
    log('\n📍 Testing customer:request-location...', 'blue');

    const data = {
      customerId: this.testCustomerId,
      rideId: this.testRideId,
      driverId: this.testDriverId
    };

    logEvent('main', 'customer:request-location', data, 'sent');
    this.sockets.main.emit('customer:request-location', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ==================== RIDE LIFECYCLE TESTS ====================

  async testDriverArrived() {
    log('\n🏁 Testing driver:arrived...', 'blue');

    const data = {
      rideId: this.testRideId,
      driverId: this.testDriverId,
      location: {
        latitude: 28.6139,
        longitude: 77.2090
      }
    };

    logEvent('main', 'driver:arrived', data, 'sent');
    this.sockets.main.emit('driver:arrived', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testRideStarted() {
    log('\n🚀 Testing ride:started...', 'blue');

    const data = {
      rideId: this.testRideId,
      driverId: this.testDriverId,
      startLocation: {
        latitude: 28.6139,
        longitude: 77.2090
      }
    };

    logEvent('main', 'ride:started', data, 'sent');
    this.sockets.main.emit('ride:started', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testRideCompleted() {
    log('\n✅ Testing ride:completed...', 'blue');

    const data = {
      rideId: this.testRideId,
      driverId: this.testDriverId,
      fare: 150,
      paymentMethod: 'cash',
      tip: 10,
      endLocation: {
        latitude: 28.7041,
        longitude: 77.1025
      }
    };

    logEvent('main', 'ride:completed', data, 'sent');
    this.sockets.main.emit('ride:completed', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testRideCancelled() {
    log('\n❌ Testing ride:cancelled...', 'blue');

    const data = {
      rideId: this.testRideId,
      cancelledBy: 'customer',
      reason: 'Changed plans',
      cancelledById: this.testCustomerId
    };

    logEvent('main', 'ride:cancelled', data, 'sent');
    this.sockets.main.emit('ride:cancelled', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testRideStatusUpdate() {
    log('\n📝 Testing ride:status-update...', 'blue');

    const data = {
      rideId: this.testRideId,
      status: 'in_progress',
      updatedBy: 'driver',
      updatedById: this.testDriverId,
      location: {
        latitude: 28.6139,
        longitude: 77.2090
      }
    };

    logEvent('main', 'ride:status-update', data, 'sent');
    this.sockets.main.emit('ride:status-update', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ==================== CHAT TESTS ====================

  async testChatJoin() {
    log('\n💬 Testing chat:join...', 'blue');

    const data = {
      rideId: this.testRideId,
      userId: this.testDriverId,
      userType: 'driver'
    };

    logEvent('main', 'chat:join', data, 'sent');
    this.sockets.main.emit('chat:join', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testChatMessage() {
    log('\n💬 Testing chat:message...', 'blue');

    const data = {
      rideId: this.testRideId,
      senderId: this.testDriverId,
      senderType: 'driver',
      message: 'Hello! I am on my way.',
      timestamp: new Date()
    };

    logEvent('main', 'chat:message', data, 'sent');
    this.sockets.main.emit('chat:message', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async testChatTyping() {
    log('\n⌨️ Testing chat:typing...', 'blue');

    const data = {
      rideId: this.testRideId,
      userId: this.testDriverId,
      userName: 'Test Driver'
    };

    logEvent('main', 'chat:typing', data, 'sent');
    this.sockets.main.emit('chat:typing', data);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Stop typing
    log('\n⏹️ Testing chat:stop-typing...', 'blue');
    this.sockets.main.emit('chat:stop-typing', {
      rideId: this.testRideId,
      userId: this.testDriverId
    });

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ==================== COMPREHENSIVE RIDE TEST ====================

  async runComprehensiveRideTest() {
    log('\n' + '='.repeat(80), 'bright');
    log('🚗 COMPREHENSIVE RIDE SOCKET TEST SUITE', 'bright');
    log('='.repeat(80), 'bright');

    try {
      // Connect to namespaces
      await this.connectMainNamespace();
      await this.connectAdminNamespace();

      // Wait for connections to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 1: INITIAL SETUP', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Driver joins tracking
      await this.testDriverJoinTracking();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Customer joins tracking
      await this.testCustomerJoinTracking();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Driver status change
      await this.testDriverStatusChange();
      await new Promise(resolve => setTimeout(resolve, 1000));

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 2: LOCATION TRACKING', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Multiple location updates
      for (let i = 0; i < 3; i++) {
        await this.testDriverLocationUpdate();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Customer requests location
      await this.testCustomerRequestLocation();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Driver responds to location request
      await this.testDriverSendLocationResponse();
      await new Promise(resolve => setTimeout(resolve, 1000));

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 3: RIDE LIFECYCLE', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Driver arrives
      await this.testDriverArrived();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Ride starts
      await this.testRideStarted();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Ride status updates during journey
      await this.testRideStatusUpdate();
      await new Promise(resolve => setTimeout(resolve, 2000));

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 4: COMMUNICATION', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Chat functionality
      await this.testChatJoin();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.testChatTyping();
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.testChatMessage();
      await new Promise(resolve => setTimeout(resolve, 1000));

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 5: COMPLETION', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Ride completion
      await this.testRideCompleted();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Alternative: Test cancellation instead
      // await this.testRideCancelled();

      log('\n' + '-'.repeat(80), 'yellow');
      log('🎬 PHASE 6: CLEANUP', 'yellow');
      log('-'.repeat(80), 'yellow');

      // Keep connections alive briefly to see final events
      log('\n⏳ Keeping connections alive for monitoring...', 'cyan');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Disconnect all
      log('\n🔌 Disconnecting all clients...', 'red');
      this.disconnectAll();

      log('\n' + '='.repeat(80), 'bright');
      log('✨ COMPREHENSIVE RIDE SOCKET TEST COMPLETED', 'green');
      log('='.repeat(80), 'bright');

      log('\n📊 Test Summary:', 'cyan');
      log(`   - Test Ride ID: ${this.testRideId}`, 'white');
      log(`   - Test Driver ID: ${this.testDriverId}`, 'white');
      log(`   - Test Customer ID: ${this.testCustomerId}`, 'white');
      log('   - All major ride socket events tested', 'white');

    } catch (error) {
      log(`\n❌ Test Error: ${error.message}`, 'red');
      console.error(error);
    }
  }

  // ==================== INDIVIDUAL EVENT TESTS ====================

  async runIndividualTests() {
    log('\n' + '='.repeat(60), 'bright');
    log('🧪 INDIVIDUAL RIDE SOCKET EVENT TESTS', 'bright');
    log('='.repeat(60), 'bright');

    try {
      await this.connectMainNamespace();
      await this.connectAdminNamespace();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test each event individually
      await this.testDriverJoinTracking();
      await this.testCustomerJoinTracking();
      await this.testDriverLocationUpdate();
      await this.testDriverStatusChange();
      await this.testCustomerRequestLocation();
      await this.testDriverSendLocationResponse();
      await this.testDriverArrived();
      await this.testRideStarted();
      await this.testRideStatusUpdate();
      await this.testChatJoin();
      await this.testChatTyping();
      await this.testChatMessage();
      await this.testRideCompleted();

      await new Promise(resolve => setTimeout(resolve, 2000));
      this.disconnectAll();

      log('\n' + '='.repeat(60), 'bright');
      log('✨ INDIVIDUAL TESTS COMPLETED', 'green');
      log('='.repeat(60), 'bright');

    } catch (error) {
      log(`\n❌ Test Error: ${error.message}`, 'red');
      console.error(error);
    }
  }

  disconnectAll() {
    Object.values(this.sockets).forEach(socket => {
      if (socket && socket.connected) {
        socket.disconnect();
      }
    });
  }

  // ==================== UTILITY METHODS ====================

  async runLoadTest(eventCount = 10) {
    log(`\n🔥 Running load test with ${eventCount} location updates...`, 'red');

    try {
      await this.connectMainNamespace();
      await this.connectAdminNamespace();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Join tracking first
      await this.testDriverJoinTracking();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Send multiple location updates rapidly
      for (let i = 0; i < eventCount; i++) {
        const data = {
          driverId: this.testDriverId,
          rideId: this.testRideId,
          latitude: 28.6139 + (Math.random() - 0.5) * 0.01, // Slight variation
          longitude: 77.2090 + (Math.random() - 0.5) * 0.01,
          bearing: Math.floor(Math.random() * 360),
          speed: Math.floor(Math.random() * 60) + 10,
          accuracy: Math.floor(Math.random() * 20) + 5
        };

        this.sockets.main.emit('driver:location-update', data);
        log(`📍 Sent location update ${i + 1}/${eventCount}`, 'cyan');

        // Small delay between updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      log('\n⏳ Waiting for all updates to process...', 'cyan');
      await new Promise(resolve => setTimeout(resolve, 3000));

      this.disconnectAll();
      log('\n✨ Load test completed', 'green');

    } catch (error) {
      log(`\n❌ Load test error: ${error.message}`, 'red');
      console.error(error);
    }
  }
}

// ==================== MAIN EXECUTION ====================

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new RideSocketTester();

  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.includes('--comprehensive') || args.includes('-c')) {
    tester.runComprehensiveRideTest();
  } else if (args.includes('--load-test') || args.includes('-l')) {
    const count = parseInt(args[args.indexOf('--load-test') + 1] || args[args.indexOf('-l') + 1]) || 10;
    tester.runLoadTest(count);
  } else if (args.includes('--individual') || args.includes('-i')) {
    tester.runIndividualTests();
  } else {
    // Default: comprehensive test
    log('\n🚀 Starting comprehensive ride socket test...', 'bright');
    log('Usage: node ride-socket-test.js [options]', 'yellow');
    log('Options:', 'yellow');
    log('  --comprehensive, -c    Run full ride lifecycle test (default)', 'white');
    log('  --individual, -i       Run individual event tests', 'white');
    log('  --load-test, -l [n]    Run load test with n location updates', 'white');
    log('', 'white');

    tester.runComprehensiveRideTest();
  }
}

export default RideSocketTester;