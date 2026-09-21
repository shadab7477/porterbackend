import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import Admin from '../models/Admin.js';

// Generate ticket ID
const generateTicketId = async () => {
  const count = await Ticket.countDocuments();
  const year = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const number = String(count + 1).padStart(4, '0');
  return `TKT-${year}${month}-${number}`;
};

// Get user by ID based on type
const getUserById = async (userId, userType) => {
  switch(userType) {
    case 'CUSTOMER':
      return await Customer.findById(userId);
    case 'DRIVER':
      return await Driver.findById(userId);
    case 'ADMIN':
      return await Admin.findById(userId).select('-password');
    default:
      return null;
  }
};

// Get all tickets with filters (Admin only)
export const getTickets = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required'
      });
    }

    const { 
      status, 
      priority, 
      category, 
      reporterType,
      search,
      page = 1, 
      limit = 10 
    } = req.query;

    let query = {};

    if (status && status !== 'All') {
      if (status === 'Critical') {
        query.priority = 'Critical';
      } else {
        query.status = status;
      }
    }

    if (priority && priority !== 'All') {
      query.priority = priority;
    }

    if (category && category !== 'All') {
      query.category = category;
    }

    if (reporterType && reporterType !== 'All') {
      query.reporterType = reporterType;
    }

    if (search) {
      query.$or = [
        { ticketId: { $regex: search, $options: 'i' } },
        { reporterName: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
      ];
    }

    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1, priority: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ticket.countDocuments(query);

    // Get stats
    const stats = {
      open: await Ticket.countDocuments({ status: 'Open' }),
      inProgress: await Ticket.countDocuments({ status: 'In Progress' }),
      critical: await Ticket.countDocuments({ priority: 'Critical', status: { $ne: 'Resolved' } }),
      resolvedToday: await Ticket.countDocuments({
        status: 'Resolved',
        resolvedAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),
      total: await Ticket.countDocuments(),
    };

    // Log admin action
    console.log(`Admin ${req.admin.username} fetched tickets`);

    res.status(200).json({
      success: true,
      data: tickets,
      stats,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
      error: error.message,
    });
  }
};

// Get single ticket by ID (Admin only)
export const getTicketById = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required'
      });
    }

    const { id } = req.params;

    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Fetch reporter details based on type
    let reporterDetails = null;
    if (ticket.reporterType === 'CUSTOMER') {
      reporterDetails = await Customer.findById(ticket.reporter).select('-__v');
    } else if (ticket.reporterType === 'DRIVER') {
      reporterDetails = await Driver.findById(ticket.reporter).select('-__v -password');
    }

    // Fetch assigned admin details
    let assignedToDetails = null;
    if (ticket.assignedTo) {
      assignedToDetails = await Admin.findById(ticket.assignedTo).select('name username email');
    }

    // Fetch message senders
    const messagesWithSenders = await Promise.all(
      ticket.messages.map(async (msg) => {
        let senderDetails = null;
        if (msg.senderType === 'CUSTOMER') {
          senderDetails = await Customer.findById(msg.sender).select('name phone');
        } else if (msg.senderType === 'DRIVER') {
          senderDetails = await Driver.findById(msg.sender).select('name phone');
        } else if (msg.senderType === 'ADMIN') {
          senderDetails = await Admin.findById(msg.sender).select('name username email');
        }
        return {
          ...msg.toObject(),
          senderDetails,
        };
      })
    );

    const response = {
      ...ticket.toObject(),
      reporterDetails,
      assignedToDetails,
      messages: messagesWithSenders,
    };

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket',
      error: error.message,
    });
  }
};

// Create new ticket (for customers/drivers - public)
export const createTicket = async (req, res) => {
  try {
    const { category, subject, description, reporterType, reporterId } = req.body;
console.log(req.body);

    if (!reporterId || !reporterType) {
      return res.status(400).json({
        success: false,
        message: 'Reporter ID and type are required',
      });
    }

    // Verify reporter exists
    let reporter = null;
    if (reporterType === 'CUSTOMER') {
      reporter = await Customer.findById(reporterId);
    } else if (reporterType === 'DRIVER') {
      reporter = await Driver.findById(reporterId);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid reporter type',
      });
    }

    if (!reporter) {
      return res.status(404).json({
        success: false,
        message: 'Reporter not found',
      });
    }

    const ticketId = await generateTicketId();

    const ticket = new Ticket({
      ticketId,
      reporter: reporterId,
      reporterModel: reporterType === 'CUSTOMER' ? 'Customer' : 'Driver',
      reporterName: reporter.name || reporter.fullName || 'Unknown',
      reporterType,
      reporterPhone: reporter.phone,
      reporterEmail: reporter.email,
      category,
      subject,
      description,
      messages: [{
        sender: reporterId,
        senderModel: reporterType === 'CUSTOMER' ? 'Customer' : 'Driver',
        senderName: reporter.name || reporter.fullName || 'Unknown',
        senderType: reporterType,
        message: description,
        createdAt: new Date(),
      }],
    });

    await ticket.save();

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('new-ticket', {
        ...ticket.toObject(),
        reporterDetails: reporter,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket,
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ticket',
      error: error.message,
    });
  }
};

