import ShiftingRequest from '../models/ShiftingRequest.js';

// Create a new shifting request (public — no auth required)
export const createShiftingRequest = async (req, res) => {
  try {
    const { name, phone, email, movingFrom, movingTo, bhkType } = req.body;

    // Validation
    if (!name || !phone || !email || !movingFrom || !movingTo || !bhkType) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const shiftingRequest = new ShiftingRequest({
      name,
      phone,
      email,
      movingFrom,
      movingTo,
      bhkType
    });

    await shiftingRequest.save();

    res.status(201).json({
      success: true,
      message: 'Shifting request submitted successfully! Our team will contact you shortly.',
      data: shiftingRequest
    });
  } catch (error) {
    console.error('Error creating shifting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit shifting request',
      error: error.message
    });
  }
};

// Get all shifting requests (admin — auth required)
export const getAllShiftingRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const requests = await ShiftingRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await ShiftingRequest.countDocuments(filter);

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching shifting requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shifting requests',
      error: error.message
    });
  }
};

// Update shifting request status (admin)
export const updateShiftingRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const request = await ShiftingRequest.findByIdAndUpdate(
      id,
      { status, ...(notes && { notes }) },
      { new: true, runValidators: true }
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Shifting request not found'
      });
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: request
    });
  } catch (error) {
    console.error('Error updating shifting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update shifting request',
      error: error.message
    });
  }
};

// Delete shifting request (admin)
export const deleteShiftingRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ShiftingRequest.findByIdAndDelete(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Shifting request not found'
      });
    }

    res.json({
      success: true,
      message: 'Shifting request deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting shifting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete shifting request',
      error: error.message
    });
  }
};
