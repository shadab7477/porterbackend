import mongoose from 'mongoose';
import Driver from '../models/Driver.js';
import DriverApplication from '../models/DriverApplication.js';
import DriverWallet from '../models/DriverWallet.js';
import Ride from '../models/Ride.js';

// ==================== DRIVER SELF-SERVICE FUNCTIONS ====================

// Toggle driver's own online status (for authenticated drivers)
export const toggleMyOnlineStatus = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude } = req.body; // Get location from request body

    const driver = await Driver.findById(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is verified
    if (!req.driver.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Driver not verified. Please complete registration and wait for verification.'
      });
    }

    // If going online, validate location is provided
    const newOnlineStatus = !driver.isOnline;

    if (newOnlineStatus) {
      // When going online, location is required
      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'Location (latitude and longitude) is required to go online'
        });
      }

      // Validate coordinates
      if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180'
        });
      }

      // Update current location when going online
      driver.currentLocation = {
        type: 'Point',
        coordinates: [longitude, latitude] // GeoJSON format: [longitude, latitude]
      };

      driver.isOnline = true;
      driver.isAvailable = true;
      driver.lastOnlineAt = new Date();
    } else {
      // Going offline - clear location or keep last known
      driver.isOnline = false;
      driver.isAvailable = false;
      driver.lastOnlineAt = null;
      // Optionally keep last known location or clear it
      // driver.currentLocation.coordinates = [0, 0];
    }

    driver.lastActive = new Date();
    await driver.save();

    // Emit socket event if needed
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:status-changed', {
        driverId: driver._id,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }

    res.status(200).json({
      success: true,
      message: `You are now ${driver.isOnline ? 'online' : 'offline'}`,
      data: {
        applicationId: driver.applicationId,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        currentLocation: driver.currentLocation,
        lastActive: driver.lastActive,
        lastOnlineAt: driver.lastOnlineAt
      }
    });
  } catch (error) {
    console.error('Error in toggleMyOnlineStatus:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle online status'
    });
  }
}

// Get driver's own online status
export const getMyOnlineStatus = async (req, res) => {
  try {
    const driverId = req.driver.id;

    const driver = await Driver.findById(driverId)
      .select('isOnline isAvailable lastActive lastOnlineAt applicationId');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        applicationId: driver.applicationId,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        lastActive: driver.lastActive,
        lastOnlineAt: driver.lastOnlineAt
      }
    });
  } catch (error) {
    console.error('Error in getMyOnlineStatus:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get online status'
    });
  }
};

// Update driver's own location
export const updateLocation = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      },
      { new: true }
    ).select('currentLocation lastActive applicationId');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Emit socket event if needed
    const io = req.app.get('io');
    if (io) {
      io.emit('driver:location-update', {
        driverId,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        applicationId: driver.applicationId,
        location: driver.currentLocation,
        lastActive: driver.lastActive
      }
    });
  } catch (error) {
    console.error('Error in updateLocation:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update location'
    });
  }
};

// Get driver's own stats
export const getDriverStats = async (req, res) => {
  try {
    const driverId = req.driver.id;

    const driver = await Driver.findById(driverId)
      .select('totalEarnings totalTrips rating isOnline isAvailable applicationId');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        applicationId: driver.applicationId,
        totalEarnings: driver.totalEarnings,
        totalTrips: driver.totalTrips,
        rating: driver.rating,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable
      }
    });
  } catch (error) {
    console.error('Error in getDriverStats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get driver stats'
    });
  }
};


// ==================== ADMIN FUNCTIONS ====================

