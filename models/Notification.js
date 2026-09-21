import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String,
    default: null
  },
  recipientType: {
    type: String,
    enum: ['user', 'driver', 'all'],
    required: true
  },
  recipientIds: [{
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'recipientType'
  }],
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: false
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for faster queries
notificationSchema.index({ recipientType: 1, recipientIds: 1 });
notificationSchema.index({ senderId: 1 });
notificationSchema.index({ sentAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;