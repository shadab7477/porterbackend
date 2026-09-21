import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
console.log('Connecting to MongoDB...');
await mongoose.connect(mongoUri);
console.log('Connected to MongoDB successfully!');

import Customer from '../models/Customer.js';
import DriverApplication from '../models/DriverApplication.js';
import Driver from '../models/Driver.js';
import OTP from '../models/OTP.js';

async function seed() {
  const phone = '7477246478';

  console.log('Cleaning up existing dummy records...');
  await OTP.deleteMany({ mobile: phone });
  await Customer.deleteMany({ phone });
  await DriverApplication.deleteMany({ phone });
  await Driver.deleteMany({ phone });

  console.log('Creating verified Customer...');
  const customer = new Customer({
    phone,
    name: 'PlayStore Tester',
    email: 'tester@playstore.com',
    isVerified: true
  });
  await customer.save();
  console.log('✅ Customer created successfully:', customer._id);

  console.log('Creating verified DriverApplication...');
  const application = new DriverApplication({
    driverId: 'DRV-DUMMY-7477',
    phone,
    fullName: 'PlayStore Tester',
    email: 'tester@playstore.com',
    verificationStatus: 'verified',
    vehicleType: 'Bike',
    vehicleNumber: 'TS-09-DUMMY',
    reviewedAt: new Date()
  });
  await application.save();
  console.log('✅ DriverApplication created successfully:', application._id);

  console.log('Creating verified Driver...');
  const driver = new Driver({
    driverId: application.driverId,
    name: application.fullName,
    phone,
    email: application.email,
    applicationId: application._id,
    vehicleType: application.vehicleType,
    vehicleNumber: application.vehicleNumber,
    isOnline: false,
    lastActive: new Date()
  });
  await driver.save();
  console.log('✅ Driver created successfully:', driver._id);
}

try {
  await seed();
  console.log('\nAll dummy user records successfully seeded in the backend!');
} catch (err) {
  console.error('Seeding error:', err);
} finally {
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}
