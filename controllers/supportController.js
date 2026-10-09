// controllers/supportController.js
import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import Admin from '../models/Admin.js';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import { SUPPORT_CONFIG, normalizeStatus, isValidStatusTransition } from '../config/supportConfig.js';
import { uploadToCloudinary } from '../config/cloudinary.js';

// Helper: Extract authenticated user from request (handles customer, driver, admin)
const getAuthUser = (req) => {
  if (req.admin || req.adminId) {
    return {
      userId: req.adminId || req.admin?._id,
      userType: 'ADMIN',
      userModel: 'Admin',
      name: req.admin?.name || req.admin?.username || 'Admin',
      role: req.adminRole || 'admin',
      isAdmin: true
    };
  }
  if (req.customer || req.customerId) {
    const id = req.customerId || req.customer?._id;
    return {
      userId: id,
      userType: 'CUSTOMER',
      userModel: 'Customer',
      name: req.customer?.name || 'Customer',
      phone: req.customer?.phone || '',
      email: req.customer?.email || '',
      role: 'customer',
      isAdmin: false
    };
  }
  if (req.driver) {
    return {
      userId: req.driver.id,
      userType: 'DRIVER',
      userModel: 'Driver',
      name: req.driver.name || 'Driver',
      phone: req.driver.phone || '',
      role: 'driver',
      isAdmin: false
    };
  }
  return null;
};

// Helper: Emit real-time support event safely
const emitSupportEvent = (req, eventName, payload, targetRoom = null) => {
  try {
    const io = req.app?.get('io');
    if (!io) return;

    const supportNs = io.of('/support');
    if (targetRoom) {
      supportNs.to(targetRoom).emit(eventName, payload);
      io.to(targetRoom).emit(eventName, payload);
    } else {
      supportNs.emit(eventName, payload);
      io.emit(eventName, payload);
    }
  } catch (err) {
    console.error('Support socket emit error:', err.message);
  }
};

// =========================================================================
// 1. CONFIG & CATEGORIES APIS
// =========================================================================

/**
 * @desc Get available ticket categories for customer and driver
 * @route GET /api/support/categories
 * @access Public / Authenticated
 */
export const getCategories = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        ticketTypes: SUPPORT_CONFIG.ticketTypes,
        customerCategories: SUPPORT_CONFIG.customerCategories,
        driverCategories: SUPPORT_CONFIG.driverCategories
      }
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories', error: error.message });
  }
};

/**
 * @desc Get complete support configuration & SLA rules
 * @route GET /api/support/config
 * @access Public / Authenticated
 */
export const getSupportConfig = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: SUPPORT_CONFIG
    });
  } catch (error) {
    console.error('Get support config error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch support config', error: error.message });
  }
};

// =========================================================================
// 2. TICKET CREATION & USER MANAGEMENT APIS
// =========================================================================

/**
 * @desc Create a new complaint or support request
 * @route POST /api/support/tickets
 * @access Authenticated (Customer / Driver / Admin)
 */
