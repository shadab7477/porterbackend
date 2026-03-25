// websocket_test_client.js
// Run with: node websocket_test_client.js
import { io } from "socket.io-client";
import readline from "readline"

// Configuration
const SERVER_URL = 'http://localhost:5000';
const driverId = '69b907835a1dba1df195fc3a'; // Replace with actual driver ID
const customerId = '69aa71dc74c40e6d2d483964'; // Replace with actual customer ID
const rideId = 'RID2870413430'; // Replace with actual ride ID

// Create readline interface for interactive testing
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

console.log(`${colors.bright}${colors.cyan}🚀 Driver Real-time Tracking Test Client${colors.reset}\n`);

// Function to simulate driver
async function simulateDriver() {
  console.log(`${colors.yellow}📱 Simulating Driver${colors.reset}`);
  
  const driverSocket = io(`${SERVER_URL}/ride-tracking`, {
    auth: {
      token: 'driver_token_here', // Replace with actual token
      userId: driverId,
      userType: 'driver'
    },
    transports: ['websocket']
  });
  
  driverSocket.on('connect', () => {
    console.log(`${colors.green}✅ Driver connected: ${driverSocket.id}${colors.reset}`);
    
    // Join tracking
    driverSocket.emit('driver:join-tracking', {
      driverId: driverId,
      rideId: rideId
    });
    
    console.log(`${colors.blue}📡 Joined tracking for ride ${rideId}${colors.reset}`);
  });
  
  driverSocket.on('tracking:joined', (data) => {
    console.log(`${colors.green}✅ ${data.message}${colors.reset}`);
    
    // Start sending location updates every 3 seconds
    let counter = 0;
    const locations = [
      { lat: 28.6139, lng: 77.2090 },  // Connaught Place
      { lat: 28.6189, lng: 77.2120 },  // Moving towards
      { lat: 28.6239, lng: 77.2150 },  // Continue moving
      { lat: 28.6289, lng: 77.2190 }   // India Gate (destination)
    ];
    
    const interval = setInterval(() => {
      const location = locations[counter % locations.length];
      counter++;
      
      console.log(`${colors.blue}📍 Sending location update: ${location.lat}, ${location.lng}${colors.reset}`);
      
      driverSocket.emit('driver:location-update', {
        driverId: driverId,
        rideId: rideId,
        latitude: location.lat,
        longitude: location.lng,
        bearing: 45 // Optional: direction
      });
      
      // After 4 updates, simulate reaching destination
      if (counter === 4) {
        setTimeout(() => {
          console.log(`${colors.green}🏁 Reached destination!${colors.reset}`);
          driverSocket.emit('ride:status-update', {
            rideId: rideId,
            status: 'completed',
            driverId: driverId
          });
          clearInterval(interval);
          
          // Disconnect after 2 seconds
          setTimeout(() => {
            driverSocket.disconnect();
            console.log(`${colors.red}🔴 Driver disconnected${colors.reset}`);
            process.exit(0);
          }, 2000);
        }, 1000);
      }
    }, 3000);
  });
  
  driverSocket.on('driver:send-location', (data) => {
    console.log(`${colors.yellow}⚠️ Location requested by customer${colors.reset}`);
    driverSocket.emit('driver:send-location-response', {
      driverId: driverId,
      rideId: data.rideId,
      latitude: 28.6139,
      longitude: 77.2090,
      customerId: data.customerId
    });
  });
  
  driverSocket.on('ride:status-changed', (data) => {
    console.log(`${colors.green}📊 Ride status changed: ${data.status}${colors.reset}`);
  });
  
  driverSocket.on('error', (error) => {
    console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
  });
  
  driverSocket.on('disconnect', () => {
    console.log(`${colors.red}🔴 Driver disconnected${colors.reset}`);
  });
}

