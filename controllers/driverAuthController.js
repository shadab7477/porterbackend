import jwt from 'jsonwebtoken';
import DriverApplication from '../models/DriverApplication.js';
import OTP from '../models/OTP.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';
import { generateOTP, sendSmsOtp } from '../utils/smsService.js';

const generateTempToken = (phone) => {
  return jwt.sign(
    { phone, type: 'driver_registration' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const verifyTempToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'driver_registration') {
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
  const maxSize = 5 * 1024 * 1024; // 5MB
  
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

    // Delete any existing OTP for this phone
    await OTP.deleteMany({ mobile: phone });

    // Generate OTP
    const otp = generateOTP();

    // Save OTP to database
    const otpRecord = new OTP({
      mobile: phone,
      otp: otp
    });
    await otpRecord.save();

    // Send SMS (mock for now)
    const smsResult = await sendSmsOtp(phone, otp);

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

// Verify OTP
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

    // Generate temporary token
    const tempToken = generateTempToken(phone);

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        tempToken,
        phone
      }
    });
  } catch (error) {
    console.error('Error in verifyOTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
};

// Complete Registration - Single API for all data and documents
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
    
    const decoded = verifyTempToken(token);
    const phone = decoded.phone;

    // Get all form data
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
      licenseExpiryDate
    } = req.body;

    // Validate required fields
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

    // Parse address
    let parsedAddress = {};
    try {
      parsedAddress = JSON.parse(address);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid address format'
      });
    }

    // Check if all required files are uploaded
    const requiredFiles = [
      'profilePhoto', 
      'aadharFront',      // Aadhar front image
      'aadharBack',       // Aadhar back image
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

    // Check if application already exists
    let application = await DriverApplication.findOne({ phone });

    if (application) {
      // Update existing application
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
      // Create new application
      application = new DriverApplication({
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

    // Upload all documents to Cloudinary
    const folder = `driver-documents/${phone}`;
    
    // Helper function to upload file
    const uploadFile = async (fileArray, docType) => {
      if (!fileArray || fileArray.length === 0) return null;
      
      const file = fileArray[0];
      
      // Validate file
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
      // Upload profile photo
      if (req.files.profilePhoto) {
        application.profilePhoto = await uploadFile(req.files.profilePhoto, 'profilePhoto');
      }
      
      // Upload aadhar front
      if (req.files.aadharFront) {
        const aadharFrontDoc = await uploadFile(req.files.aadharFront, 'aadharFront');
        if (!application.aadharCard) {
          application.aadharCard = {};
        }
        application.aadharCard.front = aadharFrontDoc;
      }
      
      // Upload aadhar back
      if (req.files.aadharBack) {
        const aadharBackDoc = await uploadFile(req.files.aadharBack, 'aadharBack');
        if (!application.aadharCard) {
          application.aadharCard = {};
        }
        application.aadharCard.back = aadharBackDoc;
      }
      
      // Set aadhar number if provided
      if (aadharNumber && application.aadharCard) {
        application.aadharCard.aadharNumber = aadharNumber;
      }
      
      // Upload pan card
      if (req.files.panCard) {
        application.panCard = await uploadFile(req.files.panCard, 'panCard');
      }
      
      // Upload driving license
      if (req.files.drivingLicense) {
        const licenseDoc = await uploadFile(req.files.drivingLicense, 'drivingLicense');
        application.drivingLicense = {
          ...licenseDoc,
          licenseNumber: licenseNumber || '',
          expiryDate: licenseExpiryDate ? new Date(licenseExpiryDate) : undefined
        };
      }
      
      // Upload vehicle RC
      if (req.files.vehicleRC) {
        const rcDoc = await uploadFile(req.files.vehicleRC, 'vehicleRC');
        application.vehicleRC = {
          ...rcDoc,
          rcNumber: rcNumber || ''
        };
      }
      
      // Upload vehicle photo
      if (req.files.vehiclePhoto) {
        application.vehiclePhoto = await uploadFile(req.files.vehiclePhoto, 'vehiclePhoto');
      }
    } catch (uploadError) {
      return res.status(400).json({
        success: false,
        message: uploadError.message
      });
    }

    // Set status to submitted
    application.verificationStatus = 'submitted';
    application.submittedAt = new Date();

    await application.save();

    // Calculate individual document statuses for response
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
      message: 'Registration completed successfully! Your application is under review.',
      data: {
        applicationId: application._id,
        fullName: application.fullName,
        phone: application.phone,
        verificationStatus: application.verificationStatus,
        documentStatus,
        submittedAt: application.submittedAt
      }
    });

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

    // Get individual document statuses
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
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyTempToken(token);
    const phone = decoded.phone;

    const application = await DriverApplication.findOne({ phone });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Driver application not found'
      });
    }

    // Prepare profile data with document statuses
    const profileData = {
      fullName: application.fullName,
      phone: application.phone,
      email: application.email,
      dateOfBirth: application.dateOfBirth,
      address: application.address,
      vehicleDetails: {
        type: application.vehicleType,
        number: application.vehicleNumber,
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
      } : null,
      documents: {
        profilePhoto: {
          url: application.profilePhoto?.url,
          status: application.profilePhoto?.verification?.status || 'not_uploaded',
          rejectionReason: application.profilePhoto?.verification?.rejectionReason
        },
        aadharCard: {
          front: {
            url: application.aadharCard?.front?.url,
            status: application.aadharCard?.front?.verification?.status || 'not_uploaded',
            rejectionReason: application.aadharCard?.front?.verification?.rejectionReason
          },
          back: {
            url: application.aadharCard?.back?.url,
            status: application.aadharCard?.back?.verification?.status || 'not_uploaded',
            rejectionReason: application.aadharCard?.back?.verification?.rejectionReason
          },
          aadharNumber: application.aadharCard?.aadharNumber ? 
            `****${application.aadharCard.aadharNumber.slice(-4)}` : null,
          status: application.aadharCard?.verification?.status || 'pending'
        },
        panCard: {
          url: application.panCard?.url,
          status: application.panCard?.verification?.status || 'not_uploaded',
          rejectionReason: application.panCard?.verification?.rejectionReason
        },
        drivingLicense: {
          url: application.drivingLicense?.url,
          licenseNumber: application.drivingLicense?.licenseNumber,
          expiryDate: application.drivingLicense?.expiryDate,
          status: application.drivingLicense?.verification?.status || 'not_uploaded',
          rejectionReason: application.drivingLicense?.verification?.rejectionReason
        },
        vehicleRC: {
          url: application.vehicleRC?.url,
          rcNumber: application.vehicleRC?.rcNumber,
          status: application.vehicleRC?.verification?.status || 'not_uploaded',
          rejectionReason: application.vehicleRC?.verification?.rejectionReason
        },
        vehiclePhoto: {
          url: application.vehiclePhoto?.url,
          status: application.vehiclePhoto?.verification?.status || 'not_uploaded',
          rejectionReason: application.vehiclePhoto?.verification?.rejectionReason
        }
      },
      verificationStatus: application.verificationStatus,
      rejectionReason: application.rejectionReason,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt
    };

    res.status(200).json({
      success: true,
      data: profileData
    });
  } catch (error) {
    console.error('Error in getDriverProfile:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to get driver profile'
    });
  }
};

