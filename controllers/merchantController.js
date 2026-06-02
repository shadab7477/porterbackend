// controllers/merchantController.js
import MerchantApplication from '../models/MerchantApplication.js';
import Customer from '../models/Customer.js';
import { uploadToCloudinary } from '../config/cloudinary.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const validateImageFile = (file) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (!allowed.includes(file.mimetype))
    return { valid: false, message: 'Only JPEG, PNG and WEBP images are allowed.' };
  if (file.size > maxSize)
    return { valid: false, message: 'File too large. Max size is 5 MB.' };
  return { valid: true };
};

const uploadFile = async (fileArray, folder, label) => {
  if (!fileArray || fileArray.length === 0) return null;
  const file = fileArray[0];
  const check = validateImageFile(file);
  if (!check.valid) throw new Error(`${label}: ${check.message}`);
  const result = await uploadToCloudinary(file.buffer, folder);
  return {
    url: result.url,
    publicId: result.publicId,
    uploadedAt: new Date(),
    verification: { status: 'pending' }
  };
};

const hasCompleteBankDetails = (bankDetails) => (
  !!bankDetails?.accountHolderName &&
  !!bankDetails?.accountNumber &&
  !!bankDetails?.ifscCode
);

const maskAccountNumber = (accountNumber) => {
  if (!accountNumber) return null;
  const value = String(accountNumber);
  return `****${value.slice(-4)}`;
};

const serializeBankDetails = (bankDetails) => {
  if (!bankDetails) return null;
  return {
    accountHolderName: bankDetails.accountHolderName,
    accountNumber: maskAccountNumber(bankDetails.accountNumber),
    ifscCode: bankDetails.ifscCode,
    bankName: bankDetails.bankName,
    branchName: bankDetails.branchName,
    updatedAt: bankDetails.updatedAt
  };
};

const findCustomerMerchantApplication = async (customer) => {
  if (customer.merchantApplicationId) {
    const linked = await MerchantApplication.findById(customer.merchantApplicationId);
    if (linked) return linked;
  }

  return MerchantApplication
    .findOne({ customerId: customer._id })
    .sort({ createdAt: -1 });
};

// ─── CUSTOMER ROUTES ──────────────────────────────────────────────────────────

