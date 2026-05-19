import jwt from 'jsonwebtoken';
import DriverApplication from '../models/DriverApplication.js';
import Driver from '../models/Driver.js';
import OTP from '../models/OTP.js';
import { uploadToCloudinary } from '../config/cloudinary.js';
import { generateOTP, sendSmsOtp } from '../utils/smsService.js';

// Generate driver auth token (long-lived token for authenticated drivers)
const generateDriverToken = (driverId, phone, isVerified = false) => {
  return jwt.sign(
    { 
      id: driverId,
      phone, 
      type: 'driver_auth',
      role: 'driver',
      isVerified
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// Verify driver token
const verifyDriverToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'driver_auth') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw error;
  }
};

// File validation helper
const validateFile = (file) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024;
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return {
      valid: false,
      message: 'Invalid file type. Only JPEG, PNG and WEBP files are allowed.'
    };
  }
  
  if (file.size > maxSize) {
    return {
      valid: false,
      message: 'File too large. Maximum size is 5MB.'
    };
  }
  
  return { valid: true };
};

// Helper to check driver verification status
const checkDriverVerification = async (driverId) => {
  const driver = await Driver.findById(driverId).populate('applicationId');
  if (!driver) {
    throw new Error('Driver not found');
  }
  console.log(driver);
  
  const application = driver.applicationId;
  if (!application || application.verificationStatus !== 'verified') {
    throw new Error('Driver not verified. Please complete registration and wait for verification.');
  }
  
  return { driver, application };
};

// ==================== PUBLIC ROUTES ====================

