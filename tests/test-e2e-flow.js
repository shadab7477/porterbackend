// tests/test-e2e-flow.js
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = 'http://localhost:5001';
const customerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5Zjg2N2M1ZGIxMTdhMWE3NTFhNjAyNyIsInBob25lIjoiODMxOTMxOTE5MSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTI2NDU4MiwiZXhwIjoxODY3NTc4MTgyfQ.X15F9dh7kZUNl_ZbXhdTck5okKTG-I7XweP9U62kUWQ';
const driverToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMmJkOWU4OTQwMmY5MzI3NmYwY2ZmZiIsInBob25lIjoiNzQ3NzI0NjQ3NyIsInR5cGUiOiJkcml2ZXJfYXV0aCIsInJvbGUiOiJkcml2ZXIiLCJpc1ZlcmlmaWVkIjp0cnVlLCJpYXQiOjE3ODEyNjQzNzAsImV4cCI6MTc4Mzg1NjM3MH0.inpD7ltM6rmeLls7ciwJ46EArL7wzlpKxy1o3p8N80o';

async function run() {
  console.log('🚀 Starting E2E Socket Flow Test using real tokens...');
  
  // 1. Fetch Driver Profile to get vehicleType
  console.log('\n[1/9] Fetching driver profile...');
  let vehicleType = 'car'; // default fallback
  try {
    const profileRes = await axios.get(`${API_URL}/api/driver/profile`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    console.log('Driver profile retrieved:', {
      name: profileRes.data.data.name,
      phone: profileRes.data.data.phone,
      vehicleType: profileRes.data.data.vehicleType,
      isVerified: profileRes.data.data.isVerified
    });
    if (profileRes.data.data.vehicleType) {
      vehicleType = profileRes.data.data.vehicleType;
    }
  } catch (error) {
    console.error('❌ Failed to retrieve driver profile:', error.response?.data || error.message);
    return;
  }

  // 2. Ensure Driver is Online and Available
  console.log('\n[2/9] Checking driver online/availability status...');
  try {
    const statusRes = await axios.get(`${API_URL}/api/driver/online-status`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    const statusData = statusRes.data.data;
    console.log('Driver status:', statusData);
    
    if (!statusData.isOnline || !statusData.isAvailable) {
      console.log('Driver is not online or not available. Setting online...');
      if (statusData.isOnline) {
        // Toggle offline first
        console.log('Toggling offline first...');
        await axios.post(`${API_URL}/api/driver/toggle-online`, {}, {
          headers: { Authorization: `Bearer ${driverToken}` }
        });
      }
      
      // Toggle online with coordinates matching pickup coordinates
      console.log('Toggling online with coordinates...');
      await axios.post(`${API_URL}/api/driver/toggle-online`, {
        latitude: 22.7196,
        longitude: 75.8577
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      console.log('🟢 Driver is now online and available!');
    } else {
      console.log('🟢 Driver is already online and available.');
    }
  } catch (error) {
    console.error('❌ Failed to set driver online:', error.response?.data || error.message);
    return;
  }

  // 3. Request ride with matching vehicleType
  console.log(`\n[3/9] Customer requesting ride with vehicle type: ${vehicleType}...`);
  let rideResponse;
  try {
    rideResponse = await axios.post(`${API_URL}/api/rides/request`, {
      pickupLocation: {
        coordinates: [75.8577, 22.7196],
        address: "Indore Pickup Office"
      },
      dropLocation: {
        coordinates: [75.8700, 22.7300],
        address: "Indore Drop Mall"
      },
      vehicleType: vehicleType,
      paymentMethod: "cash"
    }, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
  } catch (error) {
    console.error('❌ Request ride failed:', error.response?.data || error.message);
    return;
  }
  
  const ride = rideResponse.data.data;
  const rideId = ride.rideId;
  const customerId = '69f867c5db117a1a751a6027';
  console.log(`✅ Ride requested! Ride ID: ${rideId}`);
  
  // 4. Connect customer Socket
  console.log('\n[4/9] Connecting customer socket...');
  const customerSocket = io(API_URL, {
    transports: ['websocket']
  });
  
  const eventsReceived = [];
  
  customerSocket.on('connect', () => {
    console.log('🟢 Customer socket connected:', customerSocket.id);
    console.log('\n[5/9] Customer joining tracking room...');
    customerSocket.emit('customer:join-tracking', { customerId, rideId });
  });
  
  customerSocket.on('tracking:joined', (data) => {
    console.log('📥 Received tracking:joined status:', data.rideDetails?.status);
  });
  
  customerSocket.on('ride:status-changed', (data) => {
    console.log(`📥 Received ride:status-changed: [${data.status}]`);
    eventsReceived.push(data.status);
  });
  
  customerSocket.on('ride:accepted', (data) => {
    console.log('📥 Received ride:accepted (acceptanceData) with driver:', data.driver?.name);
  });
  
  customerSocket.on('driver:arrived', (data) => {
    console.log('📥 Received driver:arrived message:', data.message);
  });
  
  customerSocket.on('ride:started', (data) => {
    console.log('📥 Received ride:started message:', data.message);
  });
  
  customerSocket.on('ride:completed', (data) => {
    console.log('📥 Received ride:completed message:', data.message);
  });
  
  // Wait for socket to connect and join
  await new Promise(r => setTimeout(r, 2000));
  
  // 5. Driver accepts ride
  console.log('\n[6/9] Driver accepting ride...');
  try {
    const acceptResponse = await axios.post(`${API_URL}/api/rides/accept-with-socket`, {
      rideId,
      driverLocation: {
        latitude: 22.7196,
        longitude: 75.8577
      }
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    console.log('✅ Driver accepted ride response:', acceptResponse.data.message);
  } catch (error) {
    console.error('❌ Driver accept failed:', error.response?.data || error.message);
    customerSocket.disconnect();
    return;
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 6. Driver arrives at pickup
  console.log('\n[7/9] Driver marking arrived...');
  try {
    const arrivedResponse = await axios.post(`${API_URL}/api/rides/arrived`, {
      rideId
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    console.log('✅ Driver arrived response:', arrivedResponse.data.message);
  } catch (error) {
    console.error('❌ Driver arrived failed:', error.response?.data || error.message);
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 7. Driver starts ride
  console.log('\n[8/9] Driver starting ride...');
  try {
    const startResponse = await axios.post(`${API_URL}/api/rides/start`, {
      rideId
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    console.log('✅ Driver started response:', startResponse.data.message);
  } catch (error) {
    console.error('❌ Driver start failed:', error.response?.data || error.message);
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 8. Driver completes ride
  console.log('\n[9/9] Driver completing ride...');
  try {
    const completeResponse = await axios.post(`${API_URL}/api/rides/complete`, {
      rideId
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    console.log('✅ Driver completed response:', completeResponse.data.message);
  } catch (error) {
    console.error('❌ Driver complete failed:', error.response?.data || error.message);
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('\n========================================');
  console.log('--- E2E TEST SUMMARY ---');
  console.log('Expected status transitions: [driver_assigned, driver_arrived, in_progress, completed]');
  console.log('Actual status transitions received:', eventsReceived);
  console.log('========================================');
  
  const success = eventsReceived.includes('driver_assigned') &&
                  eventsReceived.includes('driver_arrived') &&
                  eventsReceived.includes('in_progress') &&
                  eventsReceived.includes('completed');
  if (success) {
    console.log('🟢 SUCCESS: All status transitions tracked perfectly over Socket!');
  } else {
    console.log('🔴 FAILURE: Missing some status transitions over Socket.');
  }
  
  customerSocket.disconnect();
  console.log('🏁 Test script complete.');
}

run();
