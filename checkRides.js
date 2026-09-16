import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Ride from './models/Ride.js';
import Driver from './models/Driver.js';

async function checkRides() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/porter');
  
  const drivers = await Driver.find({});
  console.log(`Found ${drivers.length} drivers`);
  
  for (const driver of drivers) {
      const rides = await Ride.find({ 'driver.driverId': driver._id, status: 'completed' });
      if (rides.length > 0) {
          console.log(`Driver ${driver._id} has ${rides.length} completed rides`);
          for (const ride of rides) {
              console.log(`- Ride ${ride._id}: fare: ${JSON.stringify(ride.fare)}, completedAt: ${ride.rideCompletedAt}, updatedAt: ${ride.updatedAt}`);
          }
      }
  }
  
  process.exit(0);
}

checkRides().catch(console.error);
