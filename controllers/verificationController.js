// controllers/verificationController.js
import DriverApplication from '../models/DriverApplication.js';

// Document types that can be verified
const documentTypes = [
  'profilePhoto',
  'aadharCard',
  'panCard',
  'drivingLicense',
  'vehicleRC',
  'vehicleInsurance',
  'vehiclePhoto',
  'bankDetails'
];

// Get all applications with filtering
export const getApplications = async (req, res) => {
  try {
    const { status, documentStatus, page = 1, limit = 10 } = req.query;
    
    let query = {};
    if (status && status !== 'all') {
      query.verificationStatus = status;
    }

    // Filter by specific document status if provided
    if (documentStatus && documentStatus.documentType && documentStatus.status) {
      const docType = documentStatus.documentType;
      const docStatus = documentStatus.status;
      
      if (docType === 'bankDetails') {
        query['bankDetails.verification.status'] = docStatus;
      } else if (documentTypes.includes(docType)) {
        query[`${docType}.verification.status`] = docStatus;
      }
    }

    const applications = await DriverApplication.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const total = await DriverApplication.countDocuments(query);

    res.status(200).json({
      success: true,
      data: applications,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications',
      error: error.message,
    });
  }
};

// Get single application by ID with document verification details
export const getApplicationById = async (req, res) => {
  try {
    const { id } = req.params;

    const application = await DriverApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // Add document verification summary
    const documentVerificationSummary = {
      totalDocuments: 7,
      verified: 0,
      rejected: 0,
      pending: 0,
      documents: {}
    };

    documentTypes.forEach(type => {
      if (type === 'bankDetails') {
        if (application.bankDetails?.accountNumber) {
          documentVerificationSummary.documents[type] = {
            exists: true,
            status: application.bankDetails.verification?.status || 'pending',
            rejectionReason: application.bankDetails.verification?.rejectionReason
          };
          
          if (application.bankDetails.verification?.status === 'verified') documentVerificationSummary.verified++;
          else if (application.bankDetails.verification?.status === 'rejected') documentVerificationSummary.rejected++;
          else documentVerificationSummary.pending++;
        } else {
          documentVerificationSummary.documents[type] = { exists: false };
        }
      } else {
        if (application[type]?.url) {
          documentVerificationSummary.documents[type] = {
            exists: true,
            status: application[type].verification?.status || 'pending',
            uploadedAt: application[type].uploadedAt,
            rejectionReason: application[type].verification?.rejectionReason
          };
          
          if (application[type].verification?.status === 'verified') documentVerificationSummary.verified++;
          else if (application[type].verification?.status === 'rejected') documentVerificationSummary.rejected++;
          else documentVerificationSummary.pending++;
        } else {
          documentVerificationSummary.documents[type] = { exists: false };
        }
      }
    });

    const responseData = application.toObject();
    responseData.documentVerificationSummary = documentVerificationSummary;

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch application',
      error: error.message,
    });
  }
};

// Verify a specific document
export const verifyDocument = async (req, res) => {
  try {
    const { id, documentType } = req.params;
    const { status, rejectionReason, comments } = req.body;

    if (!documentTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type',
        validTypes: documentTypes
      });
    }

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "verified" or "rejected"'
      });
    }

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required when rejecting a document'
      });
    }

    const application = await DriverApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Check if document exists
    if (documentType === 'bankDetails') {
      if (!application.bankDetails?.accountNumber) {
        return res.status(400).json({
          success: false,
          message: 'Bank details not found in application'
        });
      }
    } else {
      if (!application[documentType]?.url) {
        return res.status(400).json({
          success: false,
          message: `${documentType} not found in application`
        });
      }
    }

    // Update document verification status
    const verificationData = {
      status,
      verifiedAt: new Date(),
      rejectionReason: status === 'rejected' ? rejectionReason : undefined,
      comments: comments || ''
    };

    if (documentType === 'bankDetails') {
      application.bankDetails.verification = verificationData;
    } else {
      if (!application[documentType].verification) {
        application[documentType].verification = {};
      }
      application[documentType].verification = verificationData;
    }

    // Calculate and update overall status
    application.verificationStatus = application.calculateOverallStatus();

    await application.save();

    res.status(200).json({
      success: true,
      message: `${documentType} verification status updated successfully`,
      data: {
        applicationId: application._id,
        documentType,
        verification: verificationData,
        overallStatus: application.verificationStatus
      }
    });
  } catch (error) {
    console.error('Error in verifyDocument:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify document',
      error: error.message
    });
  }
};

// Original verifyDriver function (verifies all documents at once)
export const verifyDriver = async (req, res) => {
  try {
    const { id } = req.params;

    const application = await DriverApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // Verify all existing documents
    const documents = [
      'profilePhoto',
      'aadharCard',
      'panCard',
      'drivingLicense',
      'vehicleRC',
      'vehicleInsurance',
      'vehiclePhoto'
    ];

    documents.forEach(docType => {
      if (application[docType]?.url) {
        application[docType].verification = {
          status: 'verified',
          verifiedAt: new Date()
        };
      }
    });

    if (application.bankDetails?.accountNumber) {
      application.bankDetails.verification = {
        status: 'verified',
        verifiedAt: new Date()
      };
    }

    application.verificationStatus = 'verified';
    application.reviewedAt = new Date();

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Driver verified successfully',
      data: application,
    });
  } catch (error) {
    console.error('Verify driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify driver',
      error: error.message,
    });
  }
};