// Send OTP
export const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please provide 10 digit mobile number.'
      });
    }

    await OTP.deleteMany({ mobile: phone });

    const otp = generateOTP();
    const otpRecord = new OTP({
      mobile: phone,
      otp: otp
    });
    await otpRecord.save();

    await sendSmsOtp(phone, otp);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phone,
        otp: process.env.NODE_ENV === 'development' ? otp : undefined
      }
    });
  } catch (error) {
    console.error('Error in sendOTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
};

// Verify OTP and generate token
// Verify OTP and generate token
export const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    const otpRecord = await OTP.findOne({ mobile: phone });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired. Please request a new OTP.'
      });
    }

    if (otpRecord.attempts >= 3) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${3 - otpRecord.attempts} attempts remaining.`
      });
    }

    // Mark as verified
    otpRecord.isVerified = true;
    await otpRecord.save();

    // Check if driver has an application
    const existingApplication = await DriverApplication.findOne({ phone });
    let driverToken = null;
    let isExistingDriver = false;
    let isVerified = false;
    let requiresRegistration = false;
    let applicationStatus = null;
    let statusMessage = '';
    let driverId = null;

    if (existingApplication) {
      applicationStatus = existingApplication.verificationStatus;
      isExistingDriver = true;
      
      // Handle different application statuses
      switch(applicationStatus) {
        case 'verified':
          // Driver is fully verified and approved
          isVerified = true;
          requiresRegistration = false;
          statusMessage = 'Driver verified. Login successful.';
          
          // Get or create driver entry
          let driver = await Driver.findOne({ phone });
          if (!driver) {
            driver = new Driver({
              driverId: existingApplication.driverId,
              name: existingApplication.fullName,
              phone: existingApplication.phone,
              email: existingApplication.email,
              applicationId: existingApplication._id,
              vehicleType: existingApplication.vehicleType,
              vehicleNumber: existingApplication.vehicleNumber,
              isOnline: false,
              lastActive: new Date()
            });
            await driver.save();
          }
          
          driverId = driver._id;
          driverToken = generateDriverToken(driver._id, phone, true);
          break;
          
        case 'submitted':
        case 'under_review':
          // Application is pending review
          isVerified = false;
          requiresRegistration = false; // No need to register again
          statusMessage = 'Your application is under review. Please wait for verification.';
          
          // Generate token for checking status (short-lived)
          driverToken = jwt.sign(
            { 
              phone, 
              type: 'driver_auth',
              role: 'driver',
              isVerified: false,
              requiresRegistration: false,
              applicationStatus: applicationStatus
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );
          break;
          
        case 'rejected':
          // Application was rejected
          isVerified = false;
          requiresRegistration = true; // Can register again
          statusMessage = `Your application was rejected. Reason: ${existingApplication.rejectionReason || 'Not specified'}. Please submit a new application.`;
          
          // Generate registration token
          driverToken = jwt.sign(
            { 
              phone, 
              type: 'driver_auth',
              role: 'driver',
              isVerified: false,
              requiresRegistration: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );
          break;
          
        case 'partially_verified':
          // Some documents verified, some pending
          isVerified = false;
          requiresRegistration = false;
          statusMessage = 'Your application is partially verified. Some documents are still pending review.';
          
          // Generate token for checking status
          driverToken = jwt.sign(
            { 
              phone, 
              type: 'driver_auth',
              role: 'driver',
              isVerified: false,
              requiresRegistration: false,
              applicationStatus: applicationStatus
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );
          break;
          
        default:
          // Default case - treat as new registration
          isVerified = false;
          requiresRegistration = true;
          statusMessage = 'No application found. Please complete registration.';
          
          driverToken = jwt.sign(
            { 
              phone, 
              type: 'driver_auth',
              role: 'driver',
              isVerified: false,
              requiresRegistration: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );
      }
    } else {
      // No application exists - new driver
      isExistingDriver = false;
      isVerified = false;
      requiresRegistration = true;
      applicationStatus = null;
      statusMessage = 'New driver. Please complete registration.';
      
      // Generate registration token
      driverToken = jwt.sign(
        { 
          phone, 
          type: 'driver_auth',
          role: 'driver',
          isVerified: false,
          requiresRegistration: true
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
    }

    // Delete OTP after successful verification
    await OTP.deleteOne({ _id: otpRecord._id });

    // Prepare response data
    const responseData = {
      token: driverToken,
      phone,
      isExistingDriver,
      isVerified,
      requiresRegistration,
      applicationStatus,
      statusMessage
    };

    // Add driverId only if it exists
    if (driverId) {
      responseData.driverId = driverId;
    }

    // Add document status if available and application exists
    if (existingApplication && applicationStatus !== 'verified') {
      const documentStatus = {
        profilePhoto: existingApplication.profilePhoto?.verification?.status || 'not_uploaded',
        aadharFront: existingApplication.aadharCard?.front?.verification?.status || 'not_uploaded',
        aadharBack: existingApplication.aadharCard?.back?.verification?.status || 'not_uploaded',
        panCard: existingApplication.panCard?.verification?.status || 'not_uploaded',
        drivingLicense: existingApplication.drivingLicense?.verification?.status || 'not_uploaded',
        vehicleRC: existingApplication.vehicleRC?.verification?.status || 'not_uploaded',
        vehiclePhoto: existingApplication.vehiclePhoto?.verification?.status || 'not_uploaded',
        bankDetails: existingApplication.bankDetails?.verification?.status || 'not_provided'
      };
      responseData.documentStatus = documentStatus;
    }

    res.status(200).json({
      success: true,
      message: statusMessage,
      data: responseData
    });
    
  } catch (error) {
    console.error('Error in verifyOTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
};

// Driver Login (explicit login for verified drivers)
export const driverLogin = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const application = await DriverApplication.findOne({ 
      phone,
      verificationStatus: 'verified'
    });

    if (!application) {
      return res.status(401).json({
        success: false,
        message: 'No approved driver found with this phone number. Please complete registration and wait for verification.'
      });
    }

    let driver = await Driver.findOne({ phone }).populate('applicationId');

    if (!driver) {
      driver = new Driver({
        driverId: application.driverId,
        name: application.fullName,
        phone: application.phone,
        email: application.email,
        applicationId: application._id,
        vehicleType: application.vehicleType,
        vehicleNumber: application.vehicleNumber,
        isOnline: false,
        lastActive: new Date()
      });
      await driver.save();
    } else {
      driver.lastActive = new Date();
      await driver.save();
    }

    const driverToken = generateDriverToken(driver._id, phone, true);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token: driverToken,
        driver: {
          id: driver._id,
          driverId: driver.driverId,
          name: driver.name,
          phone: driver.phone,
          email: driver.email,
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          rating: driver.rating,
          totalTrips: driver.totalTrips,
          totalEarnings: driver.totalEarnings,
          walletBalance: driver.walletBalance,
          applicationStatus: application.verificationStatus
        }
      }
    });

  } catch (error) {
    console.error('Error in driverLogin:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Driver Logout
export const driverLogout = async (req, res) => {
  try {
    const driverId = req.driver.id;

    await Driver.findByIdAndUpdate(driverId, {
      isOnline: false,
      lastActive: new Date(),
      socketId: null,
      fcmToken: null
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Error in driverLogout:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// Refresh Token
export const refreshToken = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const phone = req.driver.phone;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const application = await DriverApplication.findOne({ phone: driver.phone });
    const isVerified = application?.verificationStatus === 'verified';

    const newToken = generateDriverToken(driverId, phone, isVerified);

    res.status(200).json({
      success: true,
      data: {
        token: newToken
      }
    });
  } catch (error) {
    console.error('Error in refreshToken:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
};

// ==================== REGISTRATION ROUTES ====================

// Complete Registration
export const completeRegistration = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.split(' ')[1];
    let responseToken = token;
    
    try {
      const decoded = verifyDriverToken(token);
      const phone = decoded.phone;
      
      if (decoded.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'Driver is already verified. Cannot register again.'
        });
      }
      
      const {
        fullName,
        email,
        dateOfBirth,
        address,
        vehicleType,
        vehicleNumber,
        vehicleModel,
        vehicleYear,
        vehicleColor,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        branchName,
        aadharNumber,
        licenseNumber,
        rcNumber,
        licenseExpiryDate,
        // Hired driver fields
        hasHiredDriver,
        hiredDriverName,
        hiredDriverPhone,
      } = req.body;

      // Validation
      if (!fullName) {
        return res.status(400).json({
          success: false,
          message: 'Full name is required'
        });
      }

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      if (!dateOfBirth) {
        return res.status(400).json({
          success: false,
          message: 'Date of birth is required'
        });
      }

      let parsedAddress = {};
      try {
        parsedAddress = JSON.parse(address);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid address format'
        });
      }

      const requiredFiles = [
        'profilePhoto', 
        'aadharFront',
        'aadharBack',
        'panCard', 
        'drivingLicense', 
        'vehicleRC', 
        'vehiclePhoto'
      ];
      
      const uploadedFiles = req.files || {};
      const missingFiles = requiredFiles.filter(file => !uploadedFiles[file] || uploadedFiles[file].length === 0);

      if (missingFiles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required documents: ${missingFiles.join(', ')}`
        });
      }

      let application = await DriverApplication.findOne({ phone });

      if (application) {
        application.fullName = fullName;
        application.email = email;
        application.dateOfBirth = new Date(dateOfBirth);
        application.address = parsedAddress;
        application.vehicleType = vehicleType;
        application.vehicleNumber = vehicleNumber?.toUpperCase();
        application.vehicleModel = vehicleModel;
        application.vehicleYear = vehicleYear ? parseInt(vehicleYear) : undefined;
        application.vehicleColor = vehicleColor;
        
        if (accountHolderName && accountNumber && ifscCode && bankName) {
          application.bankDetails = {
            accountHolderName,
            accountNumber,
            ifscCode: ifscCode?.toUpperCase(),
            bankName,
            branchName: branchName || '',
            verification: { status: 'pending' }
          };
        }
      } else {
        const driverId = 'DRV' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
        
        application = new DriverApplication({
          driverId,
          phone,
          fullName,
          email,
          dateOfBirth: new Date(dateOfBirth),
          address: parsedAddress,
          vehicleType,
          vehicleNumber: vehicleNumber?.toUpperCase(),
          vehicleModel,
          vehicleYear: vehicleYear ? parseInt(vehicleYear) : undefined,
          vehicleColor,
          bankDetails: accountHolderName && accountNumber && ifscCode && bankName ? {
            accountHolderName,
            accountNumber,
            ifscCode: ifscCode?.toUpperCase(),
            bankName,
            branchName: branchName || '',
            verification: { status: 'pending' }
          } : undefined
        });
      }

      const folder = `driver-documents/${phone}`;
      
      const uploadFile = async (fileArray, docType) => {
        if (!fileArray || fileArray.length === 0) return null;
        
        const file = fileArray[0];
        const validation = validateFile(file);
        if (!validation.valid) {
          throw new Error(`${docType}: ${validation.message}`);
        }

        const result = await uploadToCloudinary(file.buffer, folder);
        
        return {
          url: result.url,
          publicId: result.publicId,
          uploadedAt: new Date(),
          verification: { status: 'pending' }
        };
      };

      try {
        if (req.files.profilePhoto) {
          application.profilePhoto = await uploadFile(req.files.profilePhoto, 'profilePhoto');
        }
        
        if (req.files.aadharFront) {
          const aadharFrontDoc = await uploadFile(req.files.aadharFront, 'aadharFront');
          if (!application.aadharCard) {
            application.aadharCard = {};
          }
          application.aadharCard.front = aadharFrontDoc;
        }
        
        if (req.files.aadharBack) {
          const aadharBackDoc = await uploadFile(req.files.aadharBack, 'aadharBack');
          if (!application.aadharCard) {
            application.aadharCard = {};
          }
          application.aadharCard.back = aadharBackDoc;
        }
        
        if (aadharNumber && application.aadharCard) {
          application.aadharCard.aadharNumber = aadharNumber;
        }
        
        if (req.files.panCard) {
          application.panCard = await uploadFile(req.files.panCard, 'panCard');
        }
        
        if (req.files.drivingLicense) {
          const licenseDoc = await uploadFile(req.files.drivingLicense, 'drivingLicense');
          application.drivingLicense = {
            ...licenseDoc,
            licenseNumber: licenseNumber || '',
            expiryDate: licenseExpiryDate ? new Date(licenseExpiryDate) : undefined
          };
        }
        
        if (req.files.vehicleRC) {
          const rcDoc = await uploadFile(req.files.vehicleRC, 'vehicleRC');
          application.vehicleRC = {
            ...rcDoc,
            rcNumber: rcNumber || ''
          };
        }
        
        if (req.files.vehiclePhoto) {
          application.vehiclePhoto = await uploadFile(req.files.vehiclePhoto, 'vehiclePhoto');
        }

        // ── Hired Driver ────────────────────────────────────────────────
        const wantsHiredDriver = hasHiredDriver === 'true' || hasHiredDriver === true;
        if (wantsHiredDriver) {
          // Validate: name + phone required if hired driver is declared
          if (!hiredDriverName || !hiredDriverPhone) {
            return res.status(400).json({
              success: false,
              message: 'Hired driver name and phone number are required when hasHiredDriver is true'
            });
          }
          if (!/^\d{10}$/.test(hiredDriverPhone)) {
            return res.status(400).json({
              success: false,
              message: 'Hired driver phone must be a valid 10-digit number'
            });
          }

          let hiredLicenseDoc = null;
          if (req.files.hiredDriverLicense) {
            hiredLicenseDoc = await uploadFile(req.files.hiredDriverLicense, 'hiredDriverLicense');
          }

          application.hiredDriver = {
            hasHiredDriver: true,
            name: hiredDriverName.trim(),
            phone: hiredDriverPhone.trim(),
            licenseImage: hiredLicenseDoc
              ? {
                  url: hiredLicenseDoc.url,
                  publicId: hiredLicenseDoc.publicId,
                  uploadedAt: hiredLicenseDoc.uploadedAt,
                  verification: { status: 'pending' },
                }
              : { url: null, publicId: null, uploadedAt: null, verification: { status: 'pending' } },
          };
        } else {
          application.hiredDriver = {
            hasHiredDriver: false,
            name: null,
            phone: null,
            licenseImage: { url: null, publicId: null, uploadedAt: null },
          };
        }
      } catch (uploadError) {
        return res.status(400).json({
          success: false,
          message: uploadError.message
        });
      }

      const applicationStatus = application.calculateOverallStatus?.();
      if (applicationStatus === 'verified') {
        application.verificationStatus = 'verified';
        application.reviewedAt = new Date();
      } else if (['under_review', 'partially_verified'].includes(applicationStatus)) {
        application.verificationStatus = applicationStatus;
      } else {
        application.verificationStatus = 'submitted';
      }

      if (!application.submittedAt) {
        application.submittedAt = new Date();
      }

      await application.save();

      if (application.verificationStatus === 'verified') {
        let verifiedDriver = await Driver.findOne({ phone }).populate('applicationId');
        if (!verifiedDriver) {
          verifiedDriver = new Driver({
            driverId: application.driverId,
            name: application.fullName,
            phone: application.phone,
            email: application.email,
            applicationId: application._id,
            vehicleType: application.vehicleType,
            vehicleNumber: application.vehicleNumber,
            isOnline: false,
            lastActive: new Date()
          });
          await verifiedDriver.save();
        } else {
          verifiedDriver.lastActive = new Date();
          await verifiedDriver.save();
        }

        responseToken = generateDriverToken(verifiedDriver._id, phone, true);
      }

      const documentStatus = {
        profilePhoto: application.profilePhoto?.verification?.status || 'pending',
        aadharFront: application.aadharCard?.front?.verification?.status || 'pending',
        aadharBack: application.aadharCard?.back?.verification?.status || 'pending',
        panCard: application.panCard?.verification?.status || 'pending',
        drivingLicense: application.drivingLicense?.verification?.status || 'pending',
        vehicleRC: application.vehicleRC?.verification?.status || 'pending',
        vehiclePhoto: application.vehiclePhoto?.verification?.status || 'pending',
        bankDetails: application.bankDetails?.verification?.status || 'pending'
      };

      res.status(200).json({
        success: true,
        message: application.verificationStatus === 'verified'
          ? 'Registration completed successfully. Your account is verified.'
          : 'Registration completed successfully! Your application is under review.',
        data: {
          token: responseToken,
          applicationId: application._id,
          driverId: application.driverId,
          fullName: application.fullName,
          phone: application.phone,
          verificationStatus: application.verificationStatus,
          documentStatus,
          hiredDriver: {
            hasHiredDriver: application.hiredDriver?.hasHiredDriver || false,
            name: application.hiredDriver?.name || null,
            phone: application.hiredDriver?.phone || null,
            licenseUploaded: !!application.hiredDriver?.licenseImage?.url,
          },
          submittedAt: application.submittedAt
        }
      });
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please verify OTP again.'
        });
      }
      throw error;
    }

  } catch (error) {
    console.error('Error in completeRegistration:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to complete registration'
    });
  }
};

