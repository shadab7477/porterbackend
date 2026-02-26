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

    const smsResult = await sendSmsOtp(phone, otp);

    if (!smsResult.success) {
      console.error('SMS sending failed:', smsResult.error);
    }

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
      message: 'Failed to send OTP',
      error: error.message
    });
  }
};

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
        message: 'OTP expired or not found. Please request a new OTP.'
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

    otpRecord.isVerified = true;
    await otpRecord.save();

    const tempToken = generateTempToken(phone);

    let application = await DriverApplication.findOne({ phone });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        tempToken,
        phone,
        isExistingApplication: !!application,
        applicationStatus: application?.verificationStatus || null
      }
    });
  } catch (error) {
    console.error('Error in verifyOTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
};

export const registerBasicInfo = async (req, res) => {
  try {
    const { fullName, email, dateOfBirth, address } = req.body;
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

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required'
      });
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }
    }

    let application = await DriverApplication.findOne({ phone });

    if (application) {
      application.fullName = fullName;
      if (email) application.email = email;
      if (dateOfBirth) application.dateOfBirth = new Date(dateOfBirth);
      if (address) application.address = address;
      await application.save();
    } else {
      application = new DriverApplication({
        phone,
        fullName,
        email: email || undefined,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        address: address || undefined
      });
      await application.save();
    }

    res.status(200).json({
      success: true,
      message: 'Basic information saved successfully',
      data: {
        applicationId: application._id,
        phone: application.phone,
        fullName: application.fullName,
        verificationStatus: application.verificationStatus
      }
    });
  } catch (error) {
    console.error('Error in registerBasicInfo:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to save basic information',
      error: error.message
    });
  }
};

export const uploadDocument = async (req, res) => {
  try {
    const { documentType } = req.params;
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

    const validDocumentTypes = [
      'profilePhoto',
      'aadharCard',
      'panCard',
      'drivingLicense',
      'vehicleRC',
      'vehicleInsurance',
      'vehiclePhoto'
    ];

    if (!validDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type',
        validTypes: validDocumentTypes
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const application = await DriverApplication.findOne({ phone });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Driver application not found. Please register basic information first.'
      });
    }

    const folder = `driver-documents/${phone}`;
    const uploadResult = await uploadToCloudinary(req.file.buffer, folder);

    const documentData = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      uploadedAt: new Date()
    };

    if (documentType === 'drivingLicense' && req.body.licenseNumber) {
      documentData.licenseNumber = req.body.licenseNumber;
    }
    if (documentType === 'drivingLicense' && req.body.licenseExpiryDate) {
      documentData.expiryDate = new Date(req.body.licenseExpiryDate);
    }
    if (documentType === 'vehicleRC' && req.body.rcNumber) {
      documentData.rcNumber = req.body.rcNumber;
    }
    if (documentType === 'vehicleInsurance' && req.body.policyNumber) {
      documentData.policyNumber = req.body.policyNumber;
    }
    if (documentType === 'vehicleInsurance' && req.body.insuranceExpiryDate) {
      documentData.expiryDate = new Date(req.body.insuranceExpiryDate);
    }

    application[documentType] = documentData;
    await application.save();

    res.status(200).json({
      success: true,
      message: `${documentType} uploaded successfully`,
      data: {
        documentType,
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        format: uploadResult.format,
        size: uploadResult.size
      }
    });
  } catch (error) {
    console.error('Error in uploadDocument:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
};

export const saveVehicleDetails = async (req, res) => {
  try {
    const { vehicleType, vehicleNumber, vehicleModel, vehicleYear, vehicleColor } = req.body;
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

    if (!vehicleType || !vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type and vehicle number are required'
      });
    }

    const application = await DriverApplication.findOne({ phone });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Driver application not found'
      });
    }

    application.vehicleType = vehicleType;
    application.vehicleNumber = vehicleNumber.toUpperCase();
    if (vehicleModel) application.vehicleModel = vehicleModel;
    if (vehicleYear) application.vehicleYear = parseInt(vehicleYear);
    if (vehicleColor) application.vehicleColor = vehicleColor;

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Vehicle details saved successfully',
      data: {
        vehicleType: application.vehicleType,
        vehicleNumber: application.vehicleNumber,
        vehicleModel: application.vehicleModel,
        vehicleYear: application.vehicleYear,
        vehicleColor: application.vehicleColor
      }
    });
  } catch (error) {
    console.error('Error in saveVehicleDetails:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to save vehicle details',
      error: error.message
    });
  }
};

export const saveBankDetails = async (req, res) => {
  try {
    const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = req.body;
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

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'Account holder name, account number, IFSC code, and bank name are required'
      });
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IFSC code format'
      });
    }

    const application = await DriverApplication.findOne({ phone });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Driver application not found'
      });
    }

    application.bankDetails = {
      accountHolderName,
      accountNumber,
      ifscCode: ifscCode.toUpperCase(),
      bankName,
      branchName: branchName || ''
    };

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Bank details saved successfully',
      data: {
        accountHolderName: application.bankDetails.accountHolderName,
        accountNumber: `****${application.bankDetails.accountNumber.slice(-4)}`,
        ifscCode: application.bankDetails.ifscCode,
        bankName: application.bankDetails.bankName,
        branchName: application.bankDetails.branchName
      }
    });
  } catch (error) {
    console.error('Error in saveBankDetails:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to save bank details',
      error: error.message
    });
  }
};

