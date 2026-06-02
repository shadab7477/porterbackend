// routes/merchantRoutes.js
import express from 'express';
import {
  applyForMerchant,
  getMerchantStatus,
  getMerchantBankDetails,
  updateMerchantBankDetails,
  getAllMerchantApplications,
  getMerchantApplicationById,
  verifyMerchantDocument,
  approveMerchantApplication,
  rejectMerchantApplication
} from '../controllers/merchantController.js';
import { customerAuthMiddleware } from '../middleware/customerAuthMiddleware.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// ─── CUSTOMER routes (/api/merchant) ─────────────────────────────────────────

// Apply for merchant account (with 4 image uploads)
router.post(
  '/apply',
  customerAuthMiddleware,
  upload.fields([
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack',  maxCount: 1 },
    { name: 'businessDoc', maxCount: 1 },
    { name: 'panCard',     maxCount: 1 }
  ]),
  handleMulterError,
  applyForMerchant
);

// Get current merchant status for logged-in customer
router.get('/status', customerAuthMiddleware, getMerchantStatus);
router.get('/bank-details', customerAuthMiddleware, getMerchantBankDetails);
router.put('/bank-details', customerAuthMiddleware, updateMerchantBankDetails);

// ─── ADMIN routes (/api/admin/merchant) ──────────────────────────────────────

// List all applications with filters & stats
router.get('/admin/applications', authMiddleware, getAllMerchantApplications);

// Get single application details
router.get('/admin/applications/:id', authMiddleware, getMerchantApplicationById);

// Verify individual document
router.put('/admin/applications/:id/documents/:docType/verify', authMiddleware, verifyMerchantDocument);

// Approve entire application
router.put('/admin/applications/:id/approve', authMiddleware, approveMerchantApplication);

// Reject entire application
router.put('/admin/applications/:id/reject', authMiddleware, rejectMerchantApplication);

export default router;