// Get all drivers (admin only)
export const getAllDrivers = async (req, res) => {
  try {
    const {
      status,
      vehicleType,
      verificationStatus,
      isBlocked,
      dueStatus,
      search,
      sortBy = 'recent',
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    // Online / Available / Offline / Busy status
    if (status === 'available') {
      query.isOnline = true;
      query.isAvailable = true;
    } else if (status === 'busy') {
      query.isOnline = true;
      query.isAvailable = false;
    } else if (status === 'online') {
      query.isOnline = true;
    } else if (status === 'offline') {
      query.isOnline = false;
    }

    // Vehicle Type
    if (vehicleType && vehicleType !== 'all') {
      const vLower = vehicleType.trim().toLowerCase();
      if (vLower === '2_wheelers' || vLower === '2 wheelers' || vLower === '2wheeler') {
        query.vehicleType = { $regex: /bike|scoot/i };
      } else if (vLower === '3_wheelers' || vLower === '3 wheelers' || vLower === '3wheeler') {
        query.vehicleType = { $regex: /3_wheeler|auto|loader|mini_3w|3 wheeler/i };
      } else if (vLower === '4_wheelers' || vLower === '4 wheelers' || vLower === '4wheeler') {
        query.vehicleType = { $regex: /tata_ace|4_wheeler|car|truck|pickup|4 wheeler/i };
      } else {
        query.vehicleType = { $regex: new RegExp(vehicleType.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') };
      }
    }

    // Block status filter
    if (isBlocked === 'true' || isBlocked === true || isBlocked === 'blocked') {
      query.isBlocked = true;
    } else if (isBlocked === 'false' || isBlocked === false || isBlocked === 'active' || isBlocked === 'unblocked') {
      query.isBlocked = false;
    }

    // Search filter across name, phone, vehicleNumber, driverId, email
    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      query.$or = [
        { name: sRegex },
        { phone: sRegex },
        { vehicleNumber: sRegex },
        { driverId: sRegex },
        { email: sRegex }
      ];
    }

    // Fetch drivers matching base query
    const rawDrivers = await Driver.find(query).lean();

    // Collect IDs for batch lookups
    const appIds = rawDrivers.map(d => d.applicationId).filter(Boolean);
    const phones = rawDrivers.map(d => d.phone).filter(Boolean);
    const driverIds = rawDrivers.map(d => d.driverId).filter(Boolean);
    const driverObjectIds = rawDrivers.map(d => d._id);

    const orConditions = [];
    if (appIds.length > 0) orConditions.push({ _id: { $in: appIds } });
    if (phones.length > 0) orConditions.push({ phone: { $in: phones } });
    if (driverIds.length > 0) orConditions.push({ driverId: { $in: driverIds } });

    const [applications, wallets] = await Promise.all([
      orConditions.length > 0 ? DriverApplication.find({ $or: orConditions }).lean() : [],
      driverObjectIds.length > 0 ? DriverWallet.find({ driverId: { $in: driverObjectIds } }).lean() : []
    ]);

    const appMap = new Map();
    applications.forEach(app => {
      if (app._id) appMap.set(app._id.toString(), app);
      if (app.phone) appMap.set(app.phone, app);
      if (app.driverId) appMap.set(app.driverId, app);
    });

    const walletMap = new Map();
    wallets.forEach(w => {
      if (w.driverId) walletMap.set(w.driverId.toString(), w);
    });

    // Helper for due limit
    const getVehicleDueLimit = (vType) => {
      const lower = (vType || 'bike').toLowerCase();
      if (lower.includes('bike') || lower.includes('scoot')) return 300;
      return 700;
    };

    // Enrich all found drivers
    let enriched = rawDrivers.map(driver => {
      const app = (driver.applicationId && appMap.get(driver.applicationId.toString())) ||
                  appMap.get(driver.phone) ||
                  (driver.driverId && appMap.get(driver.driverId)) || null;

      const wallet = walletMap.get(driver._id.toString()) || null;
      const walletBalance = wallet ? wallet.balance : 0;
      const dueAmount = walletBalance < 0 ? Math.abs(walletBalance) : 0;
      const dueLimit = getVehicleDueLimit(driver.vehicleType);
      const isDueExceeded = dueAmount >= dueLimit;

      const vStatus = driver.verificationStatus || app?.verificationStatus || (driver.isVerified ? 'verified' : 'pending');
      const profileImage = app?.profilePhoto?.url || driver.profileImage || null;

      let computedStatus = 'offline';
      if (driver.isOnline) {
        computedStatus = driver.isAvailable ? 'online' : 'busy';
      }

      return {
        ...driver,
        _id: driver._id,
        id: driver._id,
        status: computedStatus,
        profileImage,
        profileimage: profileImage,
        verificationStatus: vStatus,
        walletBalance,
        dueAmount,
        dueLimit,
        isDueExceeded,
        todayCollection: wallet?.todayCollection || 0,
        weeklyCollection: wallet?.weeklyCollection || 0,
        totalCollection: wallet?.totalCollection || 0,
        totalEarnings: driver.totalEarnings || 0,
        totalRides: driver.totalTrips || 0,
        address: app?.address || null,
        documents: {
          license: !!(app?.drivingLicense?.url || driver.documents?.license),
          rc: !!(app?.vehicleRC?.url || driver.documents?.rc),
          aadhar: !!(app?.aadharCard?.front?.url || app?.aadharCard?.back?.url || driver.documents?.aadhar),
          pan: !!(app?.panCard?.url || driver.documents?.pan)
        }
      };
    });

    // In-memory verification filter if specified
    if (verificationStatus && verificationStatus !== 'all') {
      enriched = enriched.filter(d => d.verificationStatus === verificationStatus);
    }

    // In-memory due filter if specified
    if (dueStatus && dueStatus !== 'all') {
      if (dueStatus === 'has_due') {
        enriched = enriched.filter(d => d.dueAmount > 0);
      } else if (dueStatus === 'over_limit') {
        enriched = enriched.filter(d => d.isDueExceeded);
      } else if (dueStatus === 'no_due') {
        enriched = enriched.filter(d => d.dueAmount === 0);
      }
    }

    // Sort enriched drivers
    if (sortBy === 'earnings_desc') {
      enriched.sort((a, b) => (b.totalEarnings || 0) - (a.totalEarnings || 0));
    } else if (sortBy === 'due_desc') {
      enriched.sort((a, b) => (b.dueAmount || 0) - (a.dueAmount || 0));
    } else if (sortBy === 'trips_desc') {
      enriched.sort((a, b) => (b.totalRides || 0) - (a.totalRides || 0));
    } else if (sortBy === 'rating_desc') {
      enriched.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'name_asc') {
      enriched.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      enriched.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    // Global stats across all drivers in DB
    const allDrivers = await Driver.find({}).lean();
    const allWallets = await DriverWallet.find({}).lean();
    const allAppVerifications = await DriverApplication.find({}).select('verificationStatus phone driverId').lean();

    const appVerMap = new Map();
    allAppVerifications.forEach(a => {
      if (a.phone) appVerMap.set(a.phone, a.verificationStatus);
      if (a.driverId) appVerMap.set(a.driverId, a.verificationStatus);
    });

    const wMap = new Map();
    allWallets.forEach(w => {
      if (w.driverId) wMap.set(w.driverId.toString(), w);
    });

    let statOnline = 0;
    let statAvailable = 0;
    let statBusy = 0;
    let statOffline = 0;
    let statVerified = 0;
    let statPending = 0;
    let statRejected = 0;
    let statBlocked = 0;
    let statWithDue = 0;
    let statTotalDue = 0;
    let statTotalEarnings = 0;

    allDrivers.forEach(d => {
      if (d.isOnline) {
        statOnline++;
        if (d.isAvailable) statAvailable++;
        else statBusy++;
      } else {
        statOffline++;
      }

      if (d.isBlocked) statBlocked++;

      const vStat = d.verificationStatus || appVerMap.get(d.phone) || appVerMap.get(d.driverId) || (d.isVerified ? 'verified' : 'pending');
      if (vStat === 'verified') statVerified++;
      else if (vStat === 'rejected') statRejected++;
      else statPending++;

      const w = wMap.get(d._id.toString());
      const bal = w ? w.balance : 0;
      if (bal < 0) {
        statWithDue++;
        statTotalDue += Math.abs(bal);
      }
      statTotalEarnings += (d.totalEarnings || 0);
    });

    const stats = {
      total: allDrivers.length,
      online: statOnline,
      available: statAvailable,
      busy: statBusy,
      offline: statOffline,
      verified: statVerified,
      pending: statPending,
      rejected: statRejected,
      blocked: statBlocked,
      driversWithDue: statWithDue,
      totalDueAmount: Math.round(statTotalDue * 100) / 100,
      totalEarnings: Math.round(statTotalEarnings * 100) / 100
    };

    // Apply pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const total = enriched.length;
    const paginatedDrivers = enriched.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      data: paginatedDrivers,
      stats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (error) {
    console.error('Error in getAllDrivers:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get driver by ID (admin only)
export const getDriverById = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).lean();
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    let application = null;
    if (driver.applicationId) {
      application = await DriverApplication.findById(driver.applicationId).lean();
    }
    if (!application && driver.phone) {
      application = await DriverApplication.findOne({ phone: driver.phone }).lean();
    }
    if (!application && driver.driverId) {
      application = await DriverApplication.findOne({ driverId: driver.driverId }).lean();
    }

    const wallet = await DriverWallet.findOne({ driverId: driver._id }).lean();
    const walletBalance = wallet ? wallet.balance : 0;
    const dueAmount = walletBalance < 0 ? Math.abs(walletBalance) : 0;

    const dueLimits = { bike: 300, scooty: 300, scooter: 300, auto: 700, mini_3w: 700, e_loader: 700, car: 700, tata_ace: 700, pickup: 700, mini_truck: 700, truck: 700 };
    const vTypeKey = (driver.vehicleType || 'bike').toLowerCase();
    const dueLimit = dueLimits[vTypeKey] || 300;
    const isDueExceeded = dueAmount >= dueLimit;

    // Fetch recent 10 rides
    const recentRides = await Ride.find({
      $or: [
        { 'driver.driverId': driver._id },
        ...(driver.driverId ? [{ 'driver.driverId': driver.driverId }] : []),
        ...(driver.phone ? [{ 'driver.phone': driver.phone }] : [])
      ]
    })
      .sort({ requestedAt: -1, createdAt: -1 })
      .limit(10)
      .lean();

    const verificationStatus = driver.verificationStatus || application?.verificationStatus || (driver.isVerified ? 'verified' : 'pending');
    const profileImage = application?.profilePhoto?.url || driver.profileImage || null;

    res.json({
      success: true,
      data: {
        ...driver,
        _id: driver._id,
        id: driver._id,
        status: driver.isOnline ? (driver.isAvailable ? 'online' : 'busy') : 'offline',
        profileImage,
        verificationStatus,
        walletBalance,
        dueAmount,
        dueLimit,
        isDueExceeded,
        wallet: wallet || {
          balance: 0,
          todayCollection: 0,
          weeklyCollection: 0,
          totalCollection: 0
        },
        application: application ? {
          _id: application._id,
          fullName: application.fullName,
          phone: application.phone,
          email: application.email,
          address: application.address,
          bankDetails: application.bankDetails,
          profilePhoto: application.profilePhoto,
          aadharCard: application.aadharCard,
          drivingLicense: application.drivingLicense,
          vehicleRC: application.vehicleRC,
          panCard: application.panCard,
          verificationStatus: application.verificationStatus
        } : null,
        recentTrips: recentRides.map(r => ({
          id: r.rideId || r._id,
          rideId: r.rideId || r._id,
          date: r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : 'N/A'),
          from: r.pickupLocation?.address || 'Pickup',
          to: r.dropLocation?.address || 'Drop',
          amount: r.fare?.finalAmount || r.fare?.total || 0,
          driverEarning: r.fare?.driverEarning || 0,
          status: r.status,
          paymentMethod: r.paymentMethod,
          paymentStatus: r.paymentStatus
        }))
      }
    });
  } catch (error) {
    console.error('Error in getDriverById:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper to parse ride fare across all database schema variations (number or object)
const parseRideFare = (fare) => {
  if (typeof fare === 'number') {
    const finalAmount = Math.round(fare * 100) / 100;
    const commission = Math.round(finalAmount * 0.15 * 100) / 100;
    const driverEarning = Math.round((finalAmount - commission) * 100) / 100;
    return {
      distanceFare: finalAmount,
      total: finalAmount,
      discount: 0,
      cashbackAmount: 0,
      finalAmount,
      commissionAmount: commission,
      driverEarning,
      isMerchantRide: false,
      merchantDiscount: 0
    };
  }

  if (fare && typeof fare === 'object') {
    const finalAmount = Number(fare.finalAmount ?? fare.total ?? fare.amount ?? 0);
    const total = Number(fare.total ?? fare.finalAmount ?? fare.amount ?? 0);
    const commissionAmount = Number(
      fare.commissionAmount ?? (finalAmount > 0 ? Math.round(finalAmount * 0.15 * 100) / 100 : 0)
    );
    const driverEarning = Number(
      fare.driverEarning ?? (finalAmount > 0 ? Math.round((finalAmount - commissionAmount) * 100) / 100 : 0)
    );
    const distanceFare = Number(fare.distanceFare ?? total);
    const discount = Number(fare.discount ?? 0);
    const cashbackAmount = Number(fare.cashbackAmount ?? 0);

    return {
      distanceFare,
      total,
      discount,
      cashbackAmount,
      finalAmount,
      commissionAmount,
      driverEarning,
      isMerchantRide: !!fare.isMerchantRide,
      merchantDiscount: fare.merchantDiscount || 0
    };
  }

  return {
    distanceFare: 0,
    total: 0,
    discount: 0,
    cashbackAmount: 0,
    finalAmount: 0,
    commissionAmount: 0,
    driverEarning: 0,
    isMerchantRide: false,
    merchantDiscount: 0
  };
};

// Get driver's full ride history (admin)
export const getDriverRideHistoryForAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      search,
      startDate,
      endDate,
      paymentMethod,
      paymentStatus,
      sortBy = 'newest'
    } = req.query;

    let driver = null;
    if (mongoose.isValidObjectId(id)) {
      driver = await Driver.findById(id).lean();
    }
    if (!driver) {
      driver = await Driver.findOne({
        $or: [
          { driverId: id },
          { phone: id }
        ]
      }).lean();
    }

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Build driver matching conditions safely without CastError
    const driverConditions = [];
    if (mongoose.isValidObjectId(driver._id)) {
      driverConditions.push({ 'driver.driverId': new mongoose.Types.ObjectId(driver._id) });
    }
    if (driver.phone) {
      driverConditions.push({ 'driver.phone': driver.phone.trim() });
    }
    if (driver.vehicleNumber) {
      driverConditions.push({ 'driver.vehicleNumber': driver.vehicleNumber.trim() });
    }
    if (driverConditions.length === 0 && driver.name) {
      driverConditions.push({ 'driver.name': driver.name.trim() });
    }

    const query = {
      $or: driverConditions
    };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'active') {
        query.status = { $in: ['requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'] };
      } else if (status === 'completed') {
        query.status = 'completed';
      } else if (status === 'cancelled') {
        query.status = { $in: ['cancelled', 'no_drivers'] };
      } else {
        query.status = status;
      }
    }

    // Payment method filter
    if (paymentMethod && paymentMethod !== 'all') {
      query.paymentMethod = paymentMethod;
    }

    // Payment status filter
    if (paymentStatus && paymentStatus !== 'all') {
      query.paymentStatus = paymentStatus;
    }

    // Search filter across rideId, customer name/phone, locations, cancellation reason
    if (search && search.trim()) {
      const cleanSearch = search.trim();
      const sRegex = new RegExp(cleanSearch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { rideId: sRegex },
          { 'customer.name': sRegex },
          { 'customer.phone': sRegex },
          { 'pickupLocation.address': sRegex },
          { 'dropLocation.address': sRegex },
          { cancellationReason: sRegex }
        ]
      });
    }

    // Date range
    if (startDate || endDate) {
      const dateCondition = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateCondition.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateCondition.$lte = e;
      }
      query.requestedAt = dateCondition;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // Sort order
    let sortObj = { requestedAt: -1, createdAt: -1 };
    if (sortBy === 'oldest') {
      sortObj = { requestedAt: 1, createdAt: 1 };
    } else if (sortBy === 'fare_high') {
      sortObj = { 'fare.finalAmount': -1, fare: -1 };
    } else if (sortBy === 'fare_low') {
      sortObj = { 'fare.finalAmount': 1, fare: 1 };
    } else if (sortBy === 'distance_high') {
      sortObj = { distance: -1 };
    }

    // MongoDB aggregation expressions supporting both number fares and object fares
    const fareAmountExpr = {
      $cond: [
        { $isNumber: '$fare' },
        '$fare',
        { $ifNull: ['$fare.finalAmount', { $ifNull: ['$fare.total', 0] }] }
      ]
    };

    const driverEarningExpr = {
      $cond: [
        { $isNumber: '$fare' },
        { $multiply: ['$fare', 0.85] },
        {
          $ifNull: [
            '$fare.driverEarning',
            {
              $multiply: [
                { $ifNull: ['$fare.finalAmount', { $ifNull: ['$fare.total', 0] }] },
                0.85
              ]
            }
          ]
        }
      ]
    };

    const commissionExpr = {
      $cond: [
        { $isNumber: '$fare' },
        { $multiply: ['$fare', 0.15] },
        {
          $ifNull: [
            '$fare.commissionAmount',
            {
              $multiply: [
                { $ifNull: ['$fare.finalAmount', { $ifNull: ['$fare.total', 0] }] },
                0.15
              ]
            }
          ]
        }
      ]
    };

    const [rides, total, statsAggregation] = await Promise.all([
      Ride.find(query)
        .sort(sortObj)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Ride.countDocuments(query),
      Ride.aggregate([
        { $match: { $or: driverConditions } },
        {
          $group: {
            _id: null,
            totalRides: { $sum: 1 },
            completedRides: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            cancelledRides: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'no_drivers']] }, 1, 0] } },
            activeRides: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress']] },
                  1,
                  0
                ]
              }
            },
            totalFare: { $sum: fareAmountExpr },
            totalDriverEarnings: { $sum: driverEarningExpr },
            totalCommission: { $sum: commissionExpr },
            cashCollections: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'completed'] }, { $eq: ['$paymentMethod', 'cash'] }] },
                  fareAmountExpr,
                  0
                ]
              }
            },
            onlineEarnings: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'completed'] }, { $ne: ['$paymentMethod', 'cash'] }] },
                  driverEarningExpr,
                  0
                ]
              }
            }
          }
        }
      ]).catch(() => [])
    ]);

    const stats = statsAggregation[0] || {
      totalRides: 0,
      completedRides: 0,
      cancelledRides: 0,
      activeRides: 0,
      totalFare: 0,
      totalDriverEarnings: 0,
      totalCommission: 0,
      cashCollections: 0,
      onlineEarnings: 0
    };

    res.json({
      success: true,
      data: {
        driver: {
          id: driver._id,
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          rating: driver.rating
        },
        rides: rides.map(r => {
          const parsedFare = parseRideFare(r.fare);
          return {
            ...r,
            id: r._id,
            rideId: r.rideId || r._id.toString(),
            date: r.requestedAt || r.createdAt,
            distanceText: r.routeInfo?.distanceText || `${r.distance || 0} km`,
            durationText: r.routeInfo?.durationText || `${r.duration || 0} mins`,
            fare: parsedFare,
            fareFinal: parsedFare.finalAmount,
            driverEarning: parsedFare.driverEarning,
            commission: parsedFare.commissionAmount,
            pickupAddress: r.pickupLocation?.address || 'Pickup location',
            dropAddress: r.dropLocation?.address || (r.dropLocations?.[0]?.address) || 'Drop location',
            customerName: r.customer?.name || 'Customer',
            customerPhone: r.customer?.phone || 'N/A',
            customerRating: r.customer?.rating || 0,
            statusHistory: r.statusHistory || [],
            cancellationReason: r.cancellationReason || '',
            cancelledBy: r.cancelledBy || '',
            paymentMethod: r.paymentMethod || 'cash',
            paymentStatus: r.paymentStatus || 'pending'
          };
        }),
        stats,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum) || 1
        }
      }
    });
  } catch (error) {
    console.error('Error in getDriverRideHistoryForAdmin:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch driver rides'
    });
  }
};