export const createTicket = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const {
      type = 'support_request',
      category,
      subject,
      description,
      relatedRideId,
      priority = 'Medium',
      reporterType: bodyReporterType,
      reporterId: bodyReporterId,
      attachments = []
    } = req.body;

    // Determine actual reporter
    let reporterId = authUser?.userId || bodyReporterId;
    let reporterType = authUser?.userType || (bodyReporterType ? bodyReporterType.toUpperCase() : 'CUSTOMER');
    let reporterModel = authUser?.userModel || (reporterType === 'DRIVER' ? 'Driver' : reporterType === 'ADMIN' ? 'Admin' : 'Customer');

    if (!reporterId) {
      return res.status(400).json({ success: false, message: 'Reporter identification is required' });
    }

    if (!category || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category, subject, and description are required fields'
      });
    }

    // Validate reporter in database
    let reporterUser = null;
    if (reporterType === 'CUSTOMER') {
      reporterUser = await Customer.findById(reporterId);
    } else if (reporterType === 'DRIVER') {
      reporterUser = await Driver.findById(reporterId);
    } else if (reporterType === 'ADMIN') {
      reporterUser = await Admin.findById(reporterId);
    }

    if (!reporterUser && !authUser) {
      return res.status(404).json({ success: false, message: 'Reporter account not found' });
    }

    const reporterName = authUser?.name || reporterUser?.name || reporterUser?.fullName || reporterUser?.username || 'User';
    const reporterPhone = authUser?.phone || reporterUser?.phone || '';
    const reporterEmail = authUser?.email || reporterUser?.email || '';

    // Validate related ride ownership if provided
    let verifiedRide = null;
    if (relatedRideId) {
      // Find ride by Mongo ObjectId or rideId string
      verifiedRide = await Ride.findOne({
        $or: [
          ...(relatedRideId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: relatedRideId }] : []),
          { rideId: relatedRideId }
        ]
      });

      if (!verifiedRide) {
        return res.status(404).json({
          success: false,
          message: `Related ride '${relatedRideId}' not found.`
        });
      }

      // Check ride authorization (non-admins must be a participant)
      if (!authUser?.isAdmin) {
        if (reporterType === 'CUSTOMER') {
          const rideCustId = verifiedRide.customer?.customerId?.toString();
          if (rideCustId && rideCustId !== reporterId.toString()) {
            return res.status(403).json({
              success: false,
              message: 'You are not authorized to file a complaint for a ride that does not belong to you.'
            });
          }
        } else if (reporterType === 'DRIVER') {
          const rideDrvId = verifiedRide.driver?.driverId?.toString();
          if (rideDrvId && rideDrvId !== reporterId.toString()) {
            return res.status(403).json({
              success: false,
              message: 'You are not authorized to file a complaint for a ride you were not assigned to.'
            });
          }
        }
      }
    }

    const ticketId = await Ticket.generateNextTicketId();

    const newTicket = new Ticket({
      ticketId,
      type: type === 'complaint' ? 'complaint' : 'support_request',
      reporter: reporterId,
      reporterModel,
      reporterName,
      reporterType,
      reporterPhone,
      reporterEmail,
      category,
      priority: ['Critical', 'High', 'Medium', 'Low'].includes(priority) ? priority : 'Medium',
      status: 'open',
      subject,
      description,
      relatedRideId: verifiedRide?._id || null,
      relatedRideCode: verifiedRide?.rideId || '',
      attachments: Array.isArray(attachments) ? attachments : [],
      messages: [{
        sender: reporterId,
        senderModel: reporterModel,
        senderName: reporterName,
        senderType: reporterType,
        message: description,
        attachments: Array.isArray(attachments) ? attachments : [],
        isInternal: false,
        createdAt: new Date()
      }],
      auditHistory: [{
        action: 'ticket_created',
        actor: reporterId,
        actorModel: reporterModel,
        actorName: reporterName,
        actorRole: reporterType.toLowerCase(),
        details: {
          type,
          category,
          priority,
          relatedRide: verifiedRide?.rideId || null
        },
        isInternal: false,
        timestamp: new Date()
      }]
    });

    await newTicket.save();

    // Emit real-time notification to admin room
    emitSupportEvent(req, 'ticket:created', {
      ticketId: newTicket.ticketId,
      id: newTicket._id,
      type: newTicket.type,
      category: newTicket.category,
      subject: newTicket.subject,
      reporterName: newTicket.reporterName,
      reporterType: newTicket.reporterType,
      priority: newTicket.priority,
      createdAt: newTicket.createdAt
    }, 'admin-room');

    // Also emit to legacy 'new-ticket' event for backward compatibility
    emitSupportEvent(req, 'new-ticket', newTicket.toObject());

    res.status(201).json({
      success: true,
      message: `${type === 'complaint' ? 'Complaint' : 'Support request'} submitted successfully with ID ${newTicket.ticketId}`,
      data: newTicket.toPublicJSON()
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create support ticket',
      error: error.message
    });
  }
};