// Function to simulate customer
async function simulateCustomer() {
  console.log(`${colors.yellow}👤 Simulating Customer${colors.reset}`);
  
  const customerSocket = io(`${SERVER_URL}/ride-tracking`, {
    auth: {
      token: 'customer_token_here', // Replace with actual token
      userId: customerId,
      userType: 'customer'
    },
    transports: ['websocket']
  });
  
  customerSocket.on('connect', () => {
    console.log(`${colors.green}✅ Customer connected: ${customerSocket.id}${colors.reset}`);
    
    // Join tracking
    customerSocket.emit('customer:join-tracking', {
      customerId: customerId,
      rideId: rideId
    });
    
    console.log(`${colors.blue}📡 Joined tracking for ride ${rideId}${colors.reset}`);
  });
  
  customerSocket.on('tracking:joined', (data) => {
    console.log(`${colors.green}✅ ${data.message}${colors.reset}`);
    console.log(`${colors.cyan}📋 Ride Details:${colors.reset}`);
    console.log(`   Pickup: ${JSON.stringify(data.rideDetails?.pickupLocation)}`);
    console.log(`   Drop: ${JSON.stringify(data.rideDetails?.dropLocation)}`);
    console.log(`   Fare: ₹${data.rideDetails?.fare?.total}`);
  });
  
  customerSocket.on('driver:location-updated', (data) => {
    console.log(`${colors.green}📍 Driver location updated:${colors.reset}`);
    console.log(`   Latitude: ${data.latitude}`);
    console.log(`   Longitude: ${data.longitude}`);
    if (data.eta) {
      console.log(`   ETA: ${data.etaText}`);
    }
    if (data.remainingDistance) {
      console.log(`   Distance: ${data.remainingDistance.toFixed(2)} km`);
    }
    console.log(`   Time: ${new Date(data.timestamp).toLocaleTimeString()}`);
    console.log('---');
  });
  
  customerSocket.on('driver:arrived', (data) => {
    console.log(`${colors.green}🚗 ${data.message}${colors.reset}`);
  });
  
  customerSocket.on('ride:started', (data) => {
    console.log(`${colors.green}🏁 ${data.message}${colors.reset}`);
  });
  
  customerSocket.on('ride:near-destination', (data) => {
    console.log(`${colors.green}📍 ${data.message}${colors.reset}`);
    console.log(`   Remaining: ${data.remainingDistance.toFixed(0)} meters`);
  });
  
  customerSocket.on('ride:completed', (data) => {
    console.log(`${colors.green}✅ ${data.message}${colors.reset}`);
    console.log(`${colors.cyan}💰 Fare: ₹${data.fare}${colors.reset}`);
    console.log(`${colors.cyan}💳 Payment: ${data.paymentMethod}${colors.reset}`);
    
    // Disconnect after 2 seconds
    setTimeout(() => {
      customerSocket.disconnect();
      console.log(`${colors.red}🔴 Customer disconnected${colors.reset}`);
    }, 2000);
  });
  
  customerSocket.on('driver:disconnected', (data) => {
    console.log(`${colors.red}⚠️ ${data.message}${colors.reset}`);
  });
  
  customerSocket.on('error', (error) => {
    console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
  });
  
  customerSocket.on('disconnect', () => {
    console.log(`${colors.red}🔴 Customer disconnected${colors.reset}`);
  });
}

// Interactive menu
function showMenu() {
  console.log('\n');
  console.log(`${colors.bright}${colors.cyan}=== Test Options ===${colors.reset}`);
  console.log('1. Simulate Driver Only');
  console.log('2. Simulate Customer Only');
  console.log('3. Simulate Both (Driver + Customer)');
  console.log('4. Simulate Complete Ride Flow');
  console.log('5. Stress Test (Multiple Drivers)');
  console.log('6. Exit');
  console.log('---');
  
  rl.question('Select option (1-6): ', (answer) => {
    switch(answer.trim()) {
      case '1':
        simulateDriver();
        break;
      case '2':
        simulateCustomer();
        break;
      case '3':
        simulateDriver();
        setTimeout(() => simulateCustomer(), 1000);
        break;
      case '4':
        simulateCompleteRide();
        break;
      case '5':
        stressTest();
        break;
      case '6':
        console.log(`${colors.yellow}👋 Goodbye!${colors.reset}`);
        rl.close();
        process.exit(0);
        break;
      default:
        console.log(`${colors.red}Invalid option${colors.reset}`);
        showMenu();
    }
  });
}

// Simulate complete ride flow with API calls
async function simulateCompleteRide() {
  console.log(`${colors.bright}${colors.cyan}=== Simulating Complete Ride Flow ===${colors.reset}`);
  
  // This would require making HTTP requests first
  // You can use axios or node-fetch to make API calls
  
  console.log(`${colors.yellow}Step 1: Request a ride${colors.reset}`);
  // Make API call to request ride
  
  console.log(`${colors.yellow}Step 2: Find nearby drivers${colors.reset}`);
  
  console.log(`${colors.yellow}Step 3: Driver accepts ride${colors.reset}`);
  
  console.log(`${colors.yellow}Step 4: Start real-time tracking${colors.reset}`);
  
  // Then start WebSocket connections
  setTimeout(() => {
    simulateDriver();
    setTimeout(() => simulateCustomer(), 1000);
  }, 2000);
}

// Stress test with multiple drivers
function stressTest() {
  console.log(`${colors.bright}${colors.cyan}=== Stress Test: Simulating 10 Drivers ===${colors.reset}`);
  
  const numDrivers = 10;
  const drivers = [];
  
  for (let i = 0; i < numDrivers; i++) {
    setTimeout(() => {
      const mockDriverId = `stress_driver_${i}`;
      console.log(`${colors.blue}Starting driver ${i + 1}/${numDrivers}${colors.reset}`);
      
      const driverSocket = io(`${SERVER_URL}/ride-tracking`, {
        auth: {
          token: 'stress_test_token',
          userId: mockDriverId,
          userType: 'driver'
        }
      });
      
      driverSocket.on('connect', () => {
        driverSocket.emit('driver:join-tracking', {
          driverId: mockDriverId,
          rideId: `stress_ride_${i}`
        });
        
        // Send location updates
        setInterval(() => {
          const lat = 28.6139 + (Math.random() - 0.5) * 0.01;
          const lng = 77.2090 + (Math.random() - 0.5) * 0.01;
          
          driverSocket.emit('driver:location-update', {
            driverId: mockDriverId,
            rideId: `stress_ride_${i}`,
            latitude: lat,
            longitude: lng
          });
        }, 2000);
      });
      
      drivers.push(driverSocket);
    }, i * 500); // Start each driver with 500ms delay
  }
  
  // Stop after 30 seconds
  setTimeout(() => {
    console.log(`${colors.yellow}Stopping stress test...${colors.reset}`);
    drivers.forEach(socket => socket.disconnect());
    console.log(`${colors.green}Stress test completed${colors.reset}`);
    showMenu();
  }, 30000);
}

// Start the menu
showMenu();