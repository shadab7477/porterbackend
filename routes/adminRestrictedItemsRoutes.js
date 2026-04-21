import express from 'express';
import { uploadDocument, handleDocumentMulterError } from '../middleware/uploadDocumentMiddleware.js';
import { uploadRestrictedItems, getRestrictedItems, deleteRestrictedItem } from '../controllers/AdminauthController.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// All routes require admin authentication
router.use(adminAuth);

// @route   POST /api/admin/restricted-items/upload
// @desc    Upload restricted items list (JSON/CSV)
// @access  Private/Admin
router.post('/upload', uploadDocument.single('file'), handleDocumentMulterError, uploadRestrictedItems);

// @route   GET /api/admin/restricted-items
// @desc    Get all restricted items
// @access  Private/Admin
router.get('/', getRestrictedItems);

// @route   DELETE /api/admin/restricted-items/:id
// @desc    Delete a restricted item
// @access  Private/Admin
router.delete('/:id', deleteRestrictedItem);

export default router;