// Update ticket status (Admin only)
export const updateTicketStatus = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const { id } = req.params;
    const { status, resolutionNotes } = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const oldStatus = ticket.status;
    ticket.status = status;
    ticket.updatedAt = new Date();

    if (status === 'Resolved' && oldStatus !== 'Resolved') {
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = req.adminId;
      if (resolutionNotes) {
        ticket.resolutionNotes = resolutionNotes;
      }
    }

    await ticket.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('ticket-updated', {
        ticketId: ticket._id,
        status: ticket.status,
        updatedBy: req.admin,
        timestamp: new Date(),
      });
    }

    // Log admin action
    console.log(`Admin ${req.admin.username} updated ticket ${ticket.ticketId} status to ${status}`);

    res.status(200).json({
      success: true,
      message: `Ticket status updated to ${status}`,
      data: ticket,
    });
  } catch (error) {
    console.error('Update ticket status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket status',
      error: error.message,
    });
  }
};

// Assign ticket to admin (Admin only)
export const assignTicket = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const { id } = req.params;
    const { adminId } = req.body;

    // If no adminId provided, assign to current admin
    const assignToId = adminId || req.adminId;

    const admin = await Admin.findById(assignToId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    ticket.assignedTo = assignToId;
    ticket.assignedToName = admin.name || admin.username;
    ticket.assignedAt = new Date();
    
    if (ticket.status === 'Open') {
      ticket.status = 'In Progress';
    }
    
    ticket.updatedAt = new Date();

    await ticket.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('ticket-assigned', {
        ticketId: ticket._id,
        assignedTo: admin,
        assignedBy: req.admin,
        timestamp: new Date(),
      });
    }

    // Log admin action
    console.log(`Admin ${req.admin.username} assigned ticket ${ticket.ticketId} to ${admin.username}`);

    res.status(200).json({
      success: true,
      message: `Ticket assigned to ${admin.name || admin.username}`,
      data: ticket,
    });
  } catch (error) {
    console.error('Assign ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign ticket',
      error: error.message,
    });
  }
};

// Add message to ticket (Admin only for admin messages)
// Add message to ticket (Admin only)
export const addMessage = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const { id } = req.params;
    const { message, isInternal } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const admin = req.admin;
    const userName = admin.name || admin.username || 'Admin';

    const newMessage = {
      sender: req.adminId,
      senderModel: 'Admin',
      senderName: userName,
      senderType: 'ADMIN',
      message,
      isInternal: isInternal || false,
      createdAt: new Date(),
    };

    ticket.messages.push(newMessage);
    ticket.updatedAt = new Date();

    // If it's an admin response and ticket is Open, change to In Progress
    if (ticket.status === 'Open') {
      ticket.status = 'In Progress';
    }

    await ticket.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('new-message', {
        ticketId: id,
        message: {
          ...newMessage,
          userDetails: {
            name: userName,
            type: 'ADMIN',
            username: admin.username
          }
        }
      });
    }

    console.log(`Admin ${admin.username} added message to ticket ${ticket.ticketId}`);

    res.status(200).json({
      success: true,
      message: 'Message added successfully',
      data: newMessage,
    });
  } catch (error) {
    console.error('Add admin message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: error.message,
    });
  }
};

// Escalate ticket (Admin only)
export const escalateTicket = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const { id } = req.params;
    const { reason } = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Find a super admin for escalation
    const superAdmin = await Admin.findOne({ role: 'super_admin' }).select('_id name username');
    
    ticket.escalatedTo = superAdmin?._id;
    ticket.escalatedAt = new Date();
    ticket.escalationReason = reason || 'Escalated for review';
    ticket.priority = 'Critical';
    ticket.updatedAt = new Date();

    // Add escalation message
    ticket.messages.push({
      sender: req.adminId,
      senderModel: 'Admin',
      senderName: req.admin.name || req.admin.username,
      senderType: 'ADMIN',
      message: `Ticket escalated to ${superAdmin?.name || 'super admin'}. Reason: ${reason || 'Not specified'}`,
      isInternal: true,
      createdAt: new Date(),
    });

    await ticket.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('ticket-escalated', {
        ticketId: ticket._id,
        escalatedTo: superAdmin,
        escalatedBy: req.admin,
        reason,
        timestamp: new Date(),
      });
    }

    // Log admin action
    console.log(`Admin ${req.admin.username} escalated ticket ${ticket.ticketId}`);

    res.status(200).json({
      success: true,
      message: 'Ticket escalated successfully',
      data: ticket,
    });
  } catch (error) {
    console.error('Escalate ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to escalate ticket',
      error: error.message,
    });
  }
};

