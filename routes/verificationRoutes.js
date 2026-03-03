// routes/verificationRoutes.js
import express from 'express';
import {
  getApplications,
  getApplicationById,
  verifyDriver,
  rejectDriver,
  updateStatus,
  getStats,
  verifyDocument,
  getDocumentVerificationSummary
} from '../controllers/verificationController.js';

const router = express.Router();

// Statistics
router.get('/stats', getStats);

// Applications list with filters
router.get('/applications', getApplications);

// Document verification summary for an application
router.get('/applications/:id/documents/summary', getDocumentVerificationSummary);

// Single application operations
router.get('/applications/:id', getApplicationById);
router.put('/applications/:id/verify', verifyDriver);
router.put('/applications/:id/reject', rejectDriver);
router.patch('/applications/:id/status', updateStatus);

// Document-level verification
router.put('/applications/:id/documents/:documentType/verify', verifyDocument);

export default router;