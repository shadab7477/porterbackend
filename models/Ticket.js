// models/Ticket.js
import mongoose from 'mongoose';
import { SUPPORT_CONFIG, normalizeStatus, isValidStatusTransition } from '../config/supportConfig.js';

const attachmentSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  publicId: {
    type: String,
    default: null
  },
  filename: {
    type: String,
    default: 'attachment'
  },
  mimeType: {
    type: String,
    default: 'application/octet-stream'
  },
  size: {
    type: Number,
    default: 0
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'messages.senderModel',
    required: true,
  },
  senderModel: {
    type: String,
    enum: ['Customer', 'Driver', 'Admin', 'User'],
    default: 'Customer'
  },
  senderName: {
    type: String,
    default: 'User'
  },
  senderType: {
    type: String,
    enum: ['USER', 'DRIVER', 'ADMIN', 'CUSTOMER'],
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  attachments: [attachmentSchema],
  isInternal: {
    type: Boolean,
    default: false, // Internal notes strictly for Admins
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const auditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'auditHistory.actorModel'
  },
  actorModel: {
    type: String,
    enum: ['Customer', 'Driver', 'Admin', 'User'],
    default: 'Admin'
  },
  actorName: {
    type: String,
    default: 'System'
  },
  actorRole: {
    type: String,
    default: 'admin'
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isInternal: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    enum: ['complaint', 'support_request'],
    default: 'support_request',
    index: true
  },
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'reporterModel',
    required: true,
    index: true
  },
  reporterModel: {
    type: String,
    enum: ['Customer', 'Driver', 'Admin', 'User'],
    required: true
  },
  reporterName: {
    type: String,
    default: 'User'
  },
  reporterType: {
    type: String,
    enum: ['USER', 'DRIVER', 'CUSTOMER', 'ADMIN'],
    required: true,
    index: true
  },
  reporterPhone: {
    type: String,
    default: ''
  },
  reporterEmail: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  priority: {
    type: String,
    enum: ['Critical', 'High', 'Medium', 'Low'],
    default: 'Medium',
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'assigned', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'Open', 'In Progress', 'Resolved', 'Closed'],
    default: 'open',
    index: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  relatedRideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null,
    index: true
  },
  relatedRideCode: {
    type: String,
    default: '',
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
    index: true
  },
  assignedToName: {
    type: String,
    default: null
  },
  assignedAt: {
    type: Date,
    default: null
  },
  attachments: [attachmentSchema],
  messages: [messageSchema],
  resolutionNotes: {
    type: String,
    default: ''
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  closedAt: {
    type: Date,
    default: null
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  reopenedAt: {
    type: Date,
    default: null
  },
  reopenedBy: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  reopenReason: {
    type: String,
    default: ''
  },
  escalatedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  escalatedAt: {
    type: Date,
    default: null
  },
  escalationReason: {
    type: String,
    default: ''
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  auditHistory: [auditSchema],
  tags: [String],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Normalize status on pre-save
ticketSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (this.status) {
    this.status = normalizeStatus(this.status);
  }
  next();
});

// Static helper to generate unique human-readable Ticket ID
ticketSchema.statics.generateNextTicketId = async function() {
  let count = 0;
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      count = await this.countDocuments();
    } else {
      count = Math.floor(Math.random() * 900);
    }
  } catch (err) {
    count = Math.floor(Math.random() * 900);
  }
  const year = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const number = String((count || 0) + 1).padStart(4, '0');
  return `TKT-${year}${month}-${number}`;
};

// Check if status transition is valid
ticketSchema.methods.isValidTransition = function(newStatus) {
  return isValidStatusTransition(this.status, newStatus);
};

// Method to record an audit action
ticketSchema.methods.addAuditLog = function({ action, actor, actorModel = 'Admin', actorName = 'System', actorRole = 'admin', details = {}, isInternal = false }) {
  this.auditHistory.push({
    action,
    actor: actor || null,
    actorModel,
    actorName,
    actorRole,
    details,
    isInternal,
    timestamp: new Date()
  });
};

// Method to filter ticket for public/user responses (CRITICAL SECURITY: Strips internal notes & internal audit logs)
ticketSchema.methods.toPublicJSON = function() {
  const obj = this.toObject ? this.toObject() : { ...this };
  
  // Filter messages: remove all internal notes
  if (Array.isArray(obj.messages)) {
    obj.messages = obj.messages.filter(m => !m.isInternal);
  }

  // Filter audit history: remove internal logs
  if (Array.isArray(obj.auditHistory)) {
    obj.auditHistory = obj.auditHistory.filter(a => !a.isInternal);
  }

  return obj;
};

// Index optimization
ticketSchema.index({ reporter: 1, reporterType: 1, createdAt: -1 });
ticketSchema.index({ status: 1, priority: 1, createdAt: -1 });
ticketSchema.index({ category: 1, type: 1 });

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;