// Admin function to verify individual document
export const verifyDocument = async (req, res) => {
  try {
    const { applicationId, documentType, subDocument } = req.body;
    const { status, rejectionReason } = req.body;
    const adminId = req.admin?._id; // Assuming admin auth middleware

    const application = await DriverApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Handle verification based on document type
    if (documentType === 'aadharCard' && subDocument) {
      // Verify specific aadhar sub-document (front or back)
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

      // Update overall aadhar status based on front and back
      if (application.aadharCard?.front?.verification?.status === 'verified' &&
          application.aadharCard?.back?.verification?.status === 'verified') {
        application.aadharCard.verification.status = 'verified';
      } else if (application.aadharCard?.front?.verification?.status === 'rejected' ||
                 application.aadharCard?.back?.verification?.status === 'rejected') {
        application.aadharCard.verification.status = 'rejected';
      } else {
        application.aadharCard.verification.status = 'pending';
      }
    } else {
      // Verify regular document
      if (application[documentType]) {
        application[documentType].verification = {
          status,
          verifiedAt: status === 'verified' ? new Date() : undefined,
          rejectionReason: status === 'rejected' ? rejectionReason : undefined,
          verifiedBy: adminId
        };
      }
    }

    // Calculate overall application status
    application.verificationStatus = application.calculateOverallStatus();
    
    if (application.verificationStatus === 'verified') {
      application.reviewedAt = new Date();
    }

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Document verified successfully',
      data: {
        verificationStatus: application.verificationStatus,
        documentStatus: documentType === 'aadharCard' ? {
          front: application.aadharCard?.front?.verification?.status,
          back: application.aadharCard?.back?.verification?.status,
          overall: application.aadharCard?.verification?.status
        } : {
          [documentType]: application[documentType]?.verification?.status
        }
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