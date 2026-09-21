import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import DriverApplication from '../models/DriverApplication.js';
import Driver from '../models/Driver.js';

dotenv.config();

const phone = process.argv[2] || '6263352496';

const run = async () => {
  await connectDB();
  const app = await DriverApplication.findOne({ phone });
  if (!app) {
    console.log('Application not found for', phone);
    process.exit(0);
  }

  console.log('Current verificationStatus:', app.verificationStatus);

  app.verificationStatus = 'verified';
  if (!app.submittedAt) app.submittedAt = app.createdAt || new Date();
  if (!app.reviewedAt) app.reviewedAt = new Date();
  await app.save();

  let driver = await Driver.findOne({ phone });
  if (!driver) {
    driver = await Driver.create({
      driverId: app.driverId || ('DRV' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000)),
      name: app.fullName || '',
      phone: app.phone,
      email: app.email || '',
      applicationId: app._id,
      vehicleType: app.vehicleType || '',
      vehicleNumber: app.vehicleNumber || '',
      isOnline: false,
      lastActive: new Date()
    });
    console.log('Created driver:', driver._id.toString());
  } else {
    console.log('Driver already exists:', driver._id.toString());
    // Ensure applicationId is set
    let changed = false;
    if (!driver.applicationId || driver.applicationId.toString() !== app._id.toString()) {
      driver.applicationId = app._id;
      changed = true;
    }
    if (changed) {
      await driver.save();
      console.log('Updated driver with applicationId');
    }
  }

  const refreshedApp = await DriverApplication.findOne({ phone });
  console.log('After update verificationStatus:', refreshedApp.verificationStatus, 'reviewedAt:', refreshedApp.reviewedAt);
  process.exit(0);
};

run().catch(err => { console.error(err); process.exit(1); });
