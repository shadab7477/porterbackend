import mongoose from 'mongoose';
import Notification from '../models/Notification.js';

/**
 * @desc    Get notifications for authenticated driver
 * @route   GET /api/driver/notifications
 * @access  Private (Driver)
 */
export const getDriverNotifications = async (req, res) => {
  try {
    const driverId = req.driver?.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Build driver filter:
    // 1. Broadcast to 'all'
    // 2. Broadcast to 'driver' with no specific recipientIds (or empty array)
    // 3. Specifically targeted to this driver's ID
    const queryConditions = [
      { recipientType: 'all' },
      { recipientType: 'driver', recipientIds: { $size: 0 } },
      { recipientType: 'driver', recipientIds: { $exists: false } }
    ];

    if (driverId) {
      const driverObjectId = mongoose.Types.ObjectId.isValid(driverId)
        ? new mongoose.Types.ObjectId(driverId)
        : driverId;
      queryConditions.push({ recipientType: 'driver', recipientIds: driverObjectId });
    }

    const filter = { $or: queryConditions };

    // Fetch paginated notifications
    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter)
    ]);

    // Calculate unread count specifically for this driver
    const unreadConditions = [
      ...queryConditions
    ];

    const unreadFilter = {
      $and: [
        { $or: unreadConditions },
        { isRead: { $ne: true } }
      ]
    };

    if (driverId) {
      unreadFilter.$and.push({
        readBy: { $ne: mongoose.Types.ObjectId.isValid(driverId) ? new mongoose.Types.ObjectId(driverId) : driverId }
      });
    }

    const unreadCount = await Notification.countDocuments(unreadFilter);

    // Format output with per-driver read status
    const formattedNotifications = notifications.map(notif => {
      const isReadByDriver = Boolean(
        notif.isRead ||
        (driverId && notif.readBy && notif.readBy.some(id => id.toString() === driverId.toString()))
      );

      return {
        _id: notif._id,
        id: notif._id,
        title: notif.title,
        message: notif.message,
        imageUrl: notif.imageUrl || null,
        recipientType: notif.recipientType,
        data: notif.data || {},
        isRead: isReadByDriver,
        sentAt: notif.sentAt || notif.createdAt,
        createdAt: notif.createdAt
      };
    });

    res.status(200).json({
      success: true,
      count: formattedNotifications.length,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      notifications: formattedNotifications,
      data: formattedNotifications
    });
  } catch (error) {
    console.error('Error fetching driver notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Mark a specific notification as read for authenticated driver
 * @route   PUT /api/driver/notifications/:id/read
 * @access  Private (Driver)
 */
export const markDriverNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const driverId = req.driver?.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID'
      });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    const updateOps = {
      $set: { readAt: new Date() }
    };

    if (driverId) {
      const driverObjectId = mongoose.Types.ObjectId.isValid(driverId)
        ? new mongoose.Types.ObjectId(driverId)
        : driverId;
      updateOps.$addToSet = { readBy: driverObjectId };
    }

    // If targeted exclusively to this driver (single recipient) or no recipient list
    if (!notification.recipientIds || notification.recipientIds.length <= 1) {
      updateOps.$set.isRead = true;
    }

    const updated = await Notification.findByIdAndUpdate(id, updateOps, { new: true });

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: {
        _id: updated._id,
        isRead: true,
        readAt: updated.readAt
      }
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Mark all notifications as read for authenticated driver
 * @route   PUT /api/driver/notifications/read-all
 * @access  Private (Driver)
 */
export const markAllDriverNotificationsRead = async (req, res) => {
  try {
    const driverId = req.driver?.id;
    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID required'
      });
    }

    const driverObjectId = mongoose.Types.ObjectId.isValid(driverId)
      ? new mongoose.Types.ObjectId(driverId)
      : driverId;

    const queryConditions = [
      { recipientType: 'all' },
      { recipientType: 'driver', recipientIds: { $size: 0 } },
      { recipientType: 'driver', recipientIds: { $exists: false } },
      { recipientType: 'driver', recipientIds: driverObjectId }
    ];

    const result = await Notification.updateMany(
      { $or: queryConditions },
      {
        $addToSet: { readBy: driverObjectId },
        $set: { readAt: new Date() }
      }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default {
  getDriverNotifications,
  markDriverNotificationRead,
  markAllDriverNotificationsRead
};