// Get Application Status
export const getApplicationStatus = async (req, res) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const application = await DriverApplication.findOne({ phone });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'No application found for this phone number'
      });
    }

    const documentStatus = {
      profilePhoto: application.profilePhoto?.verification?.status || 'not_uploaded',
      aadharFront: application.aadharCard?.front?.verification?.status || 'not_uploaded',
      aadharBack: application.aadharCard?.back?.verification?.status || 'not_uploaded',
      panCard: application.panCard?.verification?.status || 'not_uploaded',
      drivingLicense: application.drivingLicense?.verification?.status || 'not_uploaded',
      vehicleRC: application.vehicleRC?.verification?.status || 'not_uploaded',
      vehiclePhoto: application.vehiclePhoto?.verification?.status || 'not_uploaded',
      bankDetails: application.bankDetails?.verification?.status || 'not_provided'
    };

    res.status(200).json({
      success: true,
      data: {
        driverId: application.driverId,
        fullName: application.fullName,
        verificationStatus: application.verificationStatus,
        documentStatus,
        rejectionReason: application.rejectionReason,
        submittedAt: application.submittedAt
      }
    });
  } catch (error) {
    console.error('Error in getApplicationStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get application status'
    });
  }
};

// Get Driver Profile
export const getDriverProfile = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { driver, application } = await checkDriverVerification(driverId);

    const profileData = {
      id: driver._id,
      driverId: driver.driverId,
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      lastActive: driver.lastActive,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      stats: {
        totalEarnings: driver.totalEarnings,
        totalTrips: driver.totalTrips,
        rating: driver.rating,
        walletBalance: driver.walletBalance
      },
      applicationDetails: application ? {
        dateOfBirth: application.dateOfBirth,
        address: application.address,
        vehicleDetails: {
          model: application.vehicleModel,
          year: application.vehicleYear,
          color: application.vehicleColor
        },
        bankDetails: application.bankDetails ? {
          accountHolderName: application.bankDetails.accountHolderName,
          accountNumber: application.bankDetails.accountNumber ? 
            `****${application.bankDetails.accountNumber.slice(-4)}` : null,
          ifscCode: application.bankDetails.ifscCode,
          bankName: application.bankDetails.bankName,
          verificationStatus: application.bankDetails.verification?.status
        } : null
      } : null,
      verificationStatus: application?.verificationStatus || 'pending'
    };

    res.status(200).json({
      success: true,
      data: profileData
    });
  } catch (error) {
    console.error('Error in getDriverProfile:', error);
    if (error.message === 'Driver not found' || error.message === 'Driver not verified. Please complete registration and wait for verification.') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to get driver profile'
    });
  }
};