// Get tickets for a specific user (public for users to view their tickets)
export const getUserTickets = async (req, res) => {
  try {
    const { userId, userType } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const tickets = await Ticket.find({
      reporter: userId,
      reporterType: userType,
    })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ticket.countDocuments({
      reporter: userId,
      reporterType: userType,
    });

    res.status(200).json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get user tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user tickets',
      error: error.message,
    });
  }
};

// Get support stats for dashboard (Admin only)
export const getSupportStats = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const stats = {
      total: await Ticket.countDocuments(),
      open: await Ticket.countDocuments({ status: 'Open' }),
      inProgress: await Ticket.countDocuments({ status: 'In Progress' }),
      resolved: await Ticket.countDocuments({ status: 'Resolved' }),
      closed: await Ticket.countDocuments({ status: 'Closed' }),
      critical: await Ticket.countDocuments({ priority: 'Critical', status: { $ne: 'Resolved' } }),
      high: await Ticket.countDocuments({ priority: 'High', status: { $ne: 'Resolved' } }),
      medium: await Ticket.countDocuments({ priority: 'Medium', status: { $ne: 'Resolved' } }),
      low: await Ticket.countDocuments({ priority: 'Low', status: { $ne: 'Resolved' } }),
      
      byCategory: await Ticket.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
      
      byReporterType: await Ticket.aggregate([
        { $group: { _id: '$reporterType', count: { $sum: 1 } } },
      ]),
      
      resolvedToday: await Ticket.countDocuments({
        status: 'Resolved',
        resolvedAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),
      
      createdToday: await Ticket.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),
      
      avgResponseTime: '2.5h', // You can calculate this based on actual data
    };

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get support stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support stats',
      error: error.message,
    });
  }
};

// Get unassigned tickets (Admin only)
export const getUnassignedTickets = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const tickets = await Ticket.find({ 
      assignedTo: { $exists: false },
      status: { $in: ['Open', 'In Progress'] }
    }).sort({ createdAt: -1, priority: -1 });

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    console.error('Get unassigned tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unassigned tickets',
      error: error.message,
    });
  }
};

// Get tickets assigned to current admin (Admin only)
export const getMyTickets = async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const tickets = await Ticket.find({ 
      assignedTo: req.adminId,
      status: { $ne: 'Resolved' }
    }).sort({ createdAt: -1, priority: -1 });

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your tickets',
      error: error.message,
    });
  }
};

// Add message to ticket (Public for customers/drivers)
export const addCustomerMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, userType, userId } = req.body;

    console.log('Customer message request:', { id, message, userType, userId });

    if (!message || !userType || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Message, user type and user ID are required',
      });
    }

    // Verify user exists
    let user = null;
    if (userType === 'CUSTOMER') {
      user = await Customer.findById(userId);
    } else if (userType === 'DRIVER') {
      user = await Driver.findById(userId);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type',
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Verify that the user is the reporter of this ticket
    if (ticket.reporter.toString() !== userId || ticket.reporterType !== userType) {
      return res.status(403).json({
        success: false,
        message: 'You can only add messages to your own tickets',
      });
    }

    // Don't allow messages on resolved tickets
    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add message to resolved or closed ticket',
      });
    }

    const userName = user.name || user.fullName || user.phone || 'Unknown';

    const newMessage = {
      sender: userId,
      senderModel: userType === 'CUSTOMER' ? 'Customer' : 'Driver',
      senderName: userName,
      senderType: userType,
      message,
      isInternal: false,
      createdAt: new Date(),
    };

    ticket.messages.push(newMessage);
    ticket.updatedAt = new Date();

    // If ticket was resolved and customer is messaging, reopen it
    if (ticket.status === 'Resolved') {
      ticket.status = 'In Progress';
    }

    await ticket.save();

    // Emit socket event for real-time notification to admins
    const io = req.app.get('io');
    if (io) {
      io.emit('new-message', {
        ticketId: id,
        message: {
          ...newMessage,
          userDetails: {
            name: userName,
            phone: user.phone,
            email: user.email,
            type: userType
          }
        }
      });
    }

    console.log('Message added successfully:', newMessage);

    res.status(200).json({
      success: true,
      message: 'Message added successfully',
      data: newMessage,
    });
  } catch (error) {
    console.error('Add customer message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: error.message,
    });
  }
};