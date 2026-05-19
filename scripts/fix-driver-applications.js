import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import DriverApplication from '../models/DriverApplication.js';
import Driver from '../models/Driver.js';

dotenv.config();

const fixVerifiedDriverApplications = async () => {
  await connectDB();

  const applications = await DriverApplication.find({});
  console.log(`Found ${applications.length} driver application(s).`);

  let createdDrivers = 0;
  let updatedDrivers = 0;
  let fixedApplications = 0;
  let fixedStatuses = 0;
  let verifiedApplications = 0;

  for (const application of applications) {
    const phone = application.phone;
    const overallStatus = application.calculateOverallStatus?.();
    let applicationUpdated = false;

    if (overallStatus && overallStatus !== application.verificationStatus) {
      const previousStatus = application.verificationStatus;
      application.verificationStatus = overallStatus;
      if (overallStatus === 'verified' && !application.reviewedAt) {
        application.reviewedAt = new Date();
      }
      if (!application.submittedAt) {
        application.submittedAt = application.createdAt || new Date();
      }
      fixedStatuses += 1;
      applicationUpdated = true;
      console.log(`Fixed status for application phone=${phone} from ${previousStatus} to ${overallStatus}`);
    }

    if (application.verificationStatus === 'verified') {
      verifiedApplications += 1;
      const driver = await Driver.findOne({ phone });
      const driverData = {
        driverId: application.driverId,
        name: application.fullName,
        phone: application.phone,
        email: application.email,
        applicationId: application._id,
        vehicleType: application.vehicleType,
        vehicleNumber: application.vehicleNumber,
        isOnline: false,
        lastActive: new Date()
      };

      if (!driver) {
        await Driver.create(driverData);
        createdDrivers += 1;
        console.log(`Created driver record for verified application phone=${phone}`);
      } else {
        let needsSave = false;

        if (!driver.applicationId || driver.applicationId.toString() !== application._id.toString()) {
          driver.applicationId = application._id;
          needsSave = true;
        }
        if (driver.driverId !== driverData.driverId) {
          driver.driverId = driverData.driverId;
          needsSave = true;
        }
        if (driver.name !== driverData.name) {
          driver.name = driverData.name;
          needsSave = true;
        }
        if (driver.email !== driverData.email) {
          driver.email = driverData.email;
          needsSave = true;
        }
        if (driver.vehicleType !== driverData.vehicleType) {
          driver.vehicleType = driverData.vehicleType;
          needsSave = true;
        }
        if (driver.vehicleNumber !== driverData.vehicleNumber) {
          driver.vehicleNumber = driverData.vehicleNumber;
          needsSave = true;
        }
        if (needsSave) {
          await driver.save();
          updatedDrivers += 1;
          console.log(`Updated driver record for verified application phone=${phone}`);
        }
      }
    }

    if (!application.submittedAt) {
      application.submittedAt = application.createdAt || new Date();
      applicationUpdated = true;
    }
    if (application.verificationStatus === 'verified' && !application.reviewedAt) {
      application.reviewedAt = new Date();
      applicationUpdated = true;
    }

    if (applicationUpdated) {
      await application.save();
      fixedApplications += 1;
    }
  }

  console.log('--- Migration complete ---');
  console.log(`Driver applications processed: ${applications.length}`);
  console.log(`Verified applications: ${verifiedApplications}`);
  console.log(`Driver records created: ${createdDrivers}`);
  console.log(`Driver records updated: ${updatedDrivers}`);
  console.log(`Application records updated: ${fixedApplications}`);
  console.log(`Application statuses fixed: ${fixedStatuses}`);
};

fixVerifiedDriverApplications()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