// POST /api/merchant/apply
export const applyForMerchant = async (req, res) => {
  try {
    const customerId = req.customerId;
    const customer   = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Already an approved merchant
    if (customer.isMerchant) {
      return res.status(400).json({
        success: false,
        message: 'You are already a verified merchant.'
      });
    }

    // Check for an existing pending/under_review application
    const existingApp = await MerchantApplication.findOne({
      customerId,
      status: { $in: ['pending', 'under_review'] }
    });
    if (existingApp) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending application. Please wait for admin review.',
        data: { applicationId: existingApp._id, status: existingApp.status }
      });
    }

    const { businessName, businessRegistrationNumber, panNumber, aadharNumber } = req.body;

    if (!businessName || !businessRegistrationNumber || !panNumber || !aadharNumber) {
      return res.status(400).json({
        success: false,
        message: 'businessName, businessRegistrationNumber, panNumber, and aadharNumber are required.'
      });
    }

    const uploadedFiles = req.files || {};
    const required = ['aadharFront', 'aadharBack', 'businessDoc', 'panCard'];
    const missing  = required.filter(f => !uploadedFiles[f] || uploadedFiles[f].length === 0);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required documents: ${missing.join(', ')}`
      });
    }

    const folder = `merchant-documents/${customerId}`;

    // Upload documents to Cloudinary
    let aadharFrontDoc, aadharBackDoc, businessDocFile, panCardDoc;
    try {
      aadharFrontDoc  = await uploadFile(uploadedFiles.aadharFront,  folder, 'Aadhaar Front');
      aadharBackDoc   = await uploadFile(uploadedFiles.aadharBack,   folder, 'Aadhaar Back');
      businessDocFile = await uploadFile(uploadedFiles.businessDoc,  folder, 'Business Doc');
      panCardDoc      = await uploadFile(uploadedFiles.panCard,      folder, 'PAN Card');
    } catch (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    // Create application
    const application = new MerchantApplication({
      customerId,
      customerPhone: customer.phone,
      customerName:  customer.name || '',
      businessName,
      businessRegistrationNumber,
      panNumber: panNumber.toUpperCase(),
      aadharCard: {
        front: aadharFrontDoc,
        back:  aadharBackDoc,
        aadharNumber,
        verification: { status: 'pending' }
      },
      businessDoc: businessDocFile,
      panCard:     panCardDoc,
      status:      'pending',
      submittedAt: new Date()
    });

    await application.save();

    // Link application to customer
    customer.merchantApplicationId = application._id;
    await customer.save();

    res.status(201).json({
      success: true,
      message: 'Merchant application submitted successfully. Admin will review your documents.',
      data: {
        applicationId: application._id,
        status: application.status,
        submittedAt: application.submittedAt
      }
    });

  } catch (error) {
    console.error('applyForMerchant error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to submit application' });
  }
};

// GET /api/merchant/status
export const getMerchantStatus = async (req, res) => {
  try {
    const customerId = req.customerId;
    const customer   = await Customer.findById(customerId).select('isMerchant merchantDiscount merchantApplicationId name phone');

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    let application = null;
    if (customer.merchantApplicationId) {
      application = await MerchantApplication.findById(customer.merchantApplicationId)
        .select('status businessName submittedAt reviewedAt rejectionReason');
    }

    if (!application) {
      // Try fetching any latest application even if not linked
      application = await MerchantApplication
        .findOne({ customerId })
        .sort({ createdAt: -1 })
        .select('status businessName submittedAt reviewedAt rejectionReason');
    }

    res.json({
      success: true,
      data: {
        isMerchant:     customer.isMerchant,
        merchantDiscount: customer.isMerchant ? customer.merchantDiscount : 0,
        application:    application || null
      }
    });
  } catch (error) {
    console.error('getMerchantStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch merchant status' });
  }
};

// GET /api/merchant/bank-details
export const getMerchantBankDetails = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customerId).select('isMerchant merchantApplicationId bankDetails');
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const application = await findCustomerMerchantApplication(customer);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Merchant application not found. Please apply for a merchant account first.'
      });
    }

    res.json({
      success: true,
      data: {
        applicationId: application._id,
        applicationStatus: application.status,
        bankDetails: serializeBankDetails(application.bankDetails || customer.bankDetails)
      }
    });
  } catch (error) {
    console.error('getMerchantBankDetails error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch merchant bank details' });
  }
};

// PUT /api/merchant/bank-details
export const updateMerchantBankDetails = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customerId).select('isMerchant merchantApplicationId bankDetails');
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const application = await findCustomerMerchantApplication(customer);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Merchant application not found. Please apply for a merchant account first.'
      });
    }

    const { accountHolderName, accountNumber, ifscCode, bankName, branchName } = req.body;
    const bankDetails = {
      accountHolderName: accountHolderName ? String(accountHolderName).trim() : '',
      accountNumber: accountNumber ? String(accountNumber).trim() : '',
      ifscCode: ifscCode ? String(ifscCode).trim().toUpperCase() : '',
      bankName: bankName ? String(bankName).trim() : undefined,
      branchName: branchName ? String(branchName).trim() : undefined,
      updatedAt: new Date()
    };

    if (!hasCompleteBankDetails(bankDetails)) {
      return res.status(400).json({
        success: false,
        message: 'Account holder name, account number and IFSC code are required'
      });
    }

    application.bankDetails = bankDetails;
    await application.save();

    customer.bankDetails = bankDetails;
    await customer.save();

    res.json({
      success: true,
      message: 'Merchant bank details saved successfully',
      data: {
        applicationId: application._id,
        applicationStatus: application.status,
        bankDetails: serializeBankDetails(application.bankDetails)
      }
    });
  } catch (error) {
    console.error('updateMerchantBankDetails error:', error);
    res.status(500).json({ success: false, message: 'Failed to save merchant bank details' });
  }
};

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// GET /api/admin/merchant/applications
export const getAllMerchantApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const [applications, total] = await Promise.all([
      MerchantApplication.find(query)
        .sort({ submittedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('-__v'),
      MerchantApplication.countDocuments(query)
    ]);

    // Stats
    const [pending, underReview, approved, rejected] = await Promise.all([
      MerchantApplication.countDocuments({ status: 'pending' }),
      MerchantApplication.countDocuments({ status: 'under_review' }),
      MerchantApplication.countDocuments({ status: 'approved' }),
      MerchantApplication.countDocuments({ status: 'rejected' })
    ]);

    res.json({
      success: true,
      data: applications,
      stats: { total: await MerchantApplication.countDocuments(), pending, underReview, approved, rejected },
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('getAllMerchantApplications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch applications' });
  }
};

// GET /api/admin/merchant/applications/:id
export const getMerchantApplicationById = async (req, res) => {
  try {
    const application = await MerchantApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    res.json({ success: true, data: application });
  } catch (error) {
    console.error('getMerchantApplicationById error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch application' });
  }
};

// PUT /api/admin/merchant/applications/:id/documents/:docType/verify
export const verifyMerchantDocument = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const { status, rejectionReason } = req.body;

    const validDocTypes = ['aadharFront', 'aadharBack', 'businessDoc', 'panCard'];
    if (!validDocTypes.includes(docType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Valid types: ${validDocTypes.join(', ')}`
      });
    }

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "verified" or "rejected"' });
    }

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const application = await MerchantApplication.findById(id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const verificationData = {
      status,
      verifiedAt: new Date(),
      rejectionReason: status === 'rejected' ? rejectionReason : undefined
    };

    // Update the correct nested path
    if (docType === 'aadharFront') {
      if (!application.aadharCard?.front) {
        return res.status(400).json({ success: false, message: 'Aadhaar front not found' });
      }
      application.aadharCard.front.verification = verificationData;
    } else if (docType === 'aadharBack') {
      if (!application.aadharCard?.back) {
        return res.status(400).json({ success: false, message: 'Aadhaar back not found' });
      }
      application.aadharCard.back.verification = verificationData;
    } else if (docType === 'businessDoc') {
      if (!application.businessDoc) {
        return res.status(400).json({ success: false, message: 'Business doc not found' });
      }
      application.businessDoc.verification = verificationData;
    } else if (docType === 'panCard') {
      if (!application.panCard) {
        return res.status(400).json({ success: false, message: 'PAN card not found' });
      }
      application.panCard.verification = verificationData;
    }

    // Move to under_review if still pending
    if (application.status === 'pending') {
      application.status = 'under_review';
    }

    await application.save();

    res.json({
      success: true,
      message: `${docType} ${status} successfully`,
      data: { applicationId: application._id, docType, status, overallStatus: application.status }
    });
  } catch (error) {
    console.error('verifyMerchantDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify document' });
  }
};