// Admin function to verify document
export const verifyDocument = async (req, res) => {
  try {
    const { applicationId, documentType, subDocument, status, rejectionReason } = req.body;
    const adminId = req.admin?._id;

    const application = await DriverApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    if (documentType === 'aadharCard' && subDocument) {
      if (subDocument === 'front' && application.aadharCard?.front) {
        application.aadharCard.front.verification = {
          status,
          verifiedAt: status === 'verified' ? new Date() : undefined,
          rejectionReason: status === 'rejected' ? rejectionReason : undefined,
          verifiedBy: adminId
        };
      } else if (subDocument === 'back' && application.aadharCard?.back) {
        application.aadharCard.back.verification = {
          status,
          verifiedAt: status === 'verified' ? new Date() : undefined,
          rejectionReason: status === 'rejected' ? rejectionReason : undefined,
          verifiedBy: adminId
        };
      }

      if (application.aadharCard?.front?.verification?.status === 'verified' &&
          application.aadharCard?.back?.verification?.status === 'verified') {
        application.aadharCard.verification = { status: 'verified' };
      } else if (application.aadharCard?.front?.verification?.status === 'rejected' ||
                 application.aadharCard?.back?.verification?.status === 'rejected') {
        application.aadharCard.verification = { status: 'rejected' };
      }
    } else {
      if (application[documentType]) {
        application[documentType].verification = {
          status,
          verifiedAt: status === 'verified' ? new Date() : undefined,
          rejectionReason: status === 'rejected' ? rejectionReason : undefined,
          verifiedBy: adminId
        };
      }
    }

    application.verificationStatus = application.calculateOverallStatus?.() || 
      (status === 'verified' ? 'verified' : 'rejected');
    
    if (application.verificationStatus === 'verified') {
      application.reviewedAt = new Date();
      
      let driver = await Driver.findOne({ phone: application.phone });
      
      if (!driver) {
        driver = new Driver({
          driverId: application.driverId,
          name: application.fullName,
          phone: application.phone,
          email: application.email,
          applicationId: application._id,
          vehicleType: application.vehicleType,
          vehicleNumber: application.vehicleNumber,
          isOnline: false
        });
        await driver.save();
      }
    }

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Document verified successfully',
      data: {
        verificationStatus: application.verificationStatus
      }
    });
  } catch (error) {
    console.error('Error in verifyDocument:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify document'
    });
  }
};