/**
 * @desc List authenticated user's tickets (Customer / Driver)
 * @route GET /api/support/tickets/my
 * @access Authenticated (Customer / Driver)
 */
export const getMyTickets = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { page = 1, limit = 10, status, type, category } = req.query;

    const query = {
      reporter: authUser.userId,
      reporterType: authUser.userType
    };

    if (status && status !== 'All') {
      query.status = normalizeStatus(status);
    }
    if (type && type !== 'All') {
      query.type = type;
    }
    if (category && category !== 'All') {
      query.category = category;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Ticket.countDocuments(query)
    ]);

    // Strip internal notes and internal audit logs
    const publicTickets = tickets.map(t => t.toPublicJSON());

    res.status(200).json({
      success: true,
      data: publicTickets,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum) || 1,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tickets', error: error.message });
  }
};

/**
 * @desc Get single ticket details by ID (Protected: User views public only, Admin views full)
 * @route GET /api/support/tickets/:id
 * @access Authenticated
 */
export const getTicketById = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Role-based authorization
    if (!authUser?.isAdmin) {
      // Must be the owner of the ticket
      if (!authUser || ticket.reporter.toString() !== authUser.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own tickets.'
        });
      }

      // Return public representation (CRITICAL: Strips internal notes)
      return res.status(200).json({
        success: true,
        data: ticket.toPublicJSON()
      });
    }

    // Admin response: includes complete details, internal notes, full audit trail
    let reporterDetails = null;
    if (ticket.reporterType === 'CUSTOMER') {
      reporterDetails = await Customer.findById(ticket.reporter).select('-__v');
    } else if (ticket.reporterType === 'DRIVER') {
      reporterDetails = await Driver.findById(ticket.reporter).select('-__v -password');
    }

    let assignedToDetails = null;
    if (ticket.assignedTo) {
      assignedToDetails = await Admin.findById(ticket.assignedTo).select('name username email');
    }

    let relatedRideDetails = null;
    if (ticket.relatedRideId) {
      relatedRideDetails = await Ride.findById(ticket.relatedRideId).select('rideId status requestedVehicleType fare pickupLocation dropLocation distance duration requestedAt completedAt driver customer');
    }

    res.status(200).json({
      success: true,
      data: {
        ...ticket.toObject(),
        reporterDetails,
        assignedToDetails,
        relatedRideDetails
      }
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ticket', error: error.message });
  }
};

/**
 * @desc Add message or reply to ticket
 * @route POST /api/support/tickets/:id/messages
 * @access Authenticated
 */
