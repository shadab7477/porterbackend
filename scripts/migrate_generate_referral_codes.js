import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';
import DriverWallet from '../models/DriverWallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/porter';

async function migrate() {
  console.log('🔄 Connecting to MongoDB database...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected successfully.\n');

  // 1. Collect all already used referral codes in memory
  const allDrivers = await Driver.find({});
  const allApplications = await DriverApplication.find({});
  const allWallets = await DriverWallet.find({});

  console.log(`📊 Current Database Stats:`);
  console.log(`   - Total Drivers: ${allDrivers.length}`);
  console.log(`   - Total Applications: ${allApplications.length}`);
  console.log(`   - Total Wallets: ${allWallets.length}\n`);

  const usedCodes = new Set();
  allDrivers.forEach(d => {
    if (d.referralCode && d.referralCode.trim().length === 4) {
      usedCodes.add(d.referralCode.trim());
    }
  });
  allApplications.forEach(a => {
    if (a.referralCode && a.referralCode.trim().length === 4) {
      usedCodes.add(a.referralCode.trim());
    }
  });

  console.log(`Existing valid 4-digit referral codes found: ${usedCodes.size}`);

  const generateCode = () => {
    let code = '';
    let attempts = 0;
    while (attempts < 10000) {
      attempts++;
      code = Math.floor(1000 + Math.random() * 9000).toString();
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
    throw new Error('Exhausted 4-digit code pool!');
  };

  let driversUpdated = 0;
  let applicationsUpdated = 0;
  let walletsUpdated = 0;

  // 2. Link Drivers & Applications by Phone or applicationId to ensure same code
  console.log('🔄 Processing Drivers & Driver Applications...');

  // Group applications by phone for quick lookup
  const appByPhone = new Map();
  allApplications.forEach(app => {
    if (app.phone) appByPhone.set(app.phone, app);
  });

  // Process all Drivers first
  for (const driver of allDrivers) {
    let code = driver.referralCode?.trim();
    const app = appByPhone.get(driver.phone) || (driver.applicationId ? await DriverApplication.findById(driver.applicationId) : null);

    if (!code || code.length !== 4) {
      if (app && app.referralCode && app.referralCode.trim().length === 4) {
        code = app.referralCode.trim();
        usedCodes.add(code);
      } else {
        code = generateCode();
      }

      driver.referralCode = code;
      if (driver.referralCount === undefined || driver.referralCount === null) driver.referralCount = 0;
      if (driver.referralEarnings === undefined || driver.referralEarnings === null) driver.referralEarnings = 0;
      await driver.save();
      driversUpdated++;
      console.log(`  [Driver] ${driver.name || 'Captain'} (${driver.phone}) -> Assigned Code: ${code}`);
    }

    // Keep associated application in sync with identical code
    if (app && (!app.referralCode || app.referralCode.trim() !== code)) {
      app.referralCode = code;
      if (app.referralCount === undefined || app.referralCount === null) app.referralCount = 0;
      if (app.referralEarnings === undefined || app.referralEarnings === null) app.referralEarnings = 0;
      await app.save();
      applicationsUpdated++;
      console.log(`  [Application] ${app.fullName || 'Applicant'} (${app.phone}) -> Synced Code with Driver: ${code}`);
    }

    // Ensure DriverWallet has commissionCredit initialized
    let wallet = await DriverWallet.findOne({ driverId: driver._id });
    if (!wallet) {
      wallet = await DriverWallet.create({
        driverId: driver._id,
        balance: 0,
        commissionCredit: 0
      });
      walletsUpdated++;
    } else if (wallet.commissionCredit === undefined || wallet.commissionCredit === null) {
      wallet.commissionCredit = 0;
      await wallet.save();
      walletsUpdated++;
    }
  }

  // 3. Process any remaining applications that don't have a Driver record yet
  for (const app of allApplications) {
    if (!app.referralCode || app.referralCode.trim().length !== 4) {
      const code = generateCode();
      app.referralCode = code;
      if (app.referralCount === undefined || app.referralCount === null) app.referralCount = 0;
      if (app.referralEarnings === undefined || app.referralEarnings === null) app.referralEarnings = 0;
      await app.save();
      applicationsUpdated++;
      console.log(`  [Application Only] ${app.fullName || 'Applicant'} (${app.phone}) -> Assigned Code: ${code}`);
    }
  }

  // 4. Initialize any remaining wallets
  for (const w of allWallets) {
    if (w.commissionCredit === undefined || w.commissionCredit === null) {
      w.commissionCredit = 0;
      await w.save();
      walletsUpdated++;
    }
  }

  console.log('\n=============================================');
  console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
  console.log(`   - Drivers Updated with 4-Digit Code:      ${driversUpdated}`);
  console.log(`   - Applications Updated with 4-Digit Code: ${applicationsUpdated}`);
  console.log(`   - Wallets Initialized (commissionCredit): ${walletsUpdated}`);
  console.log('=============================================\n');

  // Verification step: Check for duplicates or missing codes
  console.log('🔍 Running Verification Audit...');
  const verifyDrivers = await Driver.find({});
  const verifyApps = await DriverApplication.find({});

  const missingDriverCodes = verifyDrivers.filter(d => !d.referralCode || d.referralCode.length !== 4);
  const missingAppCodes = verifyApps.filter(a => !a.referralCode || a.referralCode.length !== 4);

  if (missingDriverCodes.length > 0) {
    console.warn(`⚠️ Warning: ${missingDriverCodes.length} drivers still missing referral codes!`);
  } else {
    console.log(`✅ All ${verifyDrivers.length} Drivers have valid 4-digit referral codes.`);
  }

  if (missingAppCodes.length > 0) {
    console.warn(`⚠️ Warning: ${missingAppCodes.length} applications still missing referral codes!`);
  } else {
    console.log(`✅ All ${verifyApps.length} Applications have valid 4-digit referral codes.`);
  }

  // Check code uniqueness across drivers
  const driverCodes = verifyDrivers.map(d => d.referralCode);
  const uniqueDriverCodes = new Set(driverCodes);
  if (driverCodes.length === uniqueDriverCodes.size) {
    console.log(`✅ All ${driverCodes.length} Driver codes are strictly UNIQUE.`);
  } else {
    console.warn(`⚠️ Warning: Found ${driverCodes.length - uniqueDriverCodes.size} duplicate codes across drivers.`);
  }

  // Print 5 sample driver records
  console.log('\n📋 Sample Driver Referral Codes:');
  verifyDrivers.slice(0, 5).forEach((d, idx) => {
    console.log(`   ${idx + 1}. Name: "${d.name}", Phone: ${d.phone}, Referral Code: [ ${d.referralCode} ], DriverId: ${d.driverId}`);
  });

  await mongoose.disconnect();
  console.log('\n👋 Database connection closed.');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

