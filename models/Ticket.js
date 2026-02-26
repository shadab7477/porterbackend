import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  senderName: String,
  senderType: {
    type: String,
    enum: ['USER', 'DRIVER', 'ADMIN','CUSTOMER'],
  },
  message: {
    type: String,
    required: true,
  },
  attachments: [{
    url: String,
    publicId: String,
    filename: String,
  }],
  isInternal: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    required: true,
    unique: true,
  },
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reporterName: String,
  reporterType: {
    type: String,
    enum: ['USER', 'DRIVER','CUSTOMER'],
    required: true,
  },
  category: {
    type: String,
    enum: ['Payment', 'Ride Issue', 'Account', 'Technical', 'Driver Complaint', 'Other'],
    required: true,
  },
  priority: {
    type: String,
    enum: ['Critical', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
    default: 'Open',
  },
  subject: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedToName: String,
  messages: [messageSchema],
  resolutionNotes: String,
  resolvedAt: Date,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  escalatedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  tags: [String],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ticketSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;