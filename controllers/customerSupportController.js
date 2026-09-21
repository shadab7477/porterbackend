import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';

// Get customer's tickets
export const getMyTickets = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { page = 1, limit = 10 } = req.query;

    const tickets = await Ticket.find({
      reporter: customerId,
      reporterType: 'CUSTOMER'
    })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ticket.countDocuments({
      reporter: customerId,
      reporterType: 'CUSTOMER'
    });

    res.status(200).json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
      error: error.message
    });
  }
};

// Create new ticket
export const createTicket = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { category, subject, description } = req.body;

    if (!category || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category, subject and description are required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Generate ticket ID
    const count = await Ticket.countDocuments();
    const year = new Date().getFullYear().toString().slice(-2);
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const number = String(count + 1).padStart(4, '0');
    const ticketId = `TKT-${year}${month}-${number}`;

    const ticket = new Ticket({
      ticketId,
      reporter: customerId,
      reporterModel: 'Customer',
      reporterName: customer.name || customer.phone,
      reporterType: 'CUSTOMER',
      reporterPhone: customer.phone,
      reporterEmail: customer.email,
      category,
      subject,
      description,
      messages: [{
        sender: customerId,
        senderModel: 'Customer',
        senderName: customer.name || customer.phone,
        senderType: 'CUSTOMER',
        message: description,
        createdAt: new Date()
      }]
    });

    await ticket.save();

    // Emit socket event for real-time notification to admins
    const io = req.app.get('io');
    if (io) {
      io.emit('new-ticket', {
        ...ticket.toObject(),
        customerDetails: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ticket',
      error: error.message
    });
  }
};

// Get single ticket
export const getTicket = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { id } = req.params;

    const ticket = await Ticket.findOne({
      _id: id,
      reporter: customerId,
      reporterType: 'CUSTOMER'
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    res.status(200).json({
      success: true,
      data: ticket
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket',
      error: error.message
    });
  }
};

// Add message to ticket
export const addMessage = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const ticket = await Ticket.findOne({
      _id: id,
      reporter: customerId,
      reporterType: 'CUSTOMER'
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Don't allow messages on resolved tickets
    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add message to resolved ticket'
      });
    }

    const newMessage = {
      sender: customerId,
      senderModel: 'Customer',
      senderName: customer.name || customer.phone,
      senderType: 'CUSTOMER',
      message,
      createdAt: new Date()
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
        ticketId: ticket._id,
        message: {
          ...newMessage,
          customerDetails: {
            name: customer.name,
            phone: customer.phone
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Message added successfully',
      data: newMessage
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: error.message
    });
  }
};

// Get ticket statistics for customer
export const getStats = async (req, res) => {
  try {
    const customerId = req.customerId;

    const stats = {
      total: await Ticket.countDocuments({ reporter: customerId, reporterType: 'CUSTOMER' }),
      open: await Ticket.countDocuments({ 
        reporter: customerId, 
        reporterType: 'CUSTOMER',
        status: 'Open' 
      }),
      inProgress: await Ticket.countDocuments({ 
        reporter: customerId, 
        reporterType: 'CUSTOMER',
        status: 'In Progress' 
      }),
      resolved: await Ticket.countDocuments({ 
        reporter: customerId, 
        reporterType: 'CUSTOMER',
        status: 'Resolved' 
      })
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};