export const submitApplication = async (req, res) => {
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

    const requiredDocuments = [
      { field: 'profilePhoto', name: 'Profile Photo' },
      { field: 'aadharCard', name: 'Aadhar Card' },
      { field: 'panCard', name: 'PAN Card' },
      { field: 'drivingLicense', name: 'Driving License' },
      { field: 'vehicleRC', name: 'Vehicle RC' },
      { field: 'vehicleInsurance', name: 'Vehicle Insurance' },
      { field: 'vehiclePhoto', name: 'Vehicle Photo' }
    ];

    const missingDocuments = requiredDocuments.filter(doc => !application[doc.field]?.url);

    if (missingDocuments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required documents',
        missingDocuments: missingDocuments.map(doc => doc.name)
      });
    }

    if (!application.vehicleType || !application.vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle details are incomplete'
      });
    }

    if (!application.bankDetails?.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Bank details are incomplete'
      });
    }

    if (application.verificationStatus === 'submitted' || application.verificationStatus === 'under_review') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been submitted and is under review'
      });
    }

    if (application.verificationStatus === 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been verified'
      });
    }

    application.verificationStatus = 'submitted';
    application.submittedAt = new Date();
    await application.save();

    res.status(200).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        applicationId: application._id,
        verificationStatus: application.verificationStatus,
        submittedAt: application.submittedAt
      }
    });
  } catch (error) {
    console.error('Error in submitApplication:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: error.message
    });
  }
};

export const getApplicationStatus = async (req, res) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const application = await DriverApplication.findOne({ phone }).select(
      'phone fullName verificationStatus rejectionReason submittedAt reviewedAt'
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'No application found for this phone number'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        phone: application.phone,
        fullName: application.fullName,
        verificationStatus: application.verificationStatus,
        rejectionReason: application.rejectionReason,
        submittedAt: application.submittedAt,
        reviewedAt: application.reviewedAt
      }
    });
  } catch (error) {
    console.error('Error in getApplicationStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get application status',
      error: error.message
    });
  }
};

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

    const profileData = {
      applicationId: application._id,
      phone: application.phone,
      fullName: application.fullName,
      email: application.email,
      dateOfBirth: application.dateOfBirth,
      address: application.address,
      documents: {
        profilePhoto: application.profilePhoto?.url || null,
        aadharCard: application.aadharCard?.url || null,
        panCard: application.panCard?.url || null,
        drivingLicense: application.drivingLicense?.url || null,
        vehicleRC: application.vehicleRC?.url || null,
        vehicleInsurance: application.vehicleInsurance?.url || null,
        vehiclePhoto: application.vehiclePhoto?.url || null
      },
      vehicleDetails: {
        vehicleType: application.vehicleType,
        vehicleNumber: application.vehicleNumber,
        vehicleModel: application.vehicleModel,
        vehicleYear: application.vehicleYear,
        vehicleColor: application.vehicleColor
      },
      bankDetails: application.bankDetails?.accountNumber ? {
        accountHolderName: application.bankDetails.accountHolderName,
        accountNumber: `****${application.bankDetails.accountNumber.slice(-4)}`,
        ifscCode: application.bankDetails.ifscCode,
        bankName: application.bankDetails.bankName,
        branchName: application.bankDetails.branchName
      } : null,
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
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to get driver profile',
      error: error.message
    });
  }
};

export const updateDocument = async (req, res) => {
  try {
    const { documentType } = req.params;
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

    const validDocumentTypes = [
      'profilePhoto',
      'aadharCard',
      'panCard',
      'drivingLicense',
      'vehicleRC',
      'vehicleInsurance',
      'vehiclePhoto'
    ];

    if (!validDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type',
        validTypes: validDocumentTypes
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const application = await DriverApplication.findOne({ phone });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Driver application not found'
      });
    }

    const oldDocument = application[documentType];
    if (oldDocument?.publicId) {
      try {
        await deleteFromCloudinary(oldDocument.publicId);
      } catch (deleteError) {
        console.error('Error deleting old document:', deleteError);
      }
    }

    const folder = `driver-documents/${phone}`;
    const uploadResult = await uploadToCloudinary(req.file.buffer, folder);

    const documentData = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      uploadedAt: new Date()
    };

    if (documentType === 'drivingLicense' && req.body.licenseNumber) {
      documentData.licenseNumber = req.body.licenseNumber;
    }
    if (documentType === 'drivingLicense' && req.body.licenseExpiryDate) {
      documentData.expiryDate = new Date(req.body.licenseExpiryDate);
    }
    if (documentType === 'vehicleRC' && req.body.rcNumber) {
      documentData.rcNumber = req.body.rcNumber;
    }
    if (documentType === 'vehicleInsurance' && req.body.policyNumber) {
      documentData.policyNumber = req.body.policyNumber;
    }
    if (documentType === 'vehicleInsurance' && req.body.insuranceExpiryDate) {
      documentData.expiryDate = new Date(req.body.insuranceExpiryDate);
    }

    application[documentType] = documentData;

    if (application.verificationStatus === 'rejected') {
      application.verificationStatus = 'pending';
      application.rejectionReason = undefined;
    }

    await application.save();

    res.status(200).json({
      success: true,
      message: `${documentType} updated successfully`,
      data: {
        documentType,
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        format: uploadResult.format,
        size: uploadResult.size,
        verificationStatus: application.verificationStatus
      }
    });
  } catch (error) {
    console.error('Error in updateDocument:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please verify OTP again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message
    });
  }
};