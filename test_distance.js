import { calculateDistanceAndDuration } from './controllers/rideController.js';

const testDistance = async () => {
  try {
    // Some sample coordinates in India (e.g. within Bangalore)
    const pickupLat = 12.9715987;
    const pickupLng = 77.5945627;
    const dropLat = 12.9351929;
    const dropLng = 77.62448069999999;
    
    console.log(`Calculating distance from ${pickupLat},${pickupLng} to ${dropLat},${dropLng}...`);
    
    const result = await calculateDistanceAndDuration(pickupLat, pickupLng, dropLat, dropLng, 'bike');
    
    console.log('Result from Google Maps Directions API:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error during distance calculation test:', error);
  }
};

testDistance();
