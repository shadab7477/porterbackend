import express from 'express';
import { sendNotification } from '../utils/notificationService.js';

const router = express.Router();

// @route   POST /api/notifications/test
// @desc    Test sending a push notification
// @access  Public (for testing purposes)
router.post('/test', async (req, res) => {
    const { fcmToken, title, body, data } = req.body;

    if (!fcmToken) {
        return res.status(400).json({
            success: false,
            message: 'fcmToken is required to test notifications. You can get this from your client app.'
        });
    }

    const result = await sendNotification(
        fcmToken,
        title || 'Test Notification',
        body || 'This is a test notification from your backend!',
        data || { type: 'test' }
    );

    if (result.success) {
        res.status(200).json({
            success: true,
            message: 'Notification sent successfully',
            data: result
        });
    } else {
        res.status(500).json({
            success: false,
            message: 'Failed to send notification',
            error: result.error || result.message
        });
    }
});

export default router;
