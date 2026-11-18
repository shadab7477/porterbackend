import mongoose from 'mongoose';
import Ride from '../models/Ride.js';
import Customer from '../models/Customer.js';

/**
 * Calculates start and end of current day in Indian Standard Time (IST = UTC+5:30)
 * Ensures midnight-to-midnight accuracy regardless of server timezone.
 */
export const getISTDayRange = () => {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);

  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const date = istNow.getUTCDate();

  const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0) - istOffsetMs);
  const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - istOffsetMs);

  return { startOfDay, endOfDay };
};

/**
 * Checks whether a customer is eligible for GoDelivo's daily free ride.
 * Strict Criteria:
 * 1. Vehicle: bike, scooty, scooter
 * 2. Distance: <= 2.0 km (under 2 km)
 * 3. Limit: Strictly 1 FREE RIDE per user per calendar day (shared across Bike AND Scooty).
 *    Once a user uses a free ride on Bike, they CANNOT use it on Scooty (or vice versa).
 *
 * @param {string|ObjectId} customerId 
 * @param {string} vehicleType 
 * @param {number} distance in km
 * @returns {Promise<{eligible: boolean, reason: string, isFreeRide: boolean, existingRideId?: string, usedVehicle?: string}>}
 */
export const checkDailyFreeRideEligibility = async (customerId, vehicleType, distance) => {
  const vType = (vehicleType || '').toLowerCase().trim();
  const isTwoWheeler = ['bike', 'scooty', 'scooter'].includes(vType);
  const numericDistance = parseFloat(distance) || 0;
  const isUnder2Km = numericDistance > 0 && numericDistance <= 2.0;

  if (!isTwoWheeler) {
    return {
      eligible: false,
      isFreeRide: false,
      reason: 'Free ride is only available on Bike and Scooty'
    };
  }

  if (!isUnder2Km) {
    return {
      eligible: false,
      isFreeRide: false,
      reason: 'Free ride is only available for rides up to 2 km'
    };
  }

  // If customerId is not available (e.g. unauthenticated public estimate check)
  if (!customerId) {
    return {
      eligible: true,
      isFreeRide: true,
      reason: 'Eligible for GoDelivo Daily Free Ride (Under 2km on Bike/Scooty, 1 ride/day/user limit applies)',
      dailyLimit: 1
    };
  }

  const custObjId = mongoose.Types.ObjectId.isValid(customerId)
    ? new mongoose.Types.ObjectId(customerId)
    : null;

  // Fetch phone to prevent bypass via duplicate IDs
  let customerPhone = null;
  try {
    if (custObjId) {
      const custDoc = await Customer.findById(custObjId).select('phone').lean();
      customerPhone = custDoc?.phone;
    }
  } catch (e) {}

  const customerFilters = [];
  if (custObjId) {
    customerFilters.push({ 'customer.customerId': custObjId });
    customerFilters.push({ 'customer.customerId': custObjId.toString() });
  } else if (customerId) {
    customerFilters.push({ 'customer.customerId': customerId });
  }
  if (customerPhone) {
    customerFilters.push({ 'customer.phone': customerPhone });
  }

  const { startOfDay, endOfDay } = getISTDayRange();

  // Check if customer already used their 1 free ride today (shared across Bike & Scooty)
  // Non-cancelled rides where:
  // - isFreeRide: true OR
  // - fare.isFreeRide: true OR
  // - paymentMethod is 'free' or 'free_ride'
  const existingFreeRide = await Ride.findOne({
    $or: customerFilters,
    $and: [
      {
        $or: [
          { isFreeRide: true },
          { 'fare.isFreeRide': true },
          { paymentMethod: 'free' },
          { paymentMethod: 'free_ride' }
        ]
      },
      {
        status: { $nin: ['cancelled'] }
      },
      {
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      }
    ]
  }).sort({ createdAt: -1 });

  if (existingFreeRide) {
    const usedVehicle = existingFreeRide.requestedVehicleType || existingFreeRide.vehicleType || 'two-wheeler';
    return {
      eligible: false,
      isFreeRide: false,
      reason: `Daily free ride limit reached. You already took your 1 free ride for today (${usedVehicle} - #${existingFreeRide.rideId}). Only 1 free ride per user per day is allowed across Bike or Scooty.`,
      existingRideId: existingFreeRide.rideId,
      usedVehicle
    };
  }

  return {
    eligible: true,
    isFreeRide: true,
    reason: 'Eligible for GoDelivo Daily Free Ride (Under 2km on Bike/Scooty)',
    dailyLimit: 1
  };
};

/**
 * Applies GoDelivo Free Ride offer to a calculated fare object.
 * Customer pays ₹0, and GoDelivo sponsors the full driver payout upon completion.
 *
 * @param {object} standardFare Calculated standard fare object
 * @returns {object} Updated fare object with free ride discount and metadata
 */
