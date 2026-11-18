import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

import mongoose from 'mongoose';
import assert from 'assert';
import Customer from '../models/Customer.js';
import Ride from '../models/Ride.js';
import { checkDailyFreeRideEligibility, getCustomerDailyFreeRideStatus } from '../utils/freeRideService.js';
import { requestRide, calculateFareEstimate } from '../controllers/rideController.js';

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
        emit: () => {},
        to: () => ({ emit: () => {} }),
        of: () => ({ to: () => ({ emit: () => {} }) })
      };
    }
    return null;
  }
};

async function runStrictSingleFreeRideTest() {
  try {
    console.log('🧪 Starting Strict 1 Free Ride Per User Per Day Test (Shared Bike/Scooty)...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const randPhone = '88888' + Math.floor(10000 + Math.random() * 90000);
    const testCustomer = await Customer.create({
      name: 'Strict Limit Tester',
      phone: randPhone,
      isPhoneVerified: true
    });
    console.log('Created test customer:', testCustomer._id.toString(), 'phone:', randPhone);

    // 1. Initial State: User should have 1 free ride remaining
    const statusBefore = await getCustomerDailyFreeRideStatus(testCustomer._id);
    console.log('Status before any ride:', {
      eligible: statusBefore.eligible,
      ridesRemainingToday: statusBefore.ridesRemainingToday
    });
    assert.strictEqual(statusBefore.eligible, true);
    assert.strictEqual(statusBefore.ridesRemainingToday, 1);
    console.log('✅ PASS: Initial status has exactly 1 free ride available');

    // 2. Initial Eligibility for both Bike and Scooty
    const checkBikeBefore = await checkDailyFreeRideEligibility(testCustomer._id, 'bike', 1.0);
    const checkScootyBefore = await checkDailyFreeRideEligibility(testCustomer._id, 'scooty', 1.0);
    assert.strictEqual(checkBikeBefore.eligible, true);
    assert.strictEqual(checkScootyBefore.eligible, true);
    console.log('✅ PASS: Both Bike and Scooty are initially eligible options');

    // 3. User Books a Free Ride on BIKE
    console.log('--- Step 3: Booking 1st Free Ride on Bike ---');
    const bikePayload = {
      vehicleType: 'Bike',
      pickupLocation: {
        coordinates: [75.899, 22.770],
        address: 'Pickup A'
      },
      dropLocation: {
        coordinates: [75.898, 22.771],
        address: 'Drop B'
      },
      distance: 0.5,
      duration: 2,
      amount: 0,
      paymentMethod: 'free',
      isFreeRide: true
    };
    const req1 = {
      customerId: testCustomer._id,
      body: bikePayload,
      app: mockApp
    };
    const res1 = mockResponse();
    await requestRide(req1, res1);

    assert.strictEqual(res1.statusCode, 201);
    assert.strictEqual(res1.body.success, true);
    assert.strictEqual(res1.body.data.isFreeRide, true);
    assert.strictEqual(res1.body.data.customerPayable, 0);
    const firstRideId = res1.body.data.rideId;
    console.log(`✅ PASS: 1st ride on Bike successfully booked as FREE (#${firstRideId})`);

    // 4. User Immediately Tries to Book on SCOOTY as Free Ride
    console.log('--- Step 4: Attempting to Book 2nd Free Ride on Scooty (MUST BE REJECTED) ---');
    const scootyPayload = {
      vehicleType: 'Scooty',
      pickupLocation: {
        coordinates: [75.899, 22.770],
        address: 'Pickup A'
      },
      dropLocation: {
        coordinates: [75.898, 22.771],
        address: 'Drop B'
      },
      distance: 0.8,
      duration: 3,
      amount: 0,
      paymentMethod: 'free',
      isFreeRide: true
    };
    const req2 = {
      customerId: testCustomer._id,
      body: scootyPayload,
      app: mockApp
    };
    const res2 = mockResponse();
    await requestRide(req2, res2);

    console.log('2nd ride request response status:', res2.statusCode);
    console.log('2nd ride request response message:', res2.body?.message);

    assert.strictEqual(res2.statusCode, 400, 'Second free ride attempt MUST return 400');
    assert.strictEqual(res2.body.success, false);
    assert.strictEqual(res2.body.errorType, 'DAILY_FREE_RIDE_LIMIT_EXCEEDED');
    assert.strictEqual(res2.body.details.ridesRemainingToday, 0);
    console.log('✅ PASS: Second free ride on Scooty was STRICTLY REJECTED with 400 Bad Request!');

    // 5. User Tries to Book another BIKE ride as Free
    console.log('--- Step 5: Attempting to Book 2nd Free Ride on Bike (MUST BE REJECTED) ---');
    const req3 = {
      customerId: testCustomer._id,
      body: bikePayload,
      app: mockApp
    };
    const res3 = mockResponse();
    await requestRide(req3, res3);

    assert.strictEqual(res3.statusCode, 400, 'Third free ride attempt on bike MUST return 400');
    assert.strictEqual(res3.body.errorType, 'DAILY_FREE_RIDE_LIMIT_EXCEEDED');
    console.log('✅ PASS: Second free ride on Bike was also STRICTLY REJECTED with 400!');

    // 6. Check Daily Status: ridesRemainingToday MUST be 0
    const statusAfter = await getCustomerDailyFreeRideStatus(testCustomer._id);
    console.log('Status after 1 free ride:', {
      eligible: statusAfter.eligible,
      todayFreeRidesUsed: statusAfter.todayFreeRidesUsed,
      ridesRemainingToday: statusAfter.ridesRemainingToday
    });
    assert.strictEqual(statusAfter.eligible, false);
    assert.strictEqual(statusAfter.todayFreeRidesUsed, 1);
    assert.strictEqual(statusAfter.ridesRemainingToday, 0);
    console.log('✅ PASS: Daily status correctly reports 0 free rides remaining');

    // 7. Check Fare Estimate API for this user: Neither Bike nor Scooty should be free now
    console.log('--- Step 7: Checking Fare Estimate API after booking ---');
    const reqEstimate = {
      customerId: testCustomer._id,
      query: {
        pickupLat: '22.770',
        pickupLon: '75.899',
        dropLat: '22.771',
        dropLon: '75.898',
        vehicleType: 'Bike'
      },
      headers: {}
    };
    const resEstimate = mockResponse();
    await calculateFareEstimate(reqEstimate, resEstimate);

    assert.strictEqual(resEstimate.body.success, true);
    assert.strictEqual(resEstimate.body.data.isFreeRide, false, 'Estimate must report isFreeRide=false');
    assert.strictEqual(resEstimate.body.data.freeRidePolicy.ridesRemainingToday, 0);

    const vehicleOpts = resEstimate.body.data.vehicleOptions;
    const bikeOpt = vehicleOpts.find(v => v.vehicleType.toLowerCase() === 'bike');
    const scootyOpt = vehicleOpts.find(v => v.vehicleType.toLowerCase() === 'scooty');

    if (bikeOpt) assert.strictEqual(bikeOpt.isFreeRide, false);
    if (scootyOpt) assert.strictEqual(scootyOpt.isFreeRide, false);
    console.log('✅ PASS: Fare estimate reports 0 free rides remaining and neither Bike nor Scooty is free');

    // Clean up
    await Ride.deleteMany({ 'customer.customerId': testCustomer._id });
    await Customer.deleteOne({ _id: testCustomer._id });
    console.log('✅ Cleaned up test data');

    await mongoose.disconnect();
    console.log('🎉 ALL STRICT SINGLE FREE RIDE TESTS PASSED 100%!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runStrictSingleFreeRideTest();

