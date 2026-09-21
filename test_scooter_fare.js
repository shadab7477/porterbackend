import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Ride from './models/Ride.js';
import Vehicle from './models/Vehicle.js';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/porter', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB');
  
  // Find a scooter vehicle to see its properties
  const scooter = await Vehicle.findOne({ vehicleType: { $in: ['scooter', 'scooty'] } });
  console.log('Scooter in DB:', scooter ? scooter.slabRates : 'Not found');

  // Test 2.6km calculation
  const fare = await Ride.calculateFare(2.6, scooter ? scooter.vehicleType : 'scooter', false);
  console.log('Fare for 2.6km scooter:', JSON.stringify(fare, null, 2));

  mongoose.disconnect();
}).catch(err => {
  console.error(err);
});
