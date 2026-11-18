import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Ride from '../models/Ride.js';
import { requestRide } from '../controllers/rideController.js';

const mockResponse = () => {
  const res = {};
  res.statusCode = 200;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
};

const mockApp = {
  get: (key) => {
    if (key === 'io') {
      return {
        emit: (event, data) => {
          // console.log(`[Socket emit] ${event}:`, data?.rideId);
        },
        to: () => ({ emit: () => {} })
      };
    }
    return null;
  }
};

async function runTest() {
  try {
    console.log('🧪 Testing Exact User Free Ride Payload...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Create or find a test customer
    let testCustomer = await Customer.findOne({ phone: '9999988888' });
    if (!testCustomer) {
      testCustomer = await Customer.create({
        name: 'PlayStore Tester Customer',
        phone: '9999988888',
        isPhoneVerified: true
      });
    }

    // Clean up any rides created today by this customer
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    await Ride.deleteMany({
      'customer.customerId': testCustomer._id,
      createdAt: { $gte: startOfDay }
    });

    const userPayload = {
      vehicleType: "Bike",
      pickupLocation: {
        coordinates: [75.8993194, 22.770127],
        address: "QVCX+2PF, 392, Part I, Scheme No 114, Indore, Madhya Pradesh 452010, India"
      },
      dropLocation: {
        coordinates: [75.89708900079131, 22.772090690684315],
        address: "309, 591, AB Rd, Part I, Scheme No 114, Indore, Madhya Pradesh 452010, India"
      },
      distance: 0.45,
      duration: 2,
      amount: 0,
      paymentMethod: "cash",
      receiver: {
        name: "PlayStore Tester",
        phone: "7477246478"
      },
      isFreeRide: true
    };

    const req = {
      customerId: testCustomer._id,
      body: userPayload,
      app: mockApp
    };
    const res = mockResponse();

    await requestRide(req, res);

    console.log('Response Status:', res.statusCode);
    console.log('Response Success:', res.body?.success);
    console.log('Response Message:', res.body?.message);

    if (res.statusCode === 201 && res.body?.success) {
      console.log('🎉 SUCCESS! Ride created successfully:');
      console.log('  RideId:', res.body.data.rideId);
      console.log('  isFreeRide:', res.body.data.isFreeRide);
      console.log('  customerPayable:', res.body.data.customerPayable);
      console.log('  driverPayoutAmount:', res.body.data.driverPayoutAmount);
      console.log('  paymentMethod:', res.body.data.paymentMethod);
      console.log('  status:', res.body.data.status);

      // Verify ride stored in DB
      const savedRide = await Ride.findOne({ rideId: res.body.data.rideId });
      console.log('DB paymentCollectedBy:', savedRide.paymentCollectedBy);
      console.log('DB paymentMethod:', savedRide.paymentMethod);
      console.log('DB paymentStatus:', savedRide.paymentStatus);
      console.log('DB isFreeRide:', savedRide.isFreeRide);

      // Clean up test ride
      await Ride.deleteOne({ rideId: res.body.data.rideId });
      console.log('✅ Cleaned up test ride');
    } else {
      console.error('❌ Failed:', res.body);
      process.exit(1);
    }

    await mongoose.disconnect();
    console.log('🎉 TEST FINISHED WITH 100% SUCCESS!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during test:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTest();

