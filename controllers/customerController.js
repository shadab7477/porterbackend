import Customer from '../models/Customer.js';

export const getAllCustomers = async (req, res) => {
  try {
    const { isBlocked, search, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (isBlocked !== undefined) query.isBlocked = isBlocked === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    const customers = await Customer.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Customer.countDocuments(query);
    
    res.json({
      success: true,
      data: customers,
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

export const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCustomer = async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    
    const existingCustomer = await Customer.findOne({ phone });
    if (existingCustomer) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }
    
    const customer = new Customer({ name, phone, email });
    await customer.save();
    
    const io = req.app.get('io');
    io.emit('customer:created', customer);
    
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    const io = req.app.get('io');
    io.emit('customer:updated', customer);
    
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    const io = req.app.get('io');
    io.emit('customer:deleted', { id: req.params.id });
    
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleBlockStatus = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    customer.isBlocked = !customer.isBlocked;
    await customer.save();
    
    const io = req.app.get('io');
    io.emit('customer:block-status-changed', {
      customerId: customer._id,
      isBlocked: customer.isBlocked
    });
    
    res.json({ 
      success: true, 
      data: customer,
      message: `Customer ${customer.isBlocked ? 'blocked' : 'unblocked'} successfully`
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const searchByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    
    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};