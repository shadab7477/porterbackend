import Notification from '../models/Notification.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import { sendNotification } from '../utils/notificationService.js';
import { uploadToCloudinary } from '../config/cloudinary.js';

/**
 * @desc    Send notification to users/drivers
 * @route   POST /api/admin/notifications/send
 * @access  Private/Admin
 */
export const sendNotificationToUsers = async (req, res) => {
  try {
    let { title, message, recipientType, recipientIds, data } = req.body;
    
    // Parse FormData stringified arrays/objects
    if (typeof recipientIds === 'string') {
      try { recipientIds = JSON.parse(recipientIds); } catch (e) {}
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { data = {}; }
    }
    if (!data) data = {};

    let imageUrl = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'notifications');
        imageUrl = uploadResult.url;
      } catch (error) {
        console.error('Failed to upload notification image:', error);
      }
    }

    console.log(req.body);

    // Validate input
    if (!title || !message || !recipientType) {
      return res.status(400).json({
        success: false,
        message: 'Title, message, and recipientType are required'
      });
    }

    // Validate recipientType
    if (!['user', 'driver', 'all'].includes(recipientType)) {
      return res.status(400).json({
        success: false,
        message: 'Recipient type must be user, driver, or all'
      });
    }

    let targetRecipients = [];

    // Determine recipients based on type
    if (recipientType === 'user' || recipientType === 'all') {
      const users = await Customer.find(
        recipientIds && recipientIds.length > 0
          ? { _id: { $in: recipientIds }, isBlocked: false }
          : { isBlocked: false }
      ).select('_id fcmToken name phone');

      targetRecipients.push(...users.map(user => ({
        id: user._id,
        fcmToken: user.fcmToken,
        name: user.name,
        phone: user.phone,
        type: 'user'
      })));
    }

    if (recipientType === 'driver' || recipientType === 'all') {
      const drivers = await Driver.find(
        recipientIds && recipientIds.length > 0
          ? { _id: { $in: recipientIds }, isBlocked: false }
          : { isBlocked: false }
      ).select('_id fcmToken name phone');

      targetRecipients.push(...drivers.map(driver => ({
        id: driver._id,
        fcmToken: driver.fcmToken,
        name: driver.name,
        phone: driver.phone,
        type: 'driver'
      })));
    }

    // Filter out recipients without FCM tokens and ensure unique by phone
    const uniqueRecipients = new Map();
    targetRecipients.forEach(recipient => {
      if (recipient.fcmToken && recipient.phone && !uniqueRecipients.has(recipient.phone)) {
        uniqueRecipients.set(recipient.phone, recipient);
      }
    });

    const validRecipients = Array.from(uniqueRecipients.values());

    console.log(`Sending notification to ${validRecipients.length} unique recipients by phone`);
    validRecipients.forEach(r => console.log(`Recipient: ${r.name} (${r.phone}) - ${r.type}`));

    if (validRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid recipients with FCM tokens found'
      });
    }

    // Send notifications to all valid recipients
    const notificationResults = [];
    const failedNotifications = [];

    if (validRecipients.length > 0) {
      // Process in batches to avoid blocking
      const BATCH_SIZE = 50;
      for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
        const batch = validRecipients.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (recipient) => {
          try {
            const result = await sendNotification(
              recipient.fcmToken,
              title,
              message,
              {
                ...data,
                ...(imageUrl ? { imageUrl } : {}),
                notificationType: 'admin_sent',
                recipientType: recipient.type,
                recipientId: recipient.id.toString()
              }
            );

            if (result.success) {
              notificationResults.push({
                recipientId: recipient.id,
                recipientType: recipient.type,
                success: true,
                messageId: result.messageId
              });
            } else {
              const errorMessage = result.error || result.message || '';
              
              // If token is dead/unregistered, clean it up from the database immediately
              if (errorMessage.includes('NotRegistered') || errorMessage.includes('registration-token-not-registered')) {
                console.log(`[Cleanup] Removing dead FCM token for ${recipient.type} ${recipient.id}`);
                if (recipient.type === 'user') {
                  await Customer.findByIdAndUpdate(recipient.id, { $unset: { fcmToken: 1 } }).catch(e => console.error(e));
                } else if (recipient.type === 'driver') {
                  await Driver.findByIdAndUpdate(recipient.id, { $unset: { fcmToken: 1 } }).catch(e => console.error(e));
                }
              }

              failedNotifications.push({
                recipientId: recipient.id,
                recipientType: recipient.type,
                error: errorMessage
              });
            }
          } catch (error) {
            failedNotifications.push({
              recipientId: recipient.id,
              recipientType: recipient.type,
              error: error.message
            });
          }
        });
        await Promise.all(promises);
      }
    }

    // Save notification record to database
    const notificationRecord = new Notification({
      title,
      message,
      imageUrl,
      recipientType,
      recipientIds: validRecipients.map(r => r.id),
      senderId: req.adminId,
      data: {
        ...data,
        sentCount: notificationResults.length,
        failedCount: failedNotifications.length
      }
    });

    await notificationRecord.save();

    res.status(200).json({
      success: true,
      message: `Notification sent to ${notificationResults.length} recipients`,
      data: {
        notificationId: notificationRecord._id,
        sent: notificationResults.length,
        failed: failedNotifications.length,
        details: {
          sent: notificationResults,
          failed: failedNotifications
        }
      }
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while sending notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get notification history
 * @route   GET /api/admin/notifications/history
 * @access  Private/Admin
 */
export const getNotificationHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, recipientType } = req.query;

    // Build filter
    const filter = {};
    if (recipientType && ['user', 'driver', 'all'].includes(recipientType)) {
      filter.recipientType = recipientType;
    }

    // Get notifications with pagination
    const notifications = await Notification.find(filter)
      .populate('senderId', 'username name email')
      .sort({ sentAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Notification.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching notification history:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching notification history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/admin/notifications/:id/read
 * @access  Private/Admin
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findById(id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking notification as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default {
  sendNotificationToUsers,
  getNotificationHistory,
  markNotificationAsRead
};