export const addMessage = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;
    const { message, isInternal = false, attachments = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Security check: Only Admin can add internal notes
    const isInternalNote = authUser?.isAdmin ? Boolean(isInternal) : false;

    if (!authUser?.isAdmin) {
      // User must be the reporter
      if (!authUser || ticket.reporter.toString() !== authUser.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only send messages on your own tickets.'
        });
      }

      // Check if ticket is closed
      if (ticket.status === 'closed') {
        return res.status(400).json({
          success: false,
          message: 'This ticket is closed. Please reopen it or create a new ticket.'
        });
      }

      // If ticket was resolved or waiting_for_user, user reply moves it back to in_progress
      if (['resolved', 'waiting_for_user'].includes(ticket.status)) {
        ticket.status = 'in_progress';
      }
    }

    const senderId = authUser?.userId || req.body.userId;
    const senderType = authUser?.userType || req.body.userType || 'CUSTOMER';
    const senderModel = authUser?.userModel || (senderType === 'DRIVER' ? 'Driver' : senderType === 'ADMIN' ? 'Admin' : 'Customer');
    const senderName = authUser?.name || req.body.userName || 'User';

    const newMessage = {
      sender: senderId,
      senderModel,
      senderName,
      senderType,
      message: message.trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      isInternal: isInternalNote,
      isRead: false,
      createdAt: new Date()
    };

    ticket.messages.push(newMessage);
    ticket.lastMessageAt = new Date();

    // Audit log
    ticket.addAuditLog({
      action: isInternalNote ? 'internal_note_added' : 'public_reply_added',
      actor: senderId,
      actorModel: senderModel,
      actorName: senderName,
      actorRole: authUser?.role || senderType.toLowerCase(),
      details: {
        messageSnippet: message.substring(0, 80),
        isInternal: isInternalNote
      },
      isInternal: isInternalNote
    });

    await ticket.save();

    // Emit real-time events with strict room separation
    const socketPayload = {
      ticketId: ticket._id.toString(),
      ticketCode: ticket.ticketId,
      id: ticket._id.toString(),
      message: newMessage
    };

    if (isInternalNote) {
      // Emit strictly to admin room!
      emitSupportEvent(req, 'ticket:internal-note', socketPayload, 'admin-room');
    } else {
      // Emit to ticket rooms and admin room
      emitSupportEvent(req, 'ticket:message', socketPayload, `ticket-${ticket._id}`);
      emitSupportEvent(req, 'ticket:message', socketPayload, `ticket-${ticket.ticketId}`);
      emitSupportEvent(req, 'new-message', socketPayload, `ticket-${ticket._id}`);
      emitSupportEvent(req, 'new-message', socketPayload, `ticket-${ticket.ticketId}`);
      emitSupportEvent(req, 'new-message', socketPayload, 'admin-room');
      emitSupportEvent(req, 'new-message', socketPayload);
    }

    res.status(200).json({
      success: true,
      message: isInternalNote ? 'Internal note added' : 'Message sent successfully',
      data: newMessage
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({ success: false, message: 'Failed to add message', error: error.message });
  }
};

/**
 * @desc Upload attachment for a ticket or reply
 * @route POST /api/support/tickets/:id/attachments
 * @access Authenticated
 */
export const addAttachment = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (!authUser?.isAdmin && ticket.reporter.toString() !== authUser?.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Upload to Cloudinary
    const uploaded = await uploadToCloudinary(req.file.buffer, 'support_evidence');

    const attachmentObj = {
      url: uploaded.url,
      publicId: uploaded.publicId,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size || uploaded.size,
      uploadedAt: new Date()
    };

    ticket.attachments.push(attachmentObj);
    ticket.addAuditLog({
      action: 'attachment_added',
      actor: authUser?.userId,
      actorModel: authUser?.userModel,
      actorName: authUser?.name,
      actorRole: authUser?.role,
      details: { filename: req.file.originalname, url: uploaded.url }
    });

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Attachment uploaded successfully',
      data: attachmentObj
    });
  } catch (error) {
    console.error('Add attachment error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload attachment', error: error.message });
  }
};

/**
 * @desc Close a ticket
 * @route POST /api/support/tickets/:id/close
 * @access Authenticated (Creator or Admin)
 */
