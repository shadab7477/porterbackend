import Razorpay from 'razorpay';
import crypto from 'crypto';
import DriverApplication from '../models/DriverApplication.js';
import Vehicle from '../models/Vehicle.js';

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || 'rzp_live_ST0TZQUt1IwsqU',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX',
});

// ─── GET SUBSCRIPTION FEE ────────────────────────────────────────────────────
// GET /api/driver/subscription/fee?vehicleType=bike
export const getSubscriptionFee = async (req, res) => {
  try {
    const { vehicleType } = req.query;

    if (!vehicleType) {
      return res.status(400).json({ success: false, message: 'vehicleType query param is required' });
    }

    // Case-insensitive search for the vehicle type
    const vehicle = await Vehicle.findOne({
      vehicleType: { $regex: new RegExp(`^${vehicleType}$`, 'i') }
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: `No vehicle found for type "${vehicleType}". Subscription fee cannot be determined.`
      });
    }

    return res.json({
      success: true,
      data: {
        vehicleType: vehicle.vehicleType,
        vehicleName: vehicle.name,
        subscriptionFee: vehicle.subscriptionFee ?? 0,
      }
    });
  } catch (error) {
    console.error('getSubscriptionFee error:', error);
    res.status(500).json({ success: false, message: 'Failed to get subscription fee' });
  }
};

// ─── CREATE SUBSCRIPTION ORDER ───────────────────────────────────────────────
// POST /api/driver/subscription/create-order
// Body: { applicationId }
// Auth: driverAuthMiddleware (token from OTP → register flow)
export const createSubscriptionOrder = async (req, res) => {
  try {
    const { applicationId } = req.body;
    const phone = req.driver?.phone;

    if (!applicationId) {
      return res.status(400).json({ success: false, message: 'applicationId is required' });
    }

    // Find application — must belong to the calling driver's phone
    const application = await DriverApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Driver application not found' });
    }

    if (phone && application.phone !== phone) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Already paid — return existing order details
    if (application.subscriptionPayment?.status === 'completed') {
      return res.json({
        success: true,
        alreadyPaid: true,
        message: 'Subscription fee already paid',
        data: {
          subscriptionFee: application.subscriptionPayment.amount,
          paidAt: application.subscriptionPayment.paidAt,
        }
      });
    }

    // Look up subscription fee from Vehicle model using driver's vehicleType
    const vehicleType = application.vehicleType;
    if (!vehicleType) {
      return res.status(400).json({ success: false, message: 'Vehicle type not found in application' });
    }

    const vehicle = await Vehicle.findOne({
      vehicleType: { $regex: new RegExp(`^${vehicleType}$`, 'i') }
    });

    const subscriptionFee = vehicle?.subscriptionFee ?? 0;

    if (subscriptionFee <= 0) {
      // No fee required — mark as completed immediately
      application.subscriptionPayment = {
        status: 'completed',
        amount: 0,
        paidAt: new Date(),
        razorpayOrderId: null,
        razorpayPaymentId: null,
      };
      await application.save();

      return res.json({
        success: true,
        noPaymentRequired: true,
        message: 'No subscription fee required for this vehicle type',
        data: { subscriptionFee: 0 }
      });
    }

    // Create Razorpay order
    const amountInPaise = Math.round(subscriptionFee * 100);
    const receipt = `sub_${application._id.toString().slice(-10)}_${Date.now().toString().slice(-6)}`;

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: receipt.substring(0, 40),
      payment_capture: 1,
      notes: {
        type: 'driver_subscription',
        applicationId: application._id.toString(),
        driverPhone: application.phone,
        vehicleType,
        driverName: application.fullName,
      }
    });

    console.log(`✅ Driver subscription order created: ${order.id} for ₹${subscriptionFee} (${application.phone})`);

    // Store pending order on application
    application.subscriptionPayment = {
      status: 'pending',
      razorpayOrderId: order.id,
      amount: subscriptionFee,
      paidAt: null,
      razorpayPaymentId: null,
    };
    await application.save();

    return res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,           // paise
        amountInRupees: subscriptionFee,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_ST0TZQUt1IwsqU',
        driverName: application.fullName,
        driverPhone: application.phone,
        vehicleType,
        applicationId: application._id,
      }
    });
  } catch (error) {
    console.error('createSubscriptionOrder error:', error);
    res.status(500).json({ success: false, message: 'Failed to create subscription order' });
  }
};

// ─── VERIFY SUBSCRIPTION PAYMENT ─────────────────────────────────────────────
// POST /api/driver/subscription/verify
// Body: { applicationId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const verifySubscriptionPayment = async (req, res) => {
  try {
    const { applicationId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const phone = req.driver?.phone;

    if (!applicationId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'applicationId, razorpay_order_id, razorpay_payment_id and razorpay_signature are required'
      });
    }

    const application = await DriverApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Driver application not found' });
    }

    if (phone && application.phone !== phone) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Verify that the order ID matches what we created
    if (application.subscriptionPayment?.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ success: false, message: 'Order ID mismatch' });
    }

    // Verify Razorpay signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'OZdye2d48zaLY1gSko96eJsX')
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      application.subscriptionPayment.status = 'failed';
      await application.save();
      return res.status(400).json({ success: false, message: 'Payment verification failed — invalid signature' });
    }

    // Mark subscription as paid
    application.subscriptionPayment.status = 'completed';
    application.subscriptionPayment.razorpayPaymentId = razorpay_payment_id;
    application.subscriptionPayment.paidAt = new Date();
    await application.save();

    console.log(`✅ Driver subscription payment verified for ${application.phone} — ₹${application.subscriptionPayment.amount}`);

    return res.json({
      success: true,
      message: 'Subscription payment verified successfully! Your application is under review.',
      data: {
        applicationId: application._id,
        driverId: application.driverId,
        phone: application.phone,
        subscriptionFee: application.subscriptionPayment.amount,
        paidAt: application.subscriptionPayment.paidAt,
        verificationStatus: application.verificationStatus,
      }
    });
  } catch (error) {
    console.error('verifySubscriptionPayment error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify subscription payment' });
  }
};

// ─── GET SUBSCRIPTION STATUS ─────────────────────────────────────────────────
// GET /api/driver/subscription/status/:applicationId
export const getSubscriptionStatus = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const phone = req.driver?.phone;

    const application = await DriverApplication.findById(applicationId)
      .select('phone subscriptionPayment verificationStatus driverId fullName vehicleType');

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    if (phone && application.phone !== phone) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    return res.json({
      success: true,
      data: {
        applicationId: application._id,
        driverId: application.driverId,
        subscriptionPayment: application.subscriptionPayment,
        verificationStatus: application.verificationStatus,
      }
    });
  } catch (error) {
    console.error('getSubscriptionStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to get subscription status' });
  }
};
