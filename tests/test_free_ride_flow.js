import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import DriverWallet from '../models/DriverWallet.js';
import DriverWalletTransaction from '../models/DriverWalletTransaction.js';
import Ride from '../models/Ride.js';
import { checkDailyFreeRideEligibility, applyFreeRideToFare, getCustomerDailyFreeRideStatus } from '../utils/freeRideService.js';
import { completeRide } from '../controllers/rideController.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/porter_db';

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName} ${details ? '- ' + details : ''}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('   GoDelivo Daily Free Ride (<= 2km Bike/Scooty)   ');
  console.log('   Full Flow & Automated Driver Wallet Credit Test  ');
  console.log('====================================================\n');

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] Connected to MongoDB successfully.\n');

    // Pre-cleanup leftover test accounts if any
    await Customer.deleteMany({ phone: { $regex: /^9999/ } });
    await Driver.deleteMany({ phone: { $regex: /^8888/ } });

    const randSuffix = Date.now().toString().slice(-6);
    const testPhoneCustomer = `9999${randSuffix}`;
    const testPhoneDriver = `8888${randSuffix}`;

    const testCustomerId = new mongoose.Types.ObjectId();
    const testDriverId = new mongoose.Types.ObjectId();
    const testAppId = new mongoose.Types.ObjectId();

    // 1. Setup Test Customer & Driver
    const customer = await Customer.create({
      _id: testCustomerId,
      name: 'Free Ride Tester',
      phone: testPhoneCustomer,
      email: `freeride_${randSuffix}@godelivo.test`,
      isVerified: true
    });

    const driver = await Driver.create({
      _id: testDriverId,
      driverId: `DRV_TEST_${randSuffix}`,
      applicationId: testAppId,
      name: 'Rider Ramesh',
      phone: testPhoneDriver,
      email: `ramesh_${randSuffix}@godelivo.test`,
      vehicleType: 'bike',
      vehicleNumber: `DL01AB${randSuffix.slice(-4)}`,
      isOnline: true,
      isAvailable: true,
      currentLocation: {
        type: 'Point',
        coordinates: [77.2090, 28.6139],
        address: 'Connaught Place, New Delhi'
      }
    });

    const driverWallet = await DriverWallet.create({
      driverId: testDriverId,
      balance: 100, // Initial cash wallet balance ₹100
      commissionCredit: 0
    });

    console.log('--- TEST GROUP 1: Free Ride Eligibility Rules ---');
    // Rule 1: Bike <= 2km
    const check1 = await checkDailyFreeRideEligibility(testCustomerId, 'bike', 1.8);
    assert(check1.eligible === true, 'Bike <= 2.0km is eligible for free ride');

    // Rule 2: Scooty <= 2km
    const check2 = await checkDailyFreeRideEligibility(testCustomerId, 'scooty', 2.0);
    assert(check2.eligible === true, 'Scooty at exactly 2.0km is eligible for free ride');

    // Rule 3: Bike > 2km
    const check3 = await checkDailyFreeRideEligibility(testCustomerId, 'bike', 2.1);
    assert(check3.eligible === false, 'Bike > 2.0km (2.1km) is NOT eligible for free ride');

    // Rule 4: Non-two-wheeler (Auto, Car) <= 2km
    const check4 = await checkDailyFreeRideEligibility(testCustomerId, 'auto', 1.5);
    assert(check4.eligible === false, 'Auto <= 2.0km is NOT eligible (only bike/scooty)');

    const check5 = await checkDailyFreeRideEligibility(testCustomerId, 'car', 1.5);
    assert(check5.eligible === false, 'Car <= 2.0km is NOT eligible (only bike/scooty)');

    console.log('\n--- TEST GROUP 2: Fare Application ---');
    const standardFare = {
      baseFareAmount: 35,
      distanceFare: 35,
      total: 35,
      discount: 0,
      finalAmount: 35,
      platformFee: 1,
      breakdown: { baseFare: '₹35', distance: '1.8 km', total: '₹35' }
    };
    const freeFare = applyFreeRideToFare(standardFare);
    assert(freeFare.isFreeRide === true, 'Fare has isFreeRide set to true');
    assert(freeFare.finalAmount === 0, 'Customer payable finalAmount is ₹0');
    assert(freeFare.customerPayable === 0, 'fare.customerPayable is ₹0');
    assert(freeFare.driverPayoutAmount === 35, 'fare.driverPayoutAmount preserves the full ride amount (₹35)');
    assert(freeFare.sponsoredBy === 'GoDelivo', 'fare.sponsoredBy is GoDelivo');
    assert(freeFare.breakdown.freeRideOffer !== undefined, 'Breakdown includes GoDelivo Daily Offer information');

    console.log('\n--- TEST GROUP 3: 1 Ride Per Day Limit & Reset On Cancellation ---');
    // Create a free ride for today
    const ride1 = await Ride.create({
      rideId: 'RID_TEST_FREE_1',
      customer: { customerId: testCustomerId, name: customer.name, phone: customer.phone },
      requestedVehicleType: 'bike',
      isFreeRide: true,
      distance: 1.8,
      duration: 8,
      pickupLocation: { type: 'Point', coordinates: [77.2090, 28.6139], address: 'CP' },
      dropLocation: { type: 'Point', coordinates: [77.2190, 28.6239], address: 'Janpath' },
      fare: freeFare,
      paymentMethod: 'free',
      status: 'in_progress',
      driver: {
        driverId: testDriverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber
      }
    });

    // Check second ride attempt by same user today
    const checkSecondRide = await checkDailyFreeRideEligibility(testCustomerId, 'bike', 1.5);
    assert(checkSecondRide.eligible === false, 'Second ride attempt on same day is rejected');
    assert(checkSecondRide.reason.includes('Daily free ride limit reached'), 'Rejection mentions daily limit (1/day)');

    const statusCheck = await getCustomerDailyFreeRideStatus(testCustomerId);
    assert(statusCheck.eligible === false, 'Customer status reports ineligible after booking today');
    assert(statusCheck.ridesRemainingToday === 0, 'Remaining free rides today is 0');

    console.log('\n--- TEST GROUP 4: Automated Driver Wallet Credit On Ride Completion ---');
    const initialDriverBalance = driverWallet.balance; // ₹100
    const expectedDriverPayout = freeFare.driverPayoutAmount; // ₹35

    // Call completeRide simulation
    const mockReq = {
      driver: { id: testDriverId.toString() },
      body: { rideId: 'RID_TEST_FREE_1' },
      app: {
        get: () => ({
          emit: () => {},
          to: () => ({ emit: () => {} }),
          of: () => ({
            to: () => ({ emit: () => {} }),
            emit: () => {}
          })
        })
      }
    };

    let responseStatusCode = 200;
    let responseBody = null;
    const mockRes = {
      status: (code) => { responseStatusCode = code; return mockRes; },
      json: (data) => { responseBody = data; return mockRes; }
    };

    await completeRide(mockReq, mockRes);

    assert(responseStatusCode === 200, 'completeRide returned HTTP 200');
    assert(responseBody?.success === true, 'completeRide succeeded');
    assert(responseBody?.data?.isFreeRide === true, 'Response data indicates isFreeRide: true');
    assert(responseBody?.data?.customerPayable === 0, 'Response confirms customer payable is ₹0');
    assert(responseBody?.data?.driverPayoutAmount === expectedDriverPayout, `Response confirms driverPayoutAmount is ₹${expectedDriverPayout}`);

    // Verify Driver Wallet in Database
    const updatedWallet = await DriverWallet.findOne({ driverId: testDriverId });
    const expectedNewBalance = initialDriverBalance + expectedDriverPayout; // 100 + 35 = 135
    assert(
      updatedWallet.balance === expectedNewBalance,
      `Driver cash wallet was credited directly by GoDelivo! (Expected: ₹${expectedNewBalance}, Actual: ₹${updatedWallet.balance})`
    );

    // Verify Ledger Transaction
    const tx = await DriverWalletTransaction.findOne({
      driverId: testDriverId,
      orderId: ride1._id
    });
    assert(tx !== null, 'Driver wallet transaction was recorded in the database ledger');
    assert(tx?.type === 'credit', 'Ledger transaction type is "credit"');
    assert(tx?.amount === expectedDriverPayout, `Ledger amount matches full ride amount (+₹${expectedDriverPayout})`);
    assert(tx?.description?.includes('GoDelivo Free Ride payout'), 'Ledger description clearly notes GoDelivo Free Ride sponsorship');
    assert(tx?.previousBalance === initialDriverBalance, `Previous balance accurately tracked (₹${initialDriverBalance})`);
    assert(tx?.newBalance === expectedNewBalance, `New balance accurately tracked (₹${expectedNewBalance})`);

    // Verify Ride document state
    const completedRideDoc = await Ride.findOne({ rideId: 'RID_TEST_FREE_1' });
    assert(completedRideDoc.status === 'completed', 'Ride status is marked "completed"');
    assert(completedRideDoc.fare.commissionAmount === 0, 'Driver commission charged is ₹0 (100% sponsored by GoDelivo)');
    assert(completedRideDoc.fare.driverEarning === expectedDriverPayout, `Driver earning equals full payout amount (₹${expectedDriverPayout})`);

    console.log('\n--- TEST GROUP 5: Cancellation Re-enables Free Ride ---');
    // If the customer cancelled their free ride, they should be able to book again
    await Ride.updateOne({ rideId: 'RID_TEST_FREE_1' }, { status: 'cancelled' });
    const checkAfterCancellation = await checkDailyFreeRideEligibility(testCustomerId, 'bike', 1.8);
    assert(checkAfterCancellation.eligible === true, 'Customer is eligible again after previous ride was cancelled');

    // Clean up test records
    await Customer.deleteOne({ _id: testCustomerId });
    await Driver.deleteOne({ _id: testDriverId });
    await DriverWallet.deleteOne({ driverId: testDriverId });
    await DriverWalletTransaction.deleteMany({ driverId: testDriverId });
    await Ride.deleteMany({ 'customer.customerId': testCustomerId });
    console.log('\n[Cleanup] Test documents cleaned up.');

  } catch (error) {
    console.error('Test execution error:', error);
    failedTests++;
  } finally {
    await mongoose.disconnect();
    console.log('\n====================================================');
    console.log(`Test Results: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('====================================================');
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

runTestSuite();
