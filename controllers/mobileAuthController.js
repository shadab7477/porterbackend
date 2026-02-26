import Customer from '../models/Customer.js';
import OTP from '../models/OTP.js';
import { sendSmsOtp, generateOTP } from '../utils/smsService.js';

const MAX_OTP_ATTEMPTS = 3;
const OTP_EXPIRY_MINUTES = 15;

export const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    
    if (!mobile || !/^[0-9]{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid 10-digit mobile number'
      });
    }
    
    // Delete any existing OTP for this mobile
    await OTP.deleteOne({ mobile });
    
    // Generate new OTP
    const otp = generateOTP();
    
    // Save OTP to database
    await OTP.create({
      mobile,
      otp,
      attempts: 0
    });
    
    // Send OTP via SMS
    const smsResult = await sendSmsOtp(mobile, otp);
    
    if (!smsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP',
        error: smsResult.error
      });
    }
    
    res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        mobile,
        expiresIn: `${OTP_EXPIRY_MINUTES} minutes`
      }
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while sending OTP'
    });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    
    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number and OTP'
      });
    }
    
    // Find OTP record
    const otpRecord = await OTP.findOne({ mobile });
    
    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request new OTP'
      });
    }
    
    // Check max attempts
    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await OTP.deleteOne({ mobile });
      return res.status(400).json({
        success: false,
        message: 'Maximum attempts exceeded. Please request new OTP'
      });
    }
    
    // Verify OTP
    if (otpRecord.otp !== otp) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        data: {
          attemptsRemaining: MAX_OTP_ATTEMPTS - otpRecord.attempts
        }
      });
    }
    
    // Mark OTP as verified
    otpRecord.isVerified = true;
    await otpRecord.save();
    
    // Find or create customer
    let customer = await Customer.findOne({ phone: mobile });
    const isNewCustomer = !customer;
    
    if (!customer) {
      customer = new Customer({
        phone: mobile,
        isVerified: true
      });
    } else {
      customer.isVerified = true;
    }
    
    customer.lastLogin = new Date();
    await customer.save();
    
    // Generate JWT token
    const token = customer.generateAuthToken();
    
    // Delete OTP after successful verification
    await OTP.deleteOne({ mobile });
    
    res.json({
      success: true,
      message: isNewCustomer ? 'Account created successfully' : 'Login successful',
      data: {
        token,
        customer: {
          id: customer._id,
          phone: customer.phone,
          name: customer.name,
          email: customer.email,
          isNewCustomer
        }
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during OTP verification'
    });
  }
};

export const resendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number'
      });
    }
    
    // Delete existing OTP
    await OTP.deleteOne({ mobile });
    
    // Generate and send new OTP
    const otp = generateOTP();
    
    await OTP.create({
      mobile,
      otp,
      attempts: 0
    });
    
    const smsResult = await sendSmsOtp(mobile, otp);
    
    if (!smsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP',
        error: smsResult.error
      });
    }
    
    res.json({
      success: true,
      message: 'OTP resent successfully',
      data: {
        mobile,
        expiresIn: `${OTP_EXPIRY_MINUTES} minutes`
      }
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while resending OTP'
    });
  }
};

export const getCustomerProfile = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customerId).select('-isBlocked');
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

export const updateCustomerProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    
    const customer = await Customer.findByIdAndUpdate(
      req.customerId,
      { name, email },
      { new: true, runValidators: true }
    ).select('-isBlocked');
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: customer
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

export const customerLogout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};
