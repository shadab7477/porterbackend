import Customer from '../models/Customer.js';
import OTP from '../models/OTP.js';
import { sendSmsOtp, generateOTP } from '../utils/smsService.js';
import { sendNotification } from '../utils/notificationService.js';

const MAX_OTP_ATTEMPTS = 3;
const OTP_EXPIRY_MINUTES = 15;

const isDummyMobile = (num) => {
  if (!num) return false;
  const cleaned = String(num).replace(/\D/g, ''); // Keep only digits
  return cleaned === '7477246478' || cleaned === '917477246478';
};

export const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    console.log(req.body);

    // Delete any existing OTP for this mobile
    await OTP.deleteOne({ mobile });

    let otp;
    let smsResult = { success: true };

    if (isDummyMobile(mobile)) {
      otp = '123456';
      // Save OTP to database
      await OTP.create({
        mobile,
        otp,
        attempts: 0
      });
    } else {
      // Generate new OTP
      otp = generateOTP();

      // Save OTP to database
      await OTP.create({
        mobile,
        otp,
        attempts: 0
      });

      // Send OTP via SMS
      smsResult = await sendSmsOtp(mobile, otp);
    }

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
    const { mobile, otp, fcmToken } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number and OTP'
      });
    }

    const isDummy = isDummyMobile(mobile) && otp === '123456';
    let otpRecord;

    if (!isDummy) {
      // Find OTP record
      otpRecord = await OTP.findOne({ mobile });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          message: 'OTP expired or not found. Please request new OTP'
        });
      }

      // Max attempts check
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

      // ✅ OTP verified
      otpRecord.isVerified = true;
      await otpRecord.save();
    }

    // Find or create customer
    let customer = await Customer.findOne({ phone: mobile });
    let isNewCustomer = !customer;

    if (!customer) {
      if (isDummy) {
        customer = new Customer({
          phone: mobile,
          name: 'PlayStore Tester',
          email: 'tester@playstore.com',
          isVerified: true
        });
        await customer.save();
        isNewCustomer = false;
      } else {
        customer = new Customer({
          phone: mobile,
          isVerified: true
        });
      }
    } else {
      customer.isVerified = true;
      if (isDummy && !customer.name) {
        customer.name = 'PlayStore Tester';
        customer.email = 'tester@playstore.com';
        await customer.save();
      }
    }

    // ✅ Save / Update FCM Token
    if (fcmToken) {
      customer.fcmToken = fcmToken;
    }

    customer.lastLogin = new Date();
    await customer.save();

    // Generate JWT
    const token = customer.generateAuthToken();

    // Delete OTP
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

    let otp;
    let smsResult = { success: true };

    if (isDummyMobile(mobile)) {
      otp = '123456';
      await OTP.create({
        mobile,
        otp,
        attempts: 0
      });
    } else {
      // Generate and send new OTP
      otp = generateOTP();

      await OTP.create({
        mobile,
        otp,
        attempts: 0
      });

      smsResult = await sendSmsOtp(mobile, otp);
    }

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
    const { name, email, bankDetails, savedAddresses } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (savedAddresses) {
      updateData.savedAddresses = savedAddresses;
    }
    if (bankDetails) {
      const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = bankDetails;
      if (!accountHolderName || !accountNumber || !ifscCode) {
        return res.status(400).json({
          success: false,
          message: 'Account holder name, account number and IFSC code are required'
        });
      }

      updateData.bankDetails = {
        accountHolderName: String(accountHolderName).trim(),
        accountNumber: String(accountNumber).trim(),
        ifscCode: String(ifscCode).trim().toUpperCase(),
        bankName: bankName ? String(bankName).trim() : undefined,
        branchName: branchName ? String(branchName).trim() : undefined,
        updatedAt: new Date()
      };
    }

    const customer = await Customer.findByIdAndUpdate(
      req.customerId,
      updateData,
      { new: true, runValidators: true }
    ).select('-isBlocked');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
console.log(customer.fcmToken);

    // Check if the customer has an FCM token to send the notification
    if (customer.fcmToken) {
      // Send background notification, no need to await to block the API response
      sendNotification(
        customer.fcmToken,
        'Profile Updated',
        'Thank you for updating your profile!',
        { type: 'profile_update' }
      ).catch(err => console.error('Failed to send profile update notification:', err));
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