export const closeTicket = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;
    const { reason = 'Closed by user' } = req.body;

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (!authUser?.isAdmin && ticket.reporter.toString() !== authUser?.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!ticket.isValidTransition('closed')) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition ticket from '${ticket.status}' to 'closed'.`
      });
    }

    const prevStatus = ticket.status;
    ticket.status = 'closed';
    ticket.closedAt = new Date();
    ticket.closedBy = authUser?.userId;

    ticket.addAuditLog({
      action: 'ticket_closed',
      actor: authUser?.userId,
      actorModel: authUser?.userModel,
      actorName: authUser?.name,
      actorRole: authUser?.role,
      details: { previousStatus: prevStatus, reason }
    });

    await ticket.save();

    emitSupportEvent(req, 'ticket:closed', {
      ticketId: ticket.ticketId,
      status: 'closed',
      closedBy: authUser?.name
    }, `ticket-${ticket._id}`);

    res.status(200).json({
      success: true,
      message: 'Ticket closed successfully',
      data: authUser?.isAdmin ? ticket : ticket.toPublicJSON()
    });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to close ticket', error: error.message });
  }
};

/**
 * @desc Reopen a resolved or closed ticket
 * @route POST /api/support/tickets/:id/reopen
 * @access Authenticated (Creator or Admin)
 */
export const reopenTicket = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;
    const { reason = 'User requested reopening' } = req.body;

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (!authUser?.isAdmin && ticket.reporter.toString() !== authUser?.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: `Only resolved or closed tickets can be reopened. Current status is '${ticket.status}'.`
      });
    }

    // Check reopen window (e.g. 7 days)
    if (!authUser?.isAdmin && ticket.resolvedAt) {
      const daysSinceResolved = (Date.now() - new Date(ticket.resolvedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceResolved > SUPPORT_CONFIG.reopenWindowDays) {
        return res.status(400).json({
          success: false,
          message: `Reopen window expired (${SUPPORT_CONFIG.reopenWindowDays} days). Please create a new ticket.`
        });
      }
    }

    const prevStatus = ticket.status;
    ticket.status = 'in_progress';
    ticket.reopenedAt = new Date();
    ticket.reopenedBy = authUser?.userId;
    ticket.reopenReason = reason;

    ticket.addAuditLog({
      action: 'ticket_reopened',
      actor: authUser?.userId,
      actorModel: authUser?.userModel,
      actorName: authUser?.name,
      actorRole: authUser?.role,
      details: { previousStatus: prevStatus, reason }
    });

    await ticket.save();

    emitSupportEvent(req, 'ticket:reopened', {
      ticketId: ticket.ticketId,
      status: 'in_progress',
      reopenedBy: authUser?.name,
      reason
    }, `ticket-${ticket._id}`);

    res.status(200).json({
      success: true,
      message: 'Ticket reopened successfully',
      data: authUser?.isAdmin ? ticket : ticket.toPublicJSON()
    });
  } catch (error) {
    console.error('Reopen ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to reopen ticket', error: error.message });
  }
};

/**
 * @desc Mark messages on a ticket as read
 * @route PATCH /api/support/tickets/:id/read
 * @access Authenticated
 */
export const markTicketRead = async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const { id } = req.params;

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    let markedCount = 0;
    ticket.messages.forEach(msg => {
      // Mark as read if sent by other party
      if (msg.sender?.toString() !== authUser?.userId?.toString() && !msg.isRead) {
        msg.isRead = true;
        msg.readAt = new Date();
        markedCount++;
      }
    });

    if (markedCount > 0) {
      await ticket.save();
    }

    res.status(200).json({
      success: true,
      message: `Marked ${markedCount} messages as read`
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read', error: error.message });
  }
};

// =========================================================================
// 3. ADMIN & SUPPORT AGENT APIS (Role-Protected)
// =========================================================================

/**
 * @desc List all tickets with search, filtering and statistics (Admin only)
 * @route GET /api/support/tickets (with Admin token) or GET /api/support/admin/tickets
 * @access Admin
 */
export const getTickets = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const {
      status,
      priority,
      category,
      type,
      reporterType,
      assignedTo,
      search,
      relatedRideId,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    let query = {};

    if (status && status !== 'All') {
      query.status = normalizeStatus(status);
    }
    if (priority && priority !== 'All') {
      query.priority = priority;
    }
    if (category && category !== 'All') {
      query.category = category;
    }
    if (type && type !== 'All') {
      query.type = type;
    }
    if (reporterType && reporterType !== 'All') {
      query.reporterType = reporterType.toUpperCase();
    }
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        query.assignedTo = { $in: [null, undefined] };
      } else {
        query.assignedTo = assignedTo;
      }
    }
    if (relatedRideId) {
      query.$or = [
        ...(relatedRideId.match(/^[0-9a-fA-F]{24}$/) ? [{ relatedRideId }] : []),
        { relatedRideCode: { $regex: relatedRideId, $options: 'i' } }
      ];
    }
    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { ticketId: { $regex: s, $options: 'i' } },
        { reporterName: { $regex: s, $options: 'i' } },
        { reporterPhone: { $regex: s, $options: 'i' } },
        { subject: { $regex: s, $options: 'i' } },
        { relatedRideCode: { $regex: s, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
      }
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const [tickets, total, statsSummary] = await Promise.all([
      Ticket.find(query)
        .sort({ createdAt: -1, priority: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('assignedTo', 'name username email')
        .lean(),
      Ticket.countDocuments(query),
      Ticket.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const stats = {
      open: await Ticket.countDocuments({ status: 'open' }),
      assigned: await Ticket.countDocuments({ status: 'assigned' }),
      inProgress: await Ticket.countDocuments({ status: 'in_progress' }),
      waitingForUser: await Ticket.countDocuments({ status: 'waiting_for_user' }),
      resolved: await Ticket.countDocuments({ status: 'resolved' }),
      closed: await Ticket.countDocuments({ status: 'closed' }),
      critical: await Ticket.countDocuments({ priority: 'Critical', status: { $nin: ['resolved', 'closed'] } }),
      complaints: await Ticket.countDocuments({ type: 'complaint' }),
      supportRequests: await Ticket.countDocuments({ type: 'support_request' }),
      total: await Ticket.countDocuments()
    };

    res.status(200).json({
      success: true,
      data: tickets,
      stats,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum) || 1,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Get admin tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tickets', error: error.message });
  }
};

/**
 * @desc Update ticket status with lifecycle validation (Admin only)
 * @route PUT /api/support/tickets/:id/status
 * @access Admin
 */
export const updateTicketStatus = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { id } = req.params;
    const { status, resolutionNotes, reason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const targetStatus = normalizeStatus(status);

    if (!ticket.isValidTransition(targetStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${ticket.status}' to '${targetStatus}'. Permitted transitions: ${JSON.stringify(SUPPORT_CONFIG.statusTransitions[ticket.status] || [])}`
      });
    }

    const oldStatus = ticket.status;
    ticket.status = targetStatus;

    if (targetStatus === 'resolved') {
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = req.adminId;
      if (resolutionNotes) ticket.resolutionNotes = resolutionNotes;
    } else if (targetStatus === 'closed') {
      ticket.closedAt = new Date();
      ticket.closedBy = req.adminId;
    }

    ticket.addAuditLog({
      action: 'status_changed',
      actor: req.adminId,
      actorModel: 'Admin',
      actorName: req.admin?.name || req.admin?.username || 'Admin',
      actorRole: req.adminRole || 'admin',
      details: {
        previousStatus: oldStatus,
        newStatus: targetStatus,
        reason: reason || resolutionNotes || 'Admin status update'
      }
    });

    await ticket.save();

    emitSupportEvent(req, 'ticket:status-changed', {
      ticketId: ticket.ticketId,
      status: targetStatus,
      updatedBy: req.admin?.username || req.admin?.name || 'Admin',
      resolutionNotes: ticket.resolutionNotes
    }, `ticket-${ticket._id}`);

    res.status(200).json({
      success: true,
      message: `Ticket status updated from ${oldStatus} to ${targetStatus}`,
      data: ticket
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update ticket status', error: error.message });
  }
};