// Original rejectDriver function (rejects entire application)
export const rejectDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required',
      });
    }

    const application = await DriverApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // Reject all documents
    const documents = [
      'profilePhoto',
      'aadharCard',
      'panCard',
      'drivingLicense',
      'vehicleRC',
      'vehicleInsurance',
      'vehiclePhoto'
    ];

    documents.forEach(docType => {
      if (application[docType]?.url) {
        application[docType].verification = {
          status: 'rejected',
          verifiedAt: new Date(),
          rejectionReason: reason
        };
      }
    });

    if (application.bankDetails?.accountNumber) {
      application.bankDetails.verification = {
        status: 'rejected',
        verifiedAt: new Date(),
        rejectionReason: reason
      };
    }

    application.verificationStatus = 'rejected';
    application.rejectionReason = reason;
    application.reviewedAt = new Date();

    await application.save();

    res.status(200).json({
      success: true,
      message: 'Driver rejected successfully',
      data: application,
    });
  } catch (error) {
    console.error('Reject driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject driver',
      error: error.message,
    });
  }
};

// Update verification status (overall or specific document)
export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, documentType } = req.body;

    const validStatuses = ['pending', 'submitted', 'under_review', 'partially_verified', 'verified', 'rejected'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    const application = await DriverApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // If documentType is provided, update specific document status
    if (documentType) {
      if (!documentTypes.includes(documentType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid document type',
        });
      }

      if (documentType === 'bankDetails') {
        if (!application.bankDetails?.accountNumber) {
          return res.status(400).json({
            success: false,
            message: 'Bank details not found',
          });
        }
        application.bankDetails.verification.status = status;
        if (status === 'verified' || status === 'rejected') {
          application.bankDetails.verification.verifiedAt = new Date();
        }
      } else {
        if (!application[documentType]?.url) {
          return res.status(400).json({
            success: false,
            message: `${documentType} not found`,
          });
        }
        application[documentType].verification.status = status;
        if (status === 'verified' || status === 'rejected') {
          application[documentType].verification.verifiedAt = new Date();
        }
      }

      // Recalculate overall status
      application.verificationStatus = application.calculateOverallStatus();
    } else {
      // Update overall status
      application.verificationStatus = status;
      
      if (status === 'under_review') {
        application.reviewedAt = new Date();
      }
    }

    await application.save();

    res.status(200).json({
      success: true,
      message: documentType 
        ? `${documentType} status updated to ${status}`
        : `Overall status updated to ${status}`,
      data: application,
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message,
    });
  }
};

// Get document verification summary for an application
export const getDocumentVerificationSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const application = await DriverApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    const summary = {
      applicationId: application._id,
      phone: application.phone,
      fullName: application.fullName,
      overallStatus: application.verificationStatus,
      documents: {}
    };

    documentTypes.forEach(type => {
      if (type === 'bankDetails') {
        if (application.bankDetails?.accountNumber) {
          summary.documents[type] = {
            exists: true,
            status: application.bankDetails.verification?.status || 'pending',
            verifiedAt: application.bankDetails.verification?.verifiedAt,
            rejectionReason: application.bankDetails.verification?.rejectionReason,
            comments: application.bankDetails.verification?.comments
          };
        } else {
          summary.documents[type] = { exists: false };
        }
      } else {
        if (application[type]?.url) {
          summary.documents[type] = {
            exists: true,
            status: application[type].verification?.status || 'pending',
            uploadedAt: application[type].uploadedAt,
            verifiedAt: application[type].verification?.verifiedAt,
            rejectionReason: application[type].verification?.rejectionReason,
            comments: application[type].verification?.comments
          };
          
          // Add document-specific details
          if (type === 'drivingLicense' && application.drivingLicense?.licenseNumber) {
            summary.documents[type].licenseNumber = application.drivingLicense.licenseNumber;
            summary.documents[type].expiryDate = application.drivingLicense.expiryDate;
          }
          if (type === 'vehicleRC' && application.vehicleRC?.rcNumber) {
            summary.documents[type].rcNumber = application.vehicleRC.rcNumber;
          }
          if (type === 'vehicleInsurance' && application.vehicleInsurance?.policyNumber) {
            summary.documents[type].policyNumber = application.vehicleInsurance.policyNumber;
            summary.documents[type].expiryDate = application.vehicleInsurance.expiryDate;
          }
        } else {
          summary.documents[type] = { exists: false };
        }
      }
    });

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get document verification summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get document verification summary',
      error: error.message
    });
  }
};

// Get verification statistics with document-level breakdown
export const getStats = async (req, res) => {
  try {
    // Overall status stats
    const overallStats = await DriverApplication.aggregate([
      {
        $group: {
          _id: '$verificationStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    // Document-specific stats
    const documentStats = {};
    
    for (const docType of documentTypes) {
      const stats = await DriverApplication.aggregate([
        {
          $match: docType === 'bankDetails' 
            ? { 'bankDetails.accountNumber': { $exists: true } }
            : { [`${docType}.url`]: { $exists: true } }
        },
        {
          $group: {
            _id: docType === 'bankDetails' 
              ? '$bankDetails.verification.status'
              : `$${docType}.verification.status`,
            count: { $sum: 1 }
          }
        }
      ]);

      documentStats[docType] = {
        pending: 0,
        verified: 0,
        rejected: 0,
        total: 0
      };

      stats.forEach(stat => {
        const status = stat._id || 'pending';
        documentStats[docType][status] = stat.count;
        documentStats[docType].total += stat.count;
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayVerified = await DriverApplication.countDocuments({
      verificationStatus: 'verified',
      reviewedAt: { $gte: today },
    });

    const result = {
      pending: 0,
      submitted: 0,
      under_review: 0,
      partially_verified: 0,
      verified: 0,
      rejected: 0,
      todayVerified,
      total: await DriverApplication.countDocuments(),
      documentStats
    };

    overallStats.forEach(stat => {
      result[stat._id] = stat.count;
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error.message,
    });
  }
};