// Create driver (admin only)
export const createDriver = async (req, res) => {
  try {
    const driver = new Driver(req.body);
    await driver.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:created', driver);
    }

    res.status(201).json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Error in createDriver:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Update driver (admin only)
export const updateDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:updated', driver);
    }

    res.json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Error in updateDriver:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Delete driver (soft delete - admin only)
export const deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isActive: false, isOnline: false, isAvailable: false },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:deleted', { id: req.params.id });
    }

    res.json({
      success: true,
      message: 'Driver deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteDriver:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update driver location (admin only)
export const updateDriverLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        }
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:location-update', {
        driverId: driver._id,
        location: driver.currentLocation,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Error in updateDriverLocation:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Update driver availability (admin only)
export const updateDriverAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isAvailable },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:availability-change', {
        driverId: driver._id,
        isAvailable,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Error in updateDriverAvailability:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get available drivers (public)
export const getAvailableDrivers = async (req, res) => {
  try {
    const { vehicleType, latitude, longitude, radius = 15000 } = req.query;

    const query = {
      isActive: true,
      isOnline: true,
      isAvailable: true,
      isBlocked: false,
      verificationStatus: 'verified'
    };

    if (vehicleType) query.vehicleType = vehicleType;

    let drivers;

    if (latitude && longitude) {
      drivers = await Driver.find({
        ...query,
        currentLocation: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(longitude), parseFloat(latitude)]
            },
            $maxDistance: parseInt(radius)
          }
        }
      }).select('-__v');
    } else {
      drivers = await Driver.find(query).select('-__v');
    }

    res.json({
      success: true,
      data: drivers
    });
  } catch (error) {
    console.error('Error in getAvailableDrivers:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Submit documents for verification (driver self-service)
export const submitForVerification = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { documents } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        verificationStatus: 'under_review',
        documents: documents,
        submittedAt: new Date()
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:verification-submitted', {
        driverId: driver._id,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: 'Documents submitted for verification'
    });
  } catch (error) {
    console.error('Error in submitForVerification:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Verify driver (admin only)
export const verifyDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'verified',
        isVerified: true,
        verifiedAt: new Date(),
        verifiedBy: req.admin?.id || req.admin?._id
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:verified', {
        driverId: driver._id,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: 'Driver verified successfully'
    });
  } catch (error) {
    console.error('Error in verifyDriver:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Reject driver verification (admin only)
export const rejectDriver = async (req, res) => {
  try {
    const { reason } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'rejected',
        isVerified: false,
        rejectionReason: reason,
        verifiedBy: req.admin?.id || req.admin?._id
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:rejected', {
        driverId: driver._id,
        reason,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: 'Driver verification rejected'
    });
  } catch (error) {
    console.error('Error in rejectDriver:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get pending verifications (admin only)
export const getPendingVerifications = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const query = {
      verificationStatus: { $in: ['pending', 'under_review'] }
    };
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const drivers = await Driver.find(query)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ submittedAt: -1 });

    const total = await Driver.countDocuments(query);

    res.json({
      success: true,
      data: drivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in getPendingVerifications:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Toggle driver block status (admin only)
export const toggleBlockDriver = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const { isBlocked, reason } = req.body || {};
    if (typeof isBlocked === 'boolean') {
      driver.isBlocked = isBlocked;
    } else {
      driver.isBlocked = !driver.isBlocked;
    }

    if (driver.isBlocked) {
      driver.isOnline = false;
      driver.isAvailable = false;
      driver.blockReason = reason || 'Blocked by administrator';
    } else {
      driver.blockReason = null;
    }
    await driver.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:block-status-changed', {
        driverId: driver._id,
        isBlocked: driver.isBlocked,
        reason: driver.blockReason,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: `Driver ${driver.isBlocked ? 'blocked' : 'unblocked'} successfully`
    });
  } catch (error) {
    console.error('Error in toggleBlockDriver:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Update driver documents (admin only)
export const updateDriverDocuments = async (req, res) => {
  try {
    const { documents } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { documents },
      { new: true, runValidators: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:documents-updated', {
        driverId: driver._id,
        documents: driver.documents,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: 'Documents updated successfully'
    });
  } catch (error) {
    console.error('Error in updateDriverDocuments:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Toggle driver active status (admin only)
export const toggleDriverActive = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    driver.isOnline = !driver.isOnline;
    driver.isAvailable = driver.isOnline;
    driver.lastOnlineAt = driver.isOnline ? null : new Date();
    await driver.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:active-status-changed', {
        driverId: driver._id,
        isOnline: driver.isOnline,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: driver,
      message: driver.isOnline ? 'Driver is now online' : 'Driver is now offline'
    });
  } catch (error) {
    console.error('Error in toggleDriverActive:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Add these functions to your existing driverController.js

// Update driver location with socket broadcast


// Helper function to find nearby customers
async function findNearbyCustomers(latitude, longitude, radius) {
  try {
    // Find rides that are searching for drivers
    const Ride = (await import('../models/Ride.js')).default;
    const searchingRides = await Ride.find({
      status: 'searching',
      'customer.customerId': { $exists: true }
    }).populate('customer.customerId');

    const nearbyCustomers = [];

    for (const ride of searchingRides) {
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      const distance = calculateDistance(latitude, longitude, pickupLat, pickupLon);

      if (distance <= radius) {
        nearbyCustomers.push({
          customerId: ride.customer.customerId,
          rideId: ride.rideId,
          distance,
          pickupLocation: ride.pickupLocation
        });
      }
    }

    return nearbyCustomers;
  } catch (error) {
    console.error('Error finding nearby customers:', error);
    return [];
  }
};
