import PackerBooking from '../models/PackerBooking.js';
import crypto from 'crypto';

// Generate a unique Booking ID
const generateBookingId = () => {
  return `PKG${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
};

export const createBooking = async (req, res) => {
  try {
    const {
      customerId,
      locations,
      distance,
      inventory,
      services,
      pricing,
      schedule
    } = req.body;

    // 1. Lock Availability: Verify schedule limits
    const existingBookings = await PackerBooking.countDocuments({
      'schedule.date': new Date(schedule.date),
      'schedule.timeSlot': schedule.timeSlot,
      status: { $nin: ['cancelled'] }
    });

    // Simple rule: Max 5 bookings per slot
    if (existingBookings >= 5) {
      return res.status(400).json({ success: false, message: 'Time slot is fully booked.' });
    }

    // 2. Create the Booking Object
    const bookingId = generateBookingId();
    const newBooking = new PackerBooking({
      bookingId,
      customerId,
      locations,
      distance,
      inventory,
      services,
      pricing,
      schedule,
      paymentStatus: 'pending',
      status: 'pending',
      logs: [{ status: 'Created', note: 'Booking initiated, awaiting deposit.' }]
    });

    await newBooking.save();

    // 3. Stub Razorpay order generation
    // In a real app, you would call Razorpay here with `pricing.bookingAmountPaid`
    const stubRazorpayOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;

    res.status(201).json({
      success: true,
      booking: newBooking,
      paymentOrder: {
        id: stubRazorpayOrderId,
        amount: pricing.bookingAmountPaid || 500,
        currency: 'INR'
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const confirmDeposit = async (req, res) => {
  try {
    const { id } = req.params; // Booking document _id

    const booking = await PackerBooking.findById(id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    booking.paymentStatus = 'partial_paid';
    booking.logs.push({ status: 'Deposit Paid', note: 'Initial booking deposit confirmed.' });

    await booking.save();

    res.status(200).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminBookings = async (req, res) => {
  try {
    const bookings = await PackerBooking.find()
      .populate('customerId', 'name phone email')
      .populate('driverId', 'name phone')
      .populate('inventory.itemId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, bookings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const assignDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;

    const booking = await PackerBooking.findById(id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    booking.driverId = driverId;
    booking.status = 'assigned';
    
    // Stub communication channel
    booking.communications = {
      proxyPhoneNumber: `+91800${Math.floor(100000 + Math.random() * 900000)}`, // Dummy proxy number
      expiry: new Date(Date.now() + 48 * 60 * 60 * 1000) // Valid for 48 hours
    };

    booking.logs.push({ status: 'Assigned', note: `Driver ${driverId} assigned.` });
    await booking.save();

    // Trigger websocket room update for this booking
    const io = req.app.get('io');
    if (io) {
      io.to(`booking_${booking._id.toString()}`).emit('booking_status_updated', {
        status: booking.status,
        log: booking.logs[booking.logs.length - 1]
      });
    }

    res.status(200).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    const booking = await PackerBooking.findById(id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    booking.status = status;
    const statusNote = note || `Status updated to ${status}`;
    booking.logs.push({ status, note: statusNote });

    await booking.save();

    // Emitting real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`booking_${booking._id.toString()}`).emit('booking_status_updated', {
        status: booking.status,
        log: booking.logs[booking.logs.length - 1]
      });
    }

    res.status(200).json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
