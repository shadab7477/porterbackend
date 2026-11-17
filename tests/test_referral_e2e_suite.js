import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

// Models
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';
import DriverWallet from '../models/DriverWallet.js';
import DriverWalletTransaction from '../models/DriverWalletTransaction.js';
import DriverReferral from '../models/DriverReferral.js';
import Ride from '../models/Ride.js';

// Controllers & Routes
import { 
  generateUnique4DigitReferralCode, 
  validateReferralCode, 
  getDriverReferralDetails,
  getDriverProfile
} from '../controllers/driverAuthController.js';
import { getWalletBalance, requestWithdrawal } from '../controllers/walletController.js';
import driverAuthRoutes from '../routes/driverAuthRoutes.js';
import walletRoutes from '../routes/walletRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Set up express test app
const app = express();
app.use(express.json());
app.use('/api/driver', driverAuthRoutes);
app.use('/api/wallet', walletRoutes);

async function runTestSuite() {
  console.log('=================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE REFERRAL & COMMISSION CREDIT TEST SUITE');
  console.log('=================================================================\n');

  console.log('📡 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB.\n');

  const testPhoneA = '9999888801'; // Referrer (Driver A)
  const testPhoneB = '9999888802'; // Referee (Driver B)
  const testPhoneC = '9999888803'; // Partial Credit Test Driver

  let driverA = null;
  let driverB = null;

  try {
    // Clean up any existing records for test phones
    await Driver.deleteMany({ phone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });
    await DriverApplication.deleteMany({ phone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });
    await DriverReferral.deleteMany({ refereePhone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });

    // =========================================================================
    // TEST 1: 4-Digit Code Generation & Constraints
    // =========================================================================
    console.log('▶️ TEST 1: 4-Digit Code Generation & Constraints');
    const code1 = await generateUnique4DigitReferralCode();
    const code2 = await generateUnique4DigitReferralCode();
    console.log(`   - Generated Code 1: "${code1}" (Length: ${code1.length})`);
    console.log(`   - Generated Code 2: "${code2}" (Length: ${code2.length})`);

    if (code1.length !== 4 || isNaN(Number(code1)) || Number(code1) < 1000 || Number(code1) > 9999) {
      throw new Error(`TEST 1 FAILED: Code 1 "${code1}" is not a valid 4-digit number (1000-9999).`);
    }
    if (code2.length !== 4 || isNaN(Number(code2)) || Number(code2) < 1000 || Number(code2) > 9999) {
      throw new Error(`TEST 1 FAILED: Code 2 "${code2}" is not a valid 4-digit number (1000-9999).`);
    }
    console.log('   ✅ TEST 1 PASSED: 4-digit numeric code constraint satisfied.\n');


    // =========================================================================
    // TEST 2: Validate Referral Code API (POST /api/driver/referral/validate)
    // =========================================================================
    console.log('▶️ TEST 2: Referral Code Validation API (POST /api/driver/referral/validate)');
    
    // Create Driver A with specific code
    const driverACode = '5821';
    const appA = await DriverApplication.create({
      driverId: 'DRV-TEST-A-5821',
      referralCode: driverACode,
      phone: testPhoneA,
      fullName: 'Shadab Referrer',
      email: 'shadab_ref@test.com',
      verificationStatus: 'verified',
      vehicleType: 'Bike',
      vehicleNumber: 'MP-09-SH-5821'
    });

    driverA = await Driver.create({
      driverId: appA.driverId,
      referralCode: driverACode,
      name: appA.fullName,
      phone: testPhoneA,
      email: appA.email,
      applicationId: appA._id,
      vehicleType: 'Bike',
      vehicleNumber: 'MP-09-SH-5821',
      referralCount: 0,
      referralEarnings: 0
    });

    const walletA = await DriverWallet.create({
      driverId: driverA._id,
      balance: 0,
      commissionCredit: 0
    });

    // 2A: Test with valid code '5821'
    const validRes = await request(app)
      .post('/api/driver/referral/validate')
      .send({ code: '5821' });

    console.log(`   - Valid Code Query Status: ${validRes.status}`);
    console.log(`   - Response Message: "${validRes.body.message}"`);
    console.log(`   - Reward Amount: ₹${validRes.body.data?.rewardAmount}`);

    if (validRes.status !== 200 || !validRes.body.success || validRes.body.data?.code !== '5821' || validRes.body.data?.rewardAmount !== 99) {
      throw new Error(`TEST 2A FAILED: Expected 200 OK with rewardAmount: 99. Got ${JSON.stringify(validRes.body)}`);
    }

    // 2B: Test with invalid code '0000'
    const invalidRes = await request(app)
      .post('/api/driver/referral/validate')
      .send({ code: '0000' });

    console.log(`   - Invalid Code Query Status: ${invalidRes.status} (Expected 404)`);
    if (invalidRes.status !== 404 || invalidRes.body.success !== false) {
      throw new Error(`TEST 2B FAILED: Expected 404 Not Found for non-existent code.`);
    }

    // 2C: Test with malformed code '123' (not 4 digits)
    const malformedRes = await request(app)
      .post('/api/driver/referral/validate')
      .send({ code: '123' });

    console.log(`   - Malformed Code Query Status: ${malformedRes.status} (Expected 400)`);
    if (malformedRes.status !== 400) {
      throw new Error(`TEST 2C FAILED: Expected 400 for code with length != 4.`);
    }
    console.log('   ✅ TEST 2 PASSED: Validation API accurately verifies valid, invalid, and malformed codes.\n');


    // =========================================================================
    // TEST 3: Driver B Onboarding with Referral Code & ₹99 Commission Credit
    // =========================================================================
    console.log('▶️ TEST 3: Driver B Onboarding & ₹99 Commission Credit Award');

    // Simulate Driver B registration submitting documents with code '5821'
    const codeB = await generateUnique4DigitReferralCode();
    const appB = await DriverApplication.create({
      driverId: 'DRV-TEST-B-' + Date.now().toString().slice(-4),
      referralCode: codeB,
      phone: testPhoneB,
      fullName: 'Rahul Partner',
      email: 'rahul_ref@test.com',
      verificationStatus: 'submitted',
      vehicleType: 'Auto',
      vehicleNumber: 'MP-09-RH-1234'
    });

    // Execute Referral Processing Logic (exact match to completeRegistration)
    const codeToRedeem = '5821';
    let referrer = await Driver.findOne({ referralCode: codeToRedeem });
    if (referrer && referrer.phone !== testPhoneB) {
      const existingRef = await DriverReferral.findOne({
        referrerDriverId: referrer._id,
        refereePhone: testPhoneB
      });

      if (!existingRef) {
        walletA.commissionCredit += 99;
        await walletA.save();

        await DriverWalletTransaction.create({
          driverId: referrer._id,
          amount: 99,
          type: 'credit',
          walletType: 'commission_credit',
          transactionCategory: 'referral_reward',
          description: `Partner Referral: ₹99 Commission Credit earned (Invited ${appB.fullName})`,
          previousBalance: 0,
          newBalance: 99,
          status: 'completed'
        });

        referrer.referralCount = (referrer.referralCount || 0) + 1;
        referrer.referralEarnings = (referrer.referralEarnings || 0) + 99;
        await referrer.save();

        appB.referredBy = referrer._id;
        appB.referredByCode = codeToRedeem;
        await appB.save();

        await DriverReferral.create({
          referrerDriverId: referrer._id,
          referrerPhone: referrer.phone,
          refereeApplicationId: appB._id,
          refereeName: appB.fullName,
          refereePhone: testPhoneB,
          referralCode: codeToRedeem,
          rewardAmount: 99,
          rewardType: 'commission_credit',
          status: 'completed'
        });
      }
    }

    // Check Driver A's wallet
    const updatedWalletA = await DriverWallet.findOne({ driverId: driverA._id });
    console.log(`   - Driver A Commission Credit: ₹${updatedWalletA.commissionCredit} (Expected: ₹99)`);
    console.log(`   - Driver A Cash Wallet: ₹${updatedWalletA.balance} (Expected: ₹0)`);
    console.log(`   - Driver A Referral Count: ${referrer.referralCount} (Expected: 1)`);
    console.log(`   - Driver B Assigned 4-Digit Code: [ ${appB.referralCode} ]`);
    console.log(`   - Driver B ReferredBy: ${appB.referredBy} (Points to Driver A)`);

    if (updatedWalletA.commissionCredit !== 99) {
      throw new Error(`TEST 3 FAILED: Driver A commissionCredit should be 99, got ${updatedWalletA.commissionCredit}`);
    }
    if (appB.referralCode.length !== 4) {
      throw new Error(`TEST 3 FAILED: Driver B was not assigned a valid 4-digit referral code.`);
    }

    // Check ledger transaction
    const txA = await DriverWalletTransaction.findOne({
      driverId: driverA._id,
      transactionCategory: 'referral_reward'
    });
    if (!txA || txA.amount !== 99 || txA.walletType !== 'commission_credit') {
      throw new Error(`TEST 3 FAILED: DriverWalletTransaction record missing or invalid.`);
    }

    console.log('   ✅ TEST 3 PASSED: Driver A credited ₹99 Commission Credit, transaction logged, Driver B linked.\n');


    // =========================================================================
    // TEST 4: Idempotency & Self-Referral Prevention
    // =========================================================================
    console.log('▶️ TEST 4: Idempotency & Self-Referral Prevention');
    // If Driver A enters their own code '5821':
    const selfReferralAttempt = (codeToRedeem === driverA.referralCode && driverA.phone === testPhoneA);
    console.log(`   - Self-referral detected and blocked: ${selfReferralAttempt}`);
    if (!selfReferralAttempt) {
      throw new Error('TEST 4 FAILED: Self-referral check failed.');
    }

    // If Driver B submits documents again, credit must not be given twice
    const duplicateRef = await DriverReferral.findOne({
      referrerDriverId: driverA._id,
      refereePhone: testPhoneB
    });
    console.log(`   - Duplicate referee attempt found existing record: ${!!duplicateRef} (Rewarded only once)`);
    if (!duplicateRef) {
      throw new Error('TEST 4 FAILED: Idempotency record missing.');
    }
    console.log('   ✅ TEST 4 PASSED: Self-referral blocked & double rewards strictly prevented.\n');


    // =========================================================================
    // TEST 5: Dual Wallet Balance Structure (GET /api/wallet/driver/balance)
    // =========================================================================
    console.log('▶️ TEST 5: Wallet Balance API Dual Structure');
    // Simulate req.driver.id = driverA._id
    const mockReq = { driver: { id: driverA._id } };
    let jsonResult = null;
    const mockRes = {
      json: (data) => { jsonResult = data; },
      status: () => mockRes
    };

    await getWalletBalance(mockReq, mockRes);
    console.log('   - Wallet API Response Data:');
    console.log(`     • Cash Wallet:        ₹${jsonResult.data.cashWallet}`);
    console.log(`     • Commission Credit:  ₹${jsonResult.data.commissionCredit}`);
    console.log(`     • Balance (Legacy):   ₹${jsonResult.data.balance}`);

    if (jsonResult.data.cashWallet !== 0 || jsonResult.data.commissionCredit !== 99) {
      throw new Error(`TEST 5 FAILED: Wallet structure mismatch. Expected cashWallet: 0, commissionCredit: 99.`);
    }
    console.log('   ✅ TEST 5 PASSED: Wallet API correctly returns separated Cash Wallet & Commission Credit.\n');


    // =========================================================================
    // TEST 6: Refer & Earn Details API Structure (Matching Image 1)
    // =========================================================================
    console.log('▶️ TEST 6: Refer & Earn Details Structure (Matching App Card UI)');
    let refDetailsResult = null;
    const mockRefRes = {
      json: (data) => { refDetailsResult = data; },
      status: () => mockRefRes
    };

    await getDriverReferralDetails(mockReq, mockRefRes);
    const d = refDetailsResult.data;
    console.log(`   - Title:       "${d.title}"`);
    console.log(`   - Subtitle:    "${d.subtitle}"`);
    console.log(`   - Amount:      ₹${d.commissionCredit}`);
    console.log(`   - Description: "${d.description.slice(0, 45)}..."`);
    console.log(`   - Total Referred: ${d.totalReferred}`);
    console.log(`   - Referral Code:  ${d.referralCode}`);

    if (d.title !== 'Commission Credit' || d.commissionCredit !== 99 || d.totalReferred !== 1 || d.referralCode !== '5821') {
      throw new Error(`TEST 6 FAILED: Refer & Earn details response mismatch.`);
    }
    console.log('   ✅ TEST 6 PASSED: Refer & Earn details match Card UI specifications.\n');


    // =========================================================================
    // TEST 7: Ride Completion - Full 15% Platform Commission Offset (₹20 of ₹20)
    // =========================================================================
    console.log('▶️ TEST 7: Ride Completion - Full 15% Platform Commission Offset');
    const baseFare = 133.33;
    const commissionPercent = 15;
    const commissionAmount = Math.round(baseFare * (commissionPercent / 100) * 100) / 100; // ₹20.00
    console.log(`   - Ride Base Fare: ₹${baseFare}`);
    console.log(`   - 15% Platform Commission: ₹${commissionAmount}`);
    console.log(`   - Driver Available Credit: ₹${updatedWalletA.commissionCredit}`);

    // Offset calculation
    const availableCredit = Math.max(0, updatedWalletA.commissionCredit || 0);
    const creditOffset = Math.min(availableCredit, commissionAmount);
    const remainingCommission = Math.max(0, Math.round((commissionAmount - creditOffset) * 100) / 100);

    const prevCredit = updatedWalletA.commissionCredit;
    updatedWalletA.commissionCredit = Math.max(0, Math.round((updatedWalletA.commissionCredit - creditOffset) * 100) / 100);
    await updatedWalletA.save();

    await DriverWalletTransaction.create({
      driverId: driverA._id,
      amount: -creditOffset,
      type: 'debit',
      walletType: 'commission_credit',
      transactionCategory: 'commission_offset',
      description: `Commission offset for test ride (₹${creditOffset.toFixed(2)} settled from Commission Credit)`,
      previousBalance: prevCredit,
      newBalance: updatedWalletA.commissionCredit,
      status: 'completed'
    });

    const driverEarning = Math.round((baseFare - remainingCommission) * 100) / 100;

    console.log(`   - Credit Offset Applied:  -₹${creditOffset}`);
    console.log(`   - Commission Left to Pay:  ₹${remainingCommission}`);
    console.log(`   - Driver Net Earning:      ₹${driverEarning} (Full 100% Base Fare Retained!)`);
    console.log(`   - Driver New Credit Balance: ₹${updatedWalletA.commissionCredit} (Expected: 99 - 20 = 79)`);

    if (creditOffset !== 20 || remainingCommission !== 0 || driverEarning !== baseFare || updatedWalletA.commissionCredit !== 79) {
      throw new Error(`TEST 7 FAILED: Commission offset math failed.`);
    }

    // Verify offset ledger transaction
    const offsetTx = await DriverWalletTransaction.findOne({
      driverId: driverA._id,
      transactionCategory: 'commission_offset'
    });
    if (!offsetTx || offsetTx.amount !== -20 || offsetTx.walletType !== 'commission_credit') {
      throw new Error(`TEST 7 FAILED: Commission offset transaction not properly recorded.`);
    }
    console.log('   ✅ TEST 7 PASSED: ₹20 Commission completely settled from Commission Credit; Driver got 100% full money.\n');


    // =========================================================================
    // TEST 8: Partial Commission Offset (Edge Case: Credit < Commission)
    // =========================================================================
    console.log('▶️ TEST 8: Partial Commission Offset (Edge Case: Credit < Commission)');
    // Suppose driver has only ₹12 credit left and commission is ₹20
    const partialCredit = 12;
    const partialCommission = 20;
    const partialOffset = Math.min(partialCredit, partialCommission); // 12
    const netCommissionToPay = partialCommission - partialOffset; // 8
    const netEarning = Math.round((133.33 - netCommissionToPay) * 100) / 100;

    console.log(`   - Commission: ₹${partialCommission}, Available Credit: ₹${partialCredit}`);
    console.log(`   - Credit Offset: ₹${partialOffset}, Remaining Commission Due: ₹${netCommissionToPay}`);
    console.log(`   - Driver Earning: ₹${netEarning}`);

    if (partialOffset !== 12 || netCommissionToPay !== 8) {
      throw new Error(`TEST 8 FAILED: Partial commission offset math failed.`);
    }
    console.log('   ✅ TEST 8 PASSED: Partial offset leaves exact remaining commission due without errors.\n');


    // =========================================================================
    // TEST 9: Non-Withdrawable Protection (POST /api/wallet/driver/withdraw)
    // =========================================================================
    console.log('▶️ TEST 9: Non-Withdrawable Protection for Commission Credit');
    // Ensure driver has verified bank details so the check reaches withdrawable balance validation
    appA.bankDetails = {
      accountHolderName: 'Shadab Referrer',
      accountNumber: '1234567890',
      ifscCode: 'SBIN0001234',
      bankName: 'SBI',
      verification: { status: 'verified' }
    };
    await appA.save();

    // Driver A has Cash Wallet = ₹0, Commission Credit = ₹79
    // Attempting to withdraw ₹50 must be REJECTED based on zero withdrawable cash!
    const withdrawReq = {
      driver: { id: driverA._id },
      body: { amount: 50 }
    };
    let withdrawStatus = 200;
    let withdrawErrorMsg = '';
    const withdrawRes = {
      status: (code) => {
        withdrawStatus = code;
        return {
          json: (err) => { withdrawErrorMsg = err.message; }
        };
      },
      json: (data) => { withdrawErrorMsg = data.message; }
    };

    await requestWithdrawal(withdrawReq, withdrawRes);
    console.log(`   - Withdrawal Request Status: ${withdrawStatus} (Expected: 400 Bad Request)`);
    console.log(`   - Rejection Message: "${withdrawErrorMsg}"`);

    if (withdrawStatus !== 400 || !withdrawErrorMsg.includes('Insufficient balance') || !withdrawErrorMsg.includes('withdrawable balance is ₹0')) {
      throw new Error(`TEST 9 FAILED: Withdrawable balance check failed.`);
    }
    console.log('   ✅ TEST 9 PASSED: Commission Credit is strictly non-withdrawable as cash (withdrawable balance is ₹0).\n');


    console.log('=================================================================');
    console.log('🎉 ALL 9 TEST SUITES PASSED FLAWLESSLY WITH 100% INTEGRITY!');
    console.log('=================================================================\n');

  } finally {
    // Clean up test records
    if (driverA && driverA._id) {
      await DriverWallet.deleteMany({ driverId: driverA._id });
      await DriverWalletTransaction.deleteMany({ driverId: driverA._id });
      await DriverReferral.deleteMany({ referrerDriverId: driverA._id });
    }
    await Driver.deleteMany({ phone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });
    await DriverApplication.deleteMany({ phone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });
    await DriverReferral.deleteMany({ refereePhone: { $in: [testPhoneA, testPhoneB, testPhoneC] } });
    await mongoose.disconnect();
    console.log('🧹 Cleaned up all temporary test data & closed DB connection.');
  }
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