/**
 * @desc Assign ticket to admin / support agent (Admin only)
 * @route PUT /api/support/tickets/:id/assign
 * @access Admin
 */
export const assignTicket = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { id } = req.params;
    const { adminId } = req.body;

    const assignToId = adminId || req.adminId;
    const assignedAdmin = await Admin.findById(assignToId);

    if (!assignedAdmin) {
      return res.status(404).json({ success: false, message: 'Assignee admin not found' });
    }

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const prevAssignee = ticket.assignedToName || 'Unassigned';
    ticket.assignedTo = assignToId;
    ticket.assignedToName = assignedAdmin.name || assignedAdmin.username;
    ticket.assignedAt = new Date();

    if (ticket.status === 'open') {
      ticket.status = 'assigned';
    }

    ticket.addAuditLog({
      action: 'ticket_assigned',
      actor: req.adminId,
      actorModel: 'Admin',
      actorName: req.admin?.name || req.admin?.username || 'Admin',
      actorRole: req.adminRole || 'admin',
      details: {
        previousAssignee: prevAssignee,
        newAssignee: ticket.assignedToName
      }
    });

    await ticket.save();

    emitSupportEvent(req, 'ticket:assigned', {
      ticketId: ticket.ticketId,
      assignedTo: ticket.assignedToName,
      assignedBy: req.admin?.username || req.admin?.name || 'Admin'
    }, 'admin-room');

    res.status(200).json({
      success: true,
      message: `Ticket assigned to ${ticket.assignedToName}`,
      data: ticket
    });
  } catch (error) {
    console.error('Assign ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign ticket', error: error.message });
  }
};

