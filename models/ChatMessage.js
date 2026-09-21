// models/ChatMessage.js
import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  rideId: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  senderType: {
    type: String,
    required: true,
    enum: ['driver', 'customer']
  },
  senderName: {
    type: String,
    required: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  receiverType: {
    type: String,
    required: true,
    enum: ['driver', 'customer']
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for faster queries
chatMessageSchema.index({ rideId: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', chatMessageSchema);