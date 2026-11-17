import mongoose from 'mongoose';
import Ride from '../models/Ride.js';

/**
 * Checks whether a customer is eligible for GoDelivo's daily free ride.
 * Criteria:
 * 1. Vehicle: bike, scooty, scooter
 * 2. Distance: <= 2 km (2 km ke andar)
 * 3. Limit: 1 free ride per customer per day (non-cancelled)
 *
 * @param {string|ObjectId} customerId 
 * @param {string} vehicleType 
 * @param {number} distance in km
 * @returns {Promise<{eligible: boolean, reason: string, isFreeRide: boolean, existingRideId?: string}>}
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

  // If customerId is not available (e.g. unauthenticated estimate check)
  if (!customerId) {
    return {
      eligible: true,
      isFreeRide: true,
      reason: 'Eligible for GoDelivo Daily Free Ride (Under 2km on Bike/Scooty)'
    };
  }

  // Get start and end of current local day
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Check if customer already used their 1 free ride today (excluding cancelled rides)
  const existingFreeRide = await Ride.findOne({
    'customer.customerId': customerId,
    $or: [
      { isFreeRide: true },
      { 'fare.isFreeRide': true }
    ],
    status: { $nin: ['cancelled'] },
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  if (existingFreeRide) {
    return {
      eligible: false,
      isFreeRide: false,
      reason: 'Daily free ride limit reached (1 free ride allowed per day per user)',
      existingRideId: existingFreeRide.rideId
    };
  }

  return {
    eligible: true,
    isFreeRide: true,
    reason: 'Eligible for GoDelivo Daily Free Ride (Under 2km on Bike/Scooty)'
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
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const existingRide = await Ride.findOne({
    'customer.customerId': customerId,
    $or: [
      { isFreeRide: true },
      { 'fare.isFreeRide': true }
    ],
    status: { $nin: ['cancelled'] },
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  const used = !!existingRide;
  return {
    eligible: !used,
    todayFreeRidesUsed: used ? 1 : 0,
    ridesRemainingToday: used ? 0 : 1,
    maxDistanceKm: 2.0,
    allowedVehicles: ['bike', 'scooty', 'scooter'],
    existingRide: used ? {
      rideId: existingRide.rideId,
      status: existingRide.status,
      createdAt: existingRide.createdAt
    } : null,
    message: used 
      ? 'Daily free ride already used for today (1 ride/day limit reached). Renews tomorrow!'
      : 'You have 1 FREE ride (up to 2 km) on Bike or Scooty available today!',
    sponsoredBy: 'GoDelivo',
    driverPayoutNote: 'Payment will be credited directly to the driver wallet by GoDelivo upon completion.'
  };
};
