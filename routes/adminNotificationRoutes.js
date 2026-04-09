import express from 'express';
import notificationController from '../controllers/notificationController.js';

const router = express.Router();

// All routes require admin authentication

// @route   POST /api/admin/notifications/send
// @desc    Send notification to users/drivers
// @access  Private/Admin
router.post('/send', notificationController.sendNotificationToUsers);

// @route   GET /api/admin/notifications/history
// @desc    Get notification history
// @access  Private/Admin
router.get('/history', notificationController.getNotificationHistory);

// @route   PUT /api/admin/notifications/:id/read
// @desc    Mark notification as read
// @access  Private/Admin
router.put('/:id/read', notificationController.markNotificationAsRead);

export default router;