export const applyFreeRideToFare = (standardFare) => {
  const originalFinalAmount = standardFare.finalAmount || standardFare.total || 0;
  const originalTotal = standardFare.total || originalFinalAmount;
  
  // The full ride amount GoDelivo will credit to driver wallet upon completion
  // Driver receives full base fare / total distance amount (no platform commission deducted)
  const driverPayoutAmount = standardFare.distanceFare || standardFare.baseFareAmount || standardFare.total || originalFinalAmount;

  const fareCopy = { ...standardFare };

  fareCopy.isFreeRide = true;
  fareCopy.freeRideType = 'daily_free_2km';
  fareCopy.freeRideDiscount = originalFinalAmount;
  fareCopy.discount = originalFinalAmount;
  fareCopy.customerPayable = 0;
  fareCopy.finalAmount = 0; // Customer pays ₹0!
  fareCopy.sponsoredBy = 'GoDelivo';
  fareCopy.driverPayoutAmount = driverPayoutAmount;
  fareCopy.driverPaymentNote = `GoDelivo will credit this ride payment (₹${driverPayoutAmount}) directly to your wallet upon completion.`;
  fareCopy.customerNote = '100% Free Ride (GoDelivo Daily Offer - Under 2km on Bike/Scooty)';

  // Keep original values for transparency and auditing
  fareCopy.originalFare = {
    total: originalTotal,
    finalAmount: originalFinalAmount,
    distanceFare: standardFare.distanceFare,
    platformFee: standardFare.platformFee
  };

  // Enhance breakdown object for mobile/web app displays
  fareCopy.breakdown = {
    ...(standardFare.breakdown || {}),
    originalTotal: `₹${originalFinalAmount}`,
    freeRideOffer: '100% Free (GoDelivo Daily Offer - Under 2km on Bike/Scooty)',
    discount: `-₹${originalFinalAmount} (GoDelivo Free Ride)`,
    customerPayable: '₹0',
    sponsoredBy: 'GoDelivo (Payment will be credited to driver wallet upon completion)',
    driverPayout: `₹${driverPayoutAmount}`,
    total: '₹0'
  };

  return fareCopy;
};

/**
 * Returns summary of customer daily free ride availability for dashboard/banner.
 *
 * @param {string|ObjectId} customerId 
 * @returns {Promise<object>}
 */
export const getCustomerDailyFreeRideStatus = async (customerId) => {
  const custObjId = mongoose.Types.ObjectId.isValid(customerId)
    ? new mongoose.Types.ObjectId(customerId)
    : null;

  let customerPhone = null;
  try {
    if (custObjId) {
      const custDoc = await Customer.findById(custObjId).select('phone').lean();
      customerPhone = custDoc?.phone;
    }
  } catch (e) {}

  const customerFilters = [];
  if (custObjId) {
    customerFilters.push({ 'customer.customerId': custObjId });
    customerFilters.push({ 'customer.customerId': custObjId.toString() });
  } else if (customerId) {
    customerFilters.push({ 'customer.customerId': customerId });
  }
  if (customerPhone) {
    customerFilters.push({ 'customer.phone': customerPhone });
  }

  const { startOfDay, endOfDay } = getISTDayRange();

  const existingRide = await Ride.findOne({
    $or: customerFilters,
    $and: [
      {
        $or: [
          { isFreeRide: true },
          { 'fare.isFreeRide': true },
          { paymentMethod: 'free' },
          { paymentMethod: 'free_ride' }
        ]
      },
      {
        status: { $nin: ['cancelled'] }
      },
      {
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      }
    ]
  }).sort({ createdAt: -1 });

  const used = !!existingRide;
  return {
    eligible: !used,
    todayFreeRidesUsed: used ? 1 : 0,
    ridesRemainingToday: used ? 0 : 1,
    totalDailyFreeRideLimit: 1,
    sharedAcrossVehicles: ['bike', 'scooty', 'scooter'],
    maxDistanceKm: 2.0,
    existingRide: used ? {
      rideId: existingRide.rideId,
      status: existingRide.status,
      vehicleType: existingRide.requestedVehicleType || existingRide.vehicleType,
      createdAt: existingRide.createdAt
    } : null,
    message: used 
      ? `Daily free ride already used today (${existingRide.requestedVehicleType || existingRide.vehicleType || 'Bike/Scooty'} - #${existingRide.rideId}). Limit is 1 free ride per day across Bike or Scooty. Renews tomorrow!`
      : 'You have 1 FREE ride (up to 2 km) available today on Bike or Scooty!',
    sponsoredBy: 'GoDelivo',
    driverPayoutNote: 'Payment will be credited directly to the driver wallet by GoDelivo upon completion.'
  };
};

export default {
  getISTDayRange,
  checkDailyFreeRideEligibility,
  applyFreeRideToFare,
  getCustomerDailyFreeRideStatus
};