// PUT /api/admin/merchant/applications/:id/approve
export const approveMerchantApplication = async (req, res) => {
  try {
    const application = await MerchantApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    if (application.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Application is already approved' });
    }

    // Mark application approved
    application.status     = 'approved';
    application.reviewedAt = new Date();
    await application.save();

    // Grant merchant privileges to customer
    await Customer.findByIdAndUpdate(application.customerId, {
      isMerchant:            true,
      merchantDiscount:      5,
      merchantApplicationId: application._id
    });

    res.json({
      success: true,
      message: 'Merchant application approved. Customer now has merchant privileges with 5% discount.',
      data: { applicationId: application._id, customerId: application.customerId, status: 'approved' }
    });
  } catch (error) {
    console.error('approveMerchantApplication error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve application' });
  }
};

// PUT /api/admin/merchant/applications/:id/reject
export const rejectMerchantApplication = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const application = await MerchantApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    application.status          = 'rejected';
    application.rejectionReason = reason;
    application.reviewedAt      = new Date();
    await application.save();

    // Ensure customer is NOT marked as merchant (in case they were previously)
    await Customer.findByIdAndUpdate(application.customerId, { isMerchant: false });

    res.json({
      success: true,
      message: 'Merchant application rejected.',
      data: { applicationId: application._id, status: 'rejected', reason }
    });
  } catch (error) {
    console.error('rejectMerchantApplication error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject application' });
  }
};
