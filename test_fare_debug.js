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
  
  // Find a bike vehicle to see its properties
  const bike = await Vehicle.findOne({ vehicleType: 'bike' });
  console.log('Bike in DB:', JSON.stringify(bike, null, 2));

  // Test 8.2km calculation
  const fare = await Ride.calculateFare(8.2, 'bike', false);
  console.log('Fare for 8.2km bike (not merchant):', JSON.stringify(fare, null, 2));

  const fareMerchant = await Ride.calculateFare(8.2, 'bike', true);
  console.log('Fare for 8.2km bike (merchant):', JSON.stringify(fareMerchant, null, 2));

  mongoose.disconnect();
}).catch(err => {
  console.error(err);
});
