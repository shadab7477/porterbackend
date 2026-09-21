import mongoose from 'mongoose';
import Ride from './models/Ride.js';

async function testFare() {
  try {
    // We mock the Vehicle model temporarily to avoid needing a full DB connection if we just want to test the fallback logic
    // But since it tries to connect to the DB in calculateFare:
    // const Vehicle = mongoose.model('Vehicle');
    // We will just let it use the fallback if no DB connection, but actually let's connect to the DB if possible.
    
    await mongoose.connect('mongodb://127.0.0.1:27017/porter_db'); // Assuming standard local URL or we let it fail and use fallback
    
    // Register a dummy Vehicle model if it doesn't exist
    try {
      mongoose.model('Vehicle');
    } catch {
      mongoose.model('Vehicle', new mongoose.Schema({
        vehicleType: String,
        baseFare: Number,
        pricePerKm: Number,
        isActive: Boolean
      }));
    }
    
    const result = await Ride.calculateFare(18, 'bike');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error testing fare:", error);
  } finally {
    await mongoose.disconnect();
  }
}

testFare();