/**
 * @desc Change ticket priority (Admin only)
 * @route PUT /api/support/tickets/:id/priority
 * @access Admin
 */
export const updatePriority = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { id } = req.params;
    const { priority } = req.body;

    if (!['Critical', 'High', 'Medium', 'Low'].includes(priority)) {
      return res.status(400).json({ success: false, message: 'Valid priorities are: Critical, High, Medium, Low' });
    }

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const prevPriority = ticket.priority;
    ticket.priority = priority;

    ticket.addAuditLog({
      action: 'priority_changed',
      actor: req.adminId,
      actorModel: 'Admin',
      actorName: req.admin?.name || req.admin?.username || 'Admin',
      actorRole: req.adminRole || 'admin',
      details: { previousPriority: prevPriority, newPriority: priority }
    });

    await ticket.save();

    res.status(200).json({
      success: true,
      message: `Priority updated to ${priority}`,
      data: ticket
    });
  } catch (error) {
    console.error('Update priority error:', error);
    res.status(500).json({ success: false, message: 'Failed to update priority', error: error.message });
  }
};

/**
 * @desc Escalate ticket to Super Admin (Admin only)
 * @route POST /api/support/tickets/:id/escalate
 * @access Admin
 */
export const escalateTicket = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { id } = req.params;
    const { reason = 'Escalated for senior review' } = req.body;

    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const superAdmin = await Admin.findOne({ role: 'super_admin' }).select('_id name username');

    ticket.escalatedTo = superAdmin?._id || null;
    ticket.escalatedAt = new Date();
    ticket.escalationReason = reason;
    ticket.priority = 'Critical';

    ticket.messages.push({
      sender: req.adminId,
      senderModel: 'Admin',
      senderName: req.admin?.name || req.admin?.username || 'Admin',
      senderType: 'ADMIN',
      message: `[ESCALATION] Ticket escalated to Super Admin. Reason: ${reason}`,
      isInternal: true,
      createdAt: new Date()
    });

    ticket.addAuditLog({
      action: 'ticket_escalated',
      actor: req.adminId,
      actorModel: 'Admin',
      actorName: req.admin?.name || req.admin?.username || 'Admin',
      actorRole: req.adminRole || 'admin',
      details: { reason, escalatedTo: superAdmin?.username || 'Super Admin' },
      isInternal: true
    });

    await ticket.save();

    emitSupportEvent(req, 'ticket:escalated', {
      ticketId: ticket.ticketId,
      reason,
      escalatedBy: req.admin?.username || req.admin?.name || 'Admin'
    }, 'admin-room');

    res.status(200).json({
      success: true,
      message: 'Ticket escalated successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Escalate error:', error);
    res.status(500).json({ success: false, message: 'Failed to escalate ticket', error: error.message });
  }
};

/**
 * @desc Get complete related ride data for financial / operational review (Admin only)
 * @route GET /api/support/tickets/:id/related-ride
 * @access Admin
 */
