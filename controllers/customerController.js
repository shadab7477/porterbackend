import Customer from '../models/Customer.js';

export const getAllCustomers = async (req, res) => {
  try {
    const { isBlocked, search, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};
    
    if (isBlocked !== undefined && isBlocked !== '') {
      query.isBlocked = isBlocked === 'true';
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const customers = await Customer.find(query)
      .populate('merchantApplicationId')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort(sortOptions);
    
    const total = await Customer.countDocuments(query);
    
    res.json({
      success: true,
      data: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      filters: {
        isBlocked: isBlocked || 'all',
        search: search || ''
      }
    });
  } catch (error) {
    console.error('Error in getAllCustomers:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to fetch customers' 
    });
  }
};

export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }
    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error in getCustomerById:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to fetch customer' 
    });
  }
};

export const createCustomer = async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;
    
    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and phone number are required' 
      });
    }
    
    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ phone });
    if (existingCustomer) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number already registered' 
      });
    }
    
    const customer = new Customer({ 
      name, 
      phone, 
      email, 
      address,
      isBlocked: false,
      totalTrips: 0,
      totalSpent: 0,
      rating: 0
    });
    await customer.save();
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('customer:created', customer);
    }
    
    res.status(201).json({ 
      success: true, 
      data: customer,
      message: 'Customer created successfully'
    });
  } catch (error) {
    console.error('Error in createCustomer:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to create customer' 
    });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    const { name, email, address, fcmToken } = req.body;

    // Build update object dynamically
    const updateData = {
      updatedAt: Date.now()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (address) updateData.address = address;

    // ✅ Save FCM token if provided
    if (fcmToken) {
      updateData.fcmToken = fcmToken;
    }

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // 🔥 Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('customer:updated', customer);
    }

    res.json({
      success: true,
      data: customer,
      message: 'Customer updated successfully'
    });

  } catch (error) {
    console.error('Error in updateCustomer:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update customer'
    });
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }
    
    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('customer:deleted', { id: req.params.id });
    }
    
    res.json({ 
      success: true, 
      message: 'Customer deleted successfully' 
    });
  } catch (error) {
    console.error('Error in deleteCustomer:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to delete customer' 
    });
  }
};

export const toggleBlockStatus = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }
    
    customer.isBlocked = !customer.isBlocked;
    customer.updatedAt = Date.now();
    await customer.save();
    
    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('customer:block-status-changed', {
        id: customer._id,
        isBlocked: customer.isBlocked,
        name: customer.name
      });
    }
    
    res.json({ 
      success: true, 
      data: customer,
      message: `Customer ${customer.isBlocked ? 'blocked' : 'unblocked'} successfully`
    });
  } catch (error) {
    console.error('Error in toggleBlockStatus:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to toggle block status' 
    });
  }
};

export const searchByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }
    
    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }
    
    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error in searchByPhone:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to search customer' 
    });
  }
};

export const getCustomerStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const activeCustomers = await Customer.countDocuments({ isBlocked: false });
    const blockedCustomers = await Customer.countDocuments({ isBlocked: true });
    
    // Get customers created in last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const newCustomers = await Customer.countDocuments({ 
      createdAt: { $gte: weekAgo } 
    });
    
    // Get top customers by total trips
    const topCustomers = await Customer.find({ isBlocked: false })
      .sort({ totalTrips: -1 })
      .limit(5)
      .select('name phone totalTrips totalSpent rating');
    
    res.json({
      success: true,
      data: {
        total: totalCustomers,
        active: activeCustomers,
        blocked: blockedCustomers,
        newThisWeek: newCustomers,
        topCustomers
      }
    });
  } catch (error) {
    console.error('Error in getCustomerStats:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get customer stats' 
    });
  }
};