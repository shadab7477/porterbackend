import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import Vehicle from '../models/Vehicle.js';
import crypto from 'crypto';

const generateBookingId = () => {
  return 'BK' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
};

export const getAllOrders = async (req, res) => {
  try {
    const { status, driverId, customerId, page = 1, limit = 10 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (driverId) query.driverId = driverId;
    if (customerId) query.customerId = customerId;

    const orders = await Order.find(query)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .populate('assignedBy', 'name')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'name phone email')
      .populate('driverId', 'name phone vehicleType vehicleNumber currentLocation')
      .populate('assignedBy', 'name');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { customerId, vehicleType, locations, fare, notes } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const vehicle = await Vehicle.findOne({ vehicleType, isActive: true });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle type not found' });
    }

    const bookingId = generateBookingId();

    const order = new Order({
      bookingId,
      customerId,
      vehicleType,
      locations,
      fare,
      notes,
      status: 'pending'
    });

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone');

    const io = req.app.get('io');

    io.emit('booking:new', {
      order: populatedOrder,
      timestamp: new Date()
    });

    io.to('admin').emit('booking:new', {
      order: populatedOrder,
      timestamp: new Date()
    });

    res.status(201).json({ success: true, data: populatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const assignDriver = async (req, res) => {
  try {
    const { driverId } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver. Order status is ${order.status}`
      });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    if (!driver.isAvailable) {
      return res.status(400).json({ success: false, message: 'Driver is not available' });
    }

    if (!driver.isVerified || driver.verificationStatus !== 'verified') {
      return res.status(400).json({ success: false, message: 'Driver is not verified' });
    }

    order.driverId = driverId;
    order.status = 'assigned';
    order.assignedAt = new Date();
    order.assignedBy = req.adminId || null;

    await order.save();

    driver.isAvailable = false;
    await driver.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .populate('assignedBy', 'name');

    const io = req.app.get('io');

    io.emit('booking:assigned', {
      order: populatedOrder,
      timestamp: new Date()
    });

    if (driver.socketId) {
      io.to(driver.socketId).emit('booking:assigned-to-me', {
        order: populatedOrder,
        timestamp: new Date()
      });
    }

    res.json({ success: true, data: populatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;

    const validStatuses = ['pending', 'assigned', 'accepted', 'picked_up', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousStatus = order.status;
    order.status = status;

    if (status === 'accepted') {
      order.startedAt = new Date();
    } else if (status === 'completed') {
      order.completedAt = new Date();

      if (order.driverId) {
        await Driver.findByIdAndUpdate(order.driverId, { isAvailable: true });
      }
    } else if (status === 'cancelled') {
      order.cancelledAt = new Date();

      if (order.driverId) {
        await Driver.findByIdAndUpdate(order.driverId, { isAvailable: true });
      }
    }

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone');

    const io = req.app.get('io');

    io.emit('booking:status-updated', {
      order: populatedOrder,
      previousStatus,
      newStatus: status,
      timestamp: new Date()
    });

    if (order.driverId && order.driverId.socketId) {
      io.to(order.driverId.socketId).emit('booking:status-updated', {
        order: populatedOrder,
        previousStatus,
        newStatus: status,
        timestamp: new Date()
      });
    }

    res.json({ success: true, data: populatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed or already cancelled order'
      });
    }

    const previousStatus = order.status;
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = reason;

    await order.save();

    if (order.driverId) {
      await Driver.findByIdAndUpdate(order.driverId, { isAvailable: true });
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone');

    const io = req.app.get('io');

    io.emit('booking:cancelled', {
      order: populatedOrder,
      previousStatus,
      reason,
      timestamp: new Date()
    });

    res.json({ success: true, data: populatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getDriverOrders = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { driverId };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('customerId', 'name phone')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCustomerOrders = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const orders = await Order.find({ customerId })
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments({ customerId });

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateOrder = async (req, res) => {
  try {
    const { locations, fare, distance, vehicleType, notes } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a completed or cancelled order'
      });
    }

    // Update fields if provided
    if (locations) order.locations = locations;
    if (fare) order.fare = { ...order.fare, ...fare };
    if (distance !== undefined) order.distance = distance;
    if (vehicleType) order.vehicleType = vehicleType;
    if (notes !== undefined) order.notes = notes;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .populate('assignedBy', 'name');

    const io = req.app.get('io');

    io.emit('booking:updated', {
      order: populatedOrder,
      timestamp: new Date()
    });

    io.to('admin').emit('booking:updated', {
      order: populatedOrder,
      timestamp: new Date()
    });

    res.json({ success: true, data: populatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    await Order.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');

    io.emit('booking:deleted', {
      orderId: req.params.id,
      timestamp: new Date()
    });

    io.to('admin').emit('booking:deleted', {
      orderId: req.params.id,
      timestamp: new Date()
    });

    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};