export const getRelatedRideData = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const { id } = req.params;
    const ticket = await Ticket.findOne({
      $or: [
        ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
        { ticketId: id }
      ]
    });

    if (!ticket || !ticket.relatedRideId) {
      return res.status(404).json({ success: false, message: 'No related ride associated with this ticket' });
    }

    const ride = await Ride.findById(ticket.relatedRideId)
      .populate('customer.customerId', 'name phone email')
      .populate('driver.driverId', 'name phone vehicleType vehicleNumber rating');

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Associated ride not found' });
    }

    const payment = await Payment.findOne({ rideId: ride.rideId });

    res.status(200).json({
      success: true,
      data: {
        ride,
        fareBreakdown: ride.fare,
        waitingChargeDetails: ride.waitingChargeDetails || null,
        paymentRecord: payment || null,
        note: 'Review only. No financial records are automatically modified by viewing or creating a support ticket.'
      }
    });
  } catch (error) {
    console.error('Get related ride data error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch related ride data', error: error.message });
  }
};

/**
 * @desc Get support statistics (Admin only)
 * @route GET /api/support/stats
 * @access Admin
 */
export const getSupportStats = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const [
      total,
      open,
      assigned,
      inProgress,
      waitingForUser,
      resolved,
      closed,
      critical,
      high,
      medium,
      low,
      complaints,
      supportRequests,
      resolvedToday,
      createdToday,
      byCategory,
      byReporterType
    ] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: 'open' }),
      Ticket.countDocuments({ status: 'assigned' }),
      Ticket.countDocuments({ status: 'in_progress' }),
      Ticket.countDocuments({ status: 'waiting_for_user' }),
      Ticket.countDocuments({ status: 'resolved' }),
      Ticket.countDocuments({ status: 'closed' }),
      Ticket.countDocuments({ priority: 'Critical', status: { $nin: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ priority: 'High', status: { $nin: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ priority: 'Medium', status: { $nin: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ priority: 'Low', status: { $nin: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ type: 'complaint' }),
      Ticket.countDocuments({ type: 'support_request' }),
      Ticket.countDocuments({ status: 'resolved', resolvedAt: { $gte: todayStart, $lte: todayEnd } }),
      Ticket.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
      Ticket.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
      Ticket.aggregate([{ $group: { _id: '$reporterType', count: { $sum: 1 } } }])
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        open,
        assigned,
        inProgress,
        waitingForUser,
        resolved,
        closed,
        critical,
        high,
        medium,
        low,
        complaints,
        supportRequests,
        resolvedToday,
        createdToday,
        byCategory,
        byReporterType
      }
    });
  } catch (error) {
    console.error('Get support stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch support stats', error: error.message });
  }
};

/**
 * @desc Get unassigned tickets (Admin only)
 * @route GET /api/support/unassigned
 * @access Admin
 */
export const getUnassignedTickets = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const tickets = await Ticket.find({
      $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
      status: { $in: ['open', 'assigned', 'in_progress'] }
    }).sort({ createdAt: -1, priority: -1 });

    res.status(200).json({ success: true, data: tickets });
  } catch (error) {
    console.error('Get unassigned tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch unassigned tickets', error: error.message });
  }
};

/**
 * @desc Get tickets assigned to logged-in admin
 * @route GET /api/support/my-tickets
 * @access Admin
 */
export const getAdminMyTickets = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    const tickets = await Ticket.find({
      assignedTo: req.adminId,
      status: { $nin: ['resolved', 'closed'] }
    }).sort({ createdAt: -1, priority: -1 });

    res.status(200).json({ success: true, data: tickets });
  } catch (error) {
    console.error('Get admin my tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch your tickets', error: error.message });
  }
};

// =========================================================================
// 4. LEGACY / COMPATIBILITY HANDLERS
// =========================================================================

/**
 * @desc Public/legacy endpoint to fetch user tickets
 */
export const getUserTickets = async (req, res) => {
  try {
    const { userId, userType } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const tickets = await Ticket.find({
      reporter: userId,
      reporterType: userType.toUpperCase()
    })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ticket.countDocuments({
      reporter: userId,
      reporterType: userType.toUpperCase()
    });

    const publicTickets = tickets.map(t => t.toPublicJSON());

    res.status(200).json({
      success: true,
      data: publicTickets,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error('Get user tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user tickets', error: error.message });
  }
};

/**
 * @desc Legacy addCustomerMessage alias pointing to addMessage
 */
export const addCustomerMessage = addMessage;