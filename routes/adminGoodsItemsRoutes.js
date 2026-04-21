import express from 'express';
import { uploadDocument, handleDocumentMulterError } from '../middleware/uploadDocumentMiddleware.js';
import { uploadGoodsItems, getGoodsItems, deleteGoodsItem, updateGoodsItemStatus } from '../controllers/AdminauthController.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// All routes require admin authentication
router.use(adminAuth);

// @route   POST /api/admin/goods-items/upload
// @desc    Upload goods items list (JSON/CSV)
// @access  Private/Admin
router.post('/upload', uploadDocument.single('file'), handleDocumentMulterError, uploadGoodsItems);

// @route   GET /api/admin/goods-items
// @desc    Get all goods items
// @access  Private/Admin
router.get('/', getGoodsItems);

// @route   DELETE /api/admin/goods-items/:id
// @desc    Delete a goods item
// @access  Private/Admin
router.delete('/:id', deleteGoodsItem);

// @route   PATCH /api/admin/goods-items/:id/status
// @desc    Update goods item status
// @access  Private/Admin
router.patch('/:id/status', updateGoodsItemStatus);

export default router;