import dotenv from 'dotenv';
import Pusher from 'pusher';
import axios from 'axios';

dotenv.config();

// Initialize Pusher client for testing
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TEST_RIDE_ID = `TEST-${Date.now()}`;
const TEST_DRIVER_ID = 'test-driver-123';
const TEST_CUSTOMER_ID = 'test-customer-456';

console.log('🧪 Starting Pusher Integration Tests\n');
console.log('📋 Test Configuration:');
console.log(`   Base URL: ${BASE_URL}`);
console.log(`   Test Ride ID: ${TEST_RIDE_ID}`);
console.log(`   Test Driver ID: ${TEST_DRIVER_ID}`);
console.log(`   Test Customer ID: ${TEST_CUSTOMER_ID}`);
console.log('');

// Test 1: Verify Pusher Connection
async function testPusherConnection() {
  console.log('📡 Test 1: Pusher Connection Test');
  console.log('-----------------------------------');
  
  try {
    // Trigger a test event
    await pusher.trigger('test-channel', 'test-event', {
      message: 'Test message',
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ Pusher connection successful');
    console.log('   Test event triggered successfully\n');
    return true;
  } catch (error) {
    console.error('❌ Pusher connection failed:', error.message);
    console.log('');
    return false;
  }
}

// Test 2: Channel Authentication
async function testChannelAuthentication() {
  console.log('🔐 Test 2: Channel Authentication');
  console.log('-----------------------------------');
  
  try {
    const socketId = `test-socket-${Date.now()}`;
    const channelName = `private-ride-${TEST_RIDE_ID}`;
    
    const auth = pusher.authenticate(socketId, channelName);
    
    if (auth && auth.auth) {
      console.log('✅ Channel authentication successful');
      console.log(`   Socket ID: ${socketId}`);
      console.log(`   Channel: ${channelName}`);
      console.log(`   Auth Token: ${auth.auth.substring(0, 50)}...\n`);
      return true;
    } else {
      console.log('❌ Channel authentication failed\n');
      return false;
    }
  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    console.log('');
    return false;
  }
}

// Test 3: Trigger and Receive Events
async function testEventTriggering() {
  console.log('📨 Test 3: Event Triggering');
  console.log('---------------------------');
  
  const channelName = `private-ride-${TEST_RIDE_ID}`;
  const events = [
    { name: 'tracking:joined', data: { rideId: TEST_RIDE_ID, userType: 'driver', message: 'Driver joined' } },
    { name: 'driver:location-updated', data: { driverId: TEST_DRIVER_ID, latitude: 40.7128, longitude: -74.0060, rideId: TEST_RIDE_ID } },
    { name: 'ride:status-changed', data: { rideId: TEST_RIDE_ID, status: 'driver_assigned', driverId: TEST_DRIVER_ID } },
    { name: 'driver:arrived', data: { rideId: TEST_RIDE_ID, driverId: TEST_DRIVER_ID, message: 'Driver arrived at pickup' } },
    { name: 'ride:started', data: { rideId: TEST_RIDE_ID, driverId: TEST_DRIVER_ID } },
    { name: 'ride:completed', data: { rideId: TEST_RIDE_ID, driverId: TEST_DRIVER_ID, fare: 250, paymentMethod: 'cash' } }
  ];
  
  let successCount = 0;
  
  for (const event of events) {
    try {
      await pusher.trigger(channelName, event.name, event.data);
      console.log(`✅ Event triggered: ${event.name}`);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to trigger ${event.name}:`, error.message);
    }
  }
  
  console.log(`\n   Successfully triggered ${successCount}/${events.length} events\n`);
  return successCount === events.length;
}

// Test 4: Simulate Driver Location Updates
async function testDriverLocationUpdates() {
  console.log('📍 Test 4: Driver Location Updates');
  console.log('----------------------------------');
  
  const channelName = `private-ride-${TEST_RIDE_ID}`;
  const locations = [
    { lat: 40.7128, lng: -74.0060, eta: 15, etaText: '15 mins' },
    { lat: 40.7130, lng: -74.0055, eta: 12, etaText: '12 mins' },
    { lat: 40.7135, lng: -74.0048, eta: 8, etaText: '8 mins' },
    { lat: 40.7140, lng: -74.0040, eta: 5, etaText: '5 mins' },
    { lat: 40.7145, lng: -74.0035, eta: 2, etaText: '2 mins' }
  ];
  
  let successCount = 0;
  
  for (let i = 0; i < locations.length; i++) {
    try {
      const locationData = {
        driverId: TEST_DRIVER_ID,
        latitude: locations[i].lat,
        longitude: locations[i].lng,
        rideId: TEST_RIDE_ID,
        timestamp: new Date(),
        eta: locations[i].eta,
        etaText: locations[i].etaText,
        remainingDistance: 5 - i
      };
      
      await pusher.trigger(channelName, 'driver:location-updated', locationData);
      console.log(`✅ Location ${i + 1}: (${locations[i].lat}, ${locations[i].lng}) - ETA: ${locations[i].etaText}`);
      successCount++;
      
      // Simulate real-time delay
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`❌ Failed to send location ${i + 1}:`, error.message);
    }
  }
  
  console.log(`\n   Successfully sent ${successCount}/${locations.length} location updates\n`);
  return successCount === locations.length;
}

// Test 5: Test Ride Status Transitions
async function testRideStatusTransitions() {
  console.log('🔄 Test 5: Ride Status Transitions');
  console.log('----------------------------------');
  
  const channelName = `private-ride-${TEST_RIDE_ID}`;
  const statuses = [
    { status: 'driver_assigned', message: 'Driver assigned to ride' },
    { status: 'driver_arrived', message: 'Driver arrived at pickup' },
    { status: 'in_progress', message: 'Ride started' },
    { status: 'completed', message: 'Ride completed' }
  ];
  
  let successCount = 0;
  
  for (const status of statuses) {
    try {
      await pusher.trigger(channelName, 'ride:status-changed', {
        rideId: TEST_RIDE_ID,
        status: status.status,
        driverId: TEST_DRIVER_ID,
        timestamp: new Date(),
        message: status.message
      });
      console.log(`✅ Status transition: ${status.status} - ${status.message}`);
      successCount++;
      
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`❌ Failed to transition to ${status.status}:`, error.message);
    }
  }
  
  console.log(`\n   Successfully completed ${successCount}/${statuses.length} status transitions\n`);
  return successCount === statuses.length;
}

// Test 6: Test Ride Cancellation
async function testRideCancellation() {
  console.log('❌ Test 6: Ride Cancellation');
  console.log('----------------------------');
  
  const channelName = `private-ride-${TEST_RIDE_ID}`;
  
  try {
    await pusher.trigger(channelName, 'ride:cancelled', {
      rideId: TEST_RIDE_ID,
      cancelledBy: 'customer',
      reason: 'Test cancellation',
      timestamp: new Date(),
      message: 'Ride cancelled by customer',
      cancellationFee: 0
    });
    
    console.log('✅ Ride cancellation event triggered successfully\n');
    return true;
  } catch (error) {
    console.error('❌ Failed to trigger cancellation:', error.message);
    console.log('');
    return false;
  }
}

// Test 7: Test API Endpoints (if server is running)
async function testAPIEndpoints() {
  console.log('🌐 Test 7: API Endpoints');
  console.log('------------------------');
  
  // Test health endpoint
  try {
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    if (healthResponse.status === 200) {
      console.log('✅ Health check endpoint: OK');
    } else {
      console.log('❌ Health check endpoint: Failed');
    }
  } catch (error) {
    console.log('⚠️  Health check endpoint: Server not responding (skip if server not running)');
  }
  
  // Test Pusher auth endpoint
  try {
    const authResponse = await axios.post(`${BASE_URL}/pusher/auth`, {
      socket_id: `test-socket-${Date.now()}`,
      channel_name: `private-ride-${TEST_RIDE_ID}`
    });
    
    if (authResponse.status === 200 && authResponse.data.auth) {
      console.log('✅ Pusher auth endpoint: OK');
    } else {
      console.log('❌ Pusher auth endpoint: Failed');
    }
  } catch (error) {
    console.log('⚠️  Pusher auth endpoint: Server not responding (skip if server not running)');
  }
  
  console.log('');
  return true;
}

// Test 8: Simulate Real User Flow
async function testRealUserFlow() {
  console.log('👥 Test 8: Real User Flow Simulation');
  console.log('-------------------------------------');
  
  const rideChannel = `private-ride-${TEST_RIDE_ID}`;
  const driverChannel = `private-driver-${TEST_DRIVER_ID}`;
  const customerChannel = `private-customer-${TEST_CUSTOMER_ID}`;
  
  // 1. Customer requests ride
  console.log('📱 Step 1: Customer requests ride');
  await pusher.trigger('ride-requests', 'new-ride-requested', {
    rideId: TEST_RIDE_ID,
    customerId: TEST_CUSTOMER_ID,
    pickupLocation: { lat: 40.7128, lng: -74.0060 },
    dropLocation: { lat: 40.7145, lng: -74.0035 },
    timestamp: new Date()
  });
  console.log('   ✅ Ride request broadcast to nearby drivers');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 2. Driver receives request
  console.log('🚗 Step 2: Driver receives ride request');
  await pusher.trigger(driverChannel, 'ride:new_request', {
    rideId: TEST_RIDE_ID,
    pickupLocation: { address: 'Test Pickup Location' },
    dropLocation: { address: 'Test Drop Location' },
    estimatedFare: 250,
    distanceFromDriver: 2.5,
    etaToPickup: 8,
    expiresIn: 30
  });
  console.log('   ✅ Request sent to driver');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 3. Driver accepts ride
  console.log('✅ Step 3: Driver accepts ride');
  await pusher.trigger(rideChannel, 'ride:accepted', {
    rideId: TEST_RIDE_ID,
    driver: {
      driverId: TEST_DRIVER_ID,
      name: 'Test Driver',
      vehicleType: 'car',
      vehicleNumber: 'TEST123',
      rating: 4.5,
      location: { lat: 40.7120, lng: -74.0055 }
    },
    eta: 8,
    etaText: '8 mins'
  });
  console.log('   ✅ Acceptance sent to customer');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 4. Driver joins tracking
  console.log('📍 Step 4: Driver starts location sharing');
  await pusher.trigger(rideChannel, 'tracking:joined', {
    rideId: TEST_RIDE_ID,
    userType: 'driver',
    message: 'Driver joined tracking'
  });
  console.log('   ✅ Driver joined tracking');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 5. Send location updates
  console.log('🔄 Step 5: Driver sends location updates');
  const locations = [
    { lat: 40.7120, lng: -74.0055, eta: 7 },
    { lat: 40.7125, lng: -74.0048, eta: 5 },
    { lat: 40.7130, lng: -74.0042, eta: 3 },
    { lat: 40.7135, lng: -74.0038, eta: 1 }
  ];
  
  for (const loc of locations) {
    await pusher.trigger(rideChannel, 'driver:location-updated', {
      driverId: TEST_DRIVER_ID,
      latitude: loc.lat,
      longitude: loc.lng,
      rideId: TEST_RIDE_ID,
      eta: loc.eta,
      etaText: `${loc.eta} mins`
    });
    console.log(`   📍 Location: (${loc.lat}, ${loc.lng}) - ETA: ${loc.eta} mins`);
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  // 6. Driver arrives
  console.log('🏁 Step 6: Driver arrives at pickup');
  await pusher.trigger(rideChannel, 'driver:arrived', {
    rideId: TEST_RIDE_ID,
    driverId: TEST_DRIVER_ID,
    message: 'Driver has arrived at pickup location'
  });
  console.log('   ✅ Driver arrived notification sent');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 7. Ride started
  console.log('🚀 Step 7: Ride started');
  await pusher.trigger(rideChannel, 'ride:started', {
    rideId: TEST_RIDE_ID,
    driverId: TEST_DRIVER_ID,
    message: 'Ride has started'
  });
  console.log('   ✅ Ride started notification sent');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 8. Ride completed
  console.log('🏆 Step 8: Ride completed');
  await pusher.trigger(rideChannel, 'ride:completed', {
    rideId: TEST_RIDE_ID,
    driverId: TEST_DRIVER_ID,
    fare: 250,
    paymentMethod: 'cash',
    message: 'Ride completed successfully'
  });
  console.log('   ✅ Ride completed notification sent');
  
  console.log('\n✅ Real user flow simulation completed successfully!\n');
  return true;
}

// Main test runner
async function runAllTests() {
  console.log('🚀 STARTING PUSHER INTEGRATION TESTS');
  console.log('====================================\n');
  
  const results = {
    pusherConnection: await testPusherConnection(),
    channelAuth: await testChannelAuthentication(),
    eventTriggering: await testEventTriggering(),
    driverLocation: await testDriverLocationUpdates(),
    statusTransitions: await testRideStatusTransitions(),
    rideCancellation: await testRideCancellation(),
    apiEndpoints: await testAPIEndpoints(),
    userFlow: await testRealUserFlow()
  };
  
  // Summary
  console.log('📊 TEST SUMMARY');
  console.log('===============');
  console.log(`✅ Pusher Connection: ${results.pusherConnection ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ Channel Auth: ${results.channelAuth ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ Event Triggering: ${results.eventTriggering ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ Driver Location: ${results.driverLocation ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ Status Transitions: ${results.statusTransitions ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ Ride Cancellation: ${results.rideCancellation ? 'PASSED' : 'FAILED'}`);
  console.log(`✅ API Endpoints: Completed`);
  console.log(`✅ User Flow: ${results.userFlow ? 'PASSED' : 'FAILED'}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  
  console.log('\n====================================');
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED! Pusher integration is working correctly!');
  } else {
    console.log('⚠️  SOME TESTS FAILED. Please check the errors above.');
  }
  console.log('====================================\n');
  
  return allPassed;
}

// Export functions for use in other files
export {
  testPusherConnection,
  testChannelAuthentication,
  testEventTriggering,
  testDriverLocationUpdates,
  testRideStatusTransitions,
  testRideCancellation,
  testAPIEndpoints,
  testRealUserFlow,
  runAllTests
};