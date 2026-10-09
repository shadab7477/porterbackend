/**
 * GoDelivo - Centralized Waiting Charge Calculator & Vehicle Pricing Configuration
 * 
 * Rules:
 * 1. 2 Wheeler: First 30 minutes free; thereafter ₹2 per chargeable minute.
 * 2. 4 Wheeler: First 60 minutes free; thereafter ₹3 per chargeable minute.
 * 3. All other vehicles: First 60 minutes free; thereafter ₹3 per chargeable minute.
 * 
 * Exclusion Policy:
 * - Traveling time between pickup departure and destination arrival is STRICTLY EXCLUDED.
 * - Eligible waiting time is counted only at Pickup (driver_arrived until trip start)
 *   and Destination (destination arrival until ride completion).
 * 
 * Audit Trail & Settlement Policy:
 * - Waiting charges are added to customer's final ride fare.
 * - Waiting charges are NOT separately credited to driver's wallet or driver earnings.
 * - Idempotent recalculation ensures charges are added exactly once.
 */

// Vehicle Category / Type to Waiting Pricing Rule Configuration
export const WAITING_CHARGE_CONFIG = {
  '2_wheeler': {
    freeMinutes: 30,
    ratePerMinute: 2,
    label: '2 Wheeler',
    aliases: ['bike', 'scooter', 'scooty', '2_wheeler', '2wheeler', '2 wheelers', '2-wheeler']
  },
  '4_wheeler': {
    freeMinutes: 60,
    ratePerMinute: 3,
    label: '4 Wheeler',
    aliases: [
      'car', '4_wheeler', '4wheeler', '4 wheelers', '4-wheeler',
      'tata_ace', 'tata ace', 'pickup_8ft', 'pickup', 'mini_truck',
      'truck', 'bolero_pickup', 'champion'
    ]
  },
  'other': {
    freeMinutes: 60,
    ratePerMinute: 3,
    label: 'Other Vehicles',
    aliases: ['auto', 'mini_3w', '3_wheeler', '3wheeler', '3 wheelers', 'e_loader', 'electric_3w', 'other']
  }
};

/**
 * Resolves the waiting charge rule based on vehicle type and category.
 * @param {string} vehicleType 
 * @param {string} category 
 * @returns {{ vehicleTypeKey: string, freeMinutes: number, ratePerMinute: number, label: string }}
 */
export const getVehicleWaitingRule = (vehicleType = '', category = '') => {
  const vType = (vehicleType || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const cat = (category || '').toLowerCase().trim();

  // Check 2 Wheeler
  if (
    WAITING_CHARGE_CONFIG['2_wheeler'].aliases.some(alias => alias.replace(/[\s-]+/g, '_') === vType) ||
    cat.includes('2') ||
    vType.includes('bike') ||
    vType.includes('scoot')
  ) {
    return {
      vehicleTypeKey: '2_wheeler',
      freeMinutes: WAITING_CHARGE_CONFIG['2_wheeler'].freeMinutes,
      ratePerMinute: WAITING_CHARGE_CONFIG['2_wheeler'].ratePerMinute,
      label: WAITING_CHARGE_CONFIG['2_wheeler'].label
    };
  }

  // Check 4 Wheeler
  if (
    WAITING_CHARGE_CONFIG['4_wheeler'].aliases.some(alias => alias.replace(/[\s-]+/g, '_') === vType) ||
    cat.includes('4') ||
    vType.includes('car') ||
    vType.includes('truck') ||
    vType.includes('tata') ||
    vType.includes('pickup')
  ) {
    return {
      vehicleTypeKey: '4_wheeler',
      freeMinutes: WAITING_CHARGE_CONFIG['4_wheeler'].freeMinutes,
      ratePerMinute: WAITING_CHARGE_CONFIG['4_wheeler'].ratePerMinute,
      label: WAITING_CHARGE_CONFIG['4_wheeler'].label
    };
  }

  // All other vehicles default to 60 free minutes, ₹3/minute
  return {
    vehicleTypeKey: vType || 'other',
    freeMinutes: WAITING_CHARGE_CONFIG['other'].freeMinutes,
    ratePerMinute: WAITING_CHARGE_CONFIG['other'].ratePerMinute,
    label: WAITING_CHARGE_CONFIG['other'].label
  };
};

/**
 * Calculates waiting charges, duration breakdown, and comprehensive audit trail details.
 * 
 * @param {Object} params
 * @param {string} params.vehicleType
 * @param {string} [params.category]
 * @param {Date|string|number} [params.driverArrivedAt] Pickup arrival timestamp
 * @param {Date|string|number} [params.rideStartedAt] Pickup departure / Trip start timestamp
 * @param {Date|string|number} [params.destinationArrivedAt] Destination arrival timestamp
 * @param {Date|string|number} [params.rideCompletedAt] Ride completion timestamp
 * @param {Date|string|number} [params.currentTimestamp] Current evaluation timestamp (for in-progress trips)
 * @returns {Object} Complete waiting charge calculation and audit trail metadata
 */
export const calculateWaitingCharge = ({
  vehicleType = 'car',
  category = '',
  driverArrivedAt = null,
  rideStartedAt = null,
  destinationArrivedAt = null,
  rideCompletedAt = null,
  currentTimestamp = new Date()
} = {}) => {
  const rule = getVehicleWaitingRule(vehicleType, category);
  const { freeMinutes, ratePerMinute, vehicleTypeKey } = rule;
  const evalTime = currentTimestamp ? new Date(currentTimestamp).getTime() : Date.now();

  // 1. Pickup waiting time:
  // Timer starts when driver arrives at pickup (driver_arrived)
  // Timer stops when driver leaves pickup and starts journey (rideStartedAt)
  let pickupWaitingSeconds = 0;
  if (driverArrivedAt) {
    const pickupStart = new Date(driverArrivedAt).getTime();
    const pickupEnd = rideStartedAt ? new Date(rideStartedAt).getTime() : evalTime;
    if (pickupEnd > pickupStart) {
      pickupWaitingSeconds = Math.floor((pickupEnd - pickupStart) / 1000);
    }
  }

  // 2. Destination waiting time:
  // Timer starts when driver arrives at destination (destinationArrivedAt)
  // Timer stops when ride is completed (rideCompletedAt)
  // Note: Traveling time (rideStartedAt -> destinationArrivedAt) is NEVER included.
  let destinationWaitingSeconds = 0;
  if (destinationArrivedAt) {
    const destStart = new Date(destinationArrivedAt).getTime();
    const destEnd = rideCompletedAt ? new Date(rideCompletedAt).getTime() : evalTime;
    if (destEnd > destStart) {
      destinationWaitingSeconds = Math.floor((destEnd - destStart) / 1000);
    }
  }

  // Precision convention: whole minutes calculated per location
  const pickupWaitingMinutes = Math.floor(pickupWaitingSeconds / 60);
  const destinationWaitingMinutes = Math.floor(destinationWaitingSeconds / 60);

  const totalEligibleWaitingSeconds = pickupWaitingSeconds + destinationWaitingSeconds;
  const totalEligibleWaitingMinutes = pickupWaitingMinutes + destinationWaitingMinutes;

  // Apply free-time allowance once per ride cumulatively
  const chargeableMinutes = Math.max(0, totalEligibleWaitingMinutes - freeMinutes);
  const chargeAmount = chargeableMinutes * ratePerMinute;

  // Per-location breakdown of charges
  const pickupChargeableMinutes = Math.max(0, pickupWaitingMinutes - freeMinutes);
  const pickupWaitingCharge = pickupChargeableMinutes * ratePerMinute;

  const remainingFreeMinutes = Math.max(0, freeMinutes - pickupWaitingMinutes);
  const destinationChargeableMinutes = Math.max(0, destinationWaitingMinutes - remainingFreeMinutes);
  const destinationWaitingCharge = destinationChargeableMinutes * ratePerMinute;
  const totalWaitingCharge = pickupWaitingCharge + destinationWaitingCharge; // Matches chargeAmount

  // Determine charge sources
  const chargeSource = [];
  if (pickupWaitingCharge > 0) chargeSource.push('pickup');
  if (destinationWaitingCharge > 0) chargeSource.push('destination');

  // Reason description
  let calculationReason = '';
  if (totalWaitingCharge > 0) {
    calculationReason = `Pickup loading (${pickupWaitingMinutes} mins) and destination unloading (${destinationWaitingMinutes} mins) waiting time (${totalEligibleWaitingMinutes} mins total) exceeded the permitted free time (${freeMinutes} mins) by ${chargeableMinutes} chargeable mins at ₹${ratePerMinute}/min`;
  } else if (totalEligibleWaitingMinutes > 0) {
    calculationReason = `Eligible waiting time (${totalEligibleWaitingMinutes} mins: ${pickupWaitingMinutes}m pickup + ${destinationWaitingMinutes}m destination) is within the permitted free time allowance of ${freeMinutes} mins (₹0 charge)`;
  } else {
    calculationReason = `No eligible waiting time recorded within free time allowance (${freeMinutes} mins)`;
  }

  return {
    vehicleType: vehicleTypeKey,
    freeMinutes,
    ratePerMinute,
    pickupWaitingSeconds,
    destinationWaitingSeconds,
    pickupWaitingMinutes,
    destinationWaitingMinutes,
    totalEligibleWaitingSeconds,
    totalEligibleWaitingMinutes,
    chargeableMinutes,
    chargeAmount: totalWaitingCharge,
    pickupWaitingCharge,
    destinationWaitingCharge,
    totalWaitingCharge,
    currency: 'INR',
    calculationReason,
    chargeSource,
    travelingTimeExcluded: true,
    driverWalletCredit: 0,
    settlementType: 'customer_fare_platform_component',
    calculationVersion: 1,
    calculatedAt: new Date()
  };
};

import PRICING_CONFIG from '../config/pricingConfig.js';

/**
 * Idempotently computes and applies waiting charges onto a ride's fare structure.
 * Incorporates Base Fare + Total Waiting Charge + Platform Fee (₹1).
 * 
 * @param {Object} ride
 * @param {Object} [overrideCalculation]
 * @returns {Object} Updated fare and waiting details
 */
export const applyWaitingChargeToRide = (ride, overrideCalculation = null) => {
  if (!ride) return null;

  const vehicleType = ride.requestedVehicleType || ride.driver?.vehicleType || 'car';
  const calculation = overrideCalculation || calculateWaitingCharge({
    vehicleType,
    driverArrivedAt: ride.driverArrivedAt,
    rideStartedAt: ride.rideStartedAt,
    destinationArrivedAt: ride.destinationArrivedAt,
    rideCompletedAt: ride.rideCompletedAt
  });

  // Ensure baseFareAmount is preserved as the original ride fare
  if (!ride.fare) {
    ride.fare = { total: 0, finalAmount: 0 };
  }

  const platformFee = (ride.fare.platformFee !== undefined && ride.fare.platformFee !== null)
    ? Number(ride.fare.platformFee)
    : PRICING_CONFIG.platformFee;

  // Preserve initial base fare on the ride
  if (ride.fare.baseFareAmount === undefined || ride.fare.baseFareAmount === null) {
    if (ride.fare.distanceFare !== undefined && ride.fare.distanceFare > 0) {
      ride.fare.baseFareAmount = ride.fare.distanceFare;
    } else {
      // If totalWaitingCharge or platformFee were previously added, subtract them
      const prevWaiting = ride.fare.totalWaitingCharge || 0;
      const prevFee = ride.fare.platformFee || 0;
      ride.fare.baseFareAmount = Math.max(0, (ride.fare.finalAmount || ride.fare.total || 0) - prevWaiting - prevFee);
    }
  }

  const baseFare = ride.fare.baseFareAmount;
  const waitingCharge = calculation.totalWaitingCharge;

  // Final customer payable fare is: Base Fare + Waiting Charges + Platform Fee (₹1)
  const finalFare = PRICING_CONFIG.calculateFinalCustomerFare({
    baseFareAmount: baseFare,
    totalWaitingCharge: waitingCharge,
    platformFee
  });

  ride.fare.baseFareAmount = baseFare;
  ride.fare.pickupWaitingCharge = calculation.pickupWaitingCharge;
  ride.fare.destinationWaitingCharge = calculation.destinationWaitingCharge;
  ride.fare.totalWaitingCharge = waitingCharge;
  ride.fare.platformFee = platformFee;
  ride.fare.finalAmount = finalFare;
  ride.fare.total = finalFare;

  // Build standard fareBreakdown for API consumers and MongoDB storage
  const fareBreakdown = {
    baseFare,
    pickupWaitingCharge: calculation.pickupWaitingCharge,
    destinationWaitingCharge: calculation.destinationWaitingCharge,
    totalWaitingCharge: waitingCharge,
    platformFee,
    finalFare,
    currency: 'INR',
    // Human readable text
    pickupWaitingText: `${calculation.pickupWaitingMinutes} mins (₹${calculation.pickupWaitingCharge})`,
    destinationWaitingText: `${calculation.destinationWaitingMinutes} mins (₹${calculation.destinationWaitingCharge})`,
    totalWaitingText: `${calculation.totalEligibleWaitingMinutes} mins (${calculation.chargeableMinutes} chargeable mins at ₹${calculation.ratePerMinute}/min)`,
    platformFeeText: `₹${platformFee}`
  };

  if (!ride.fare.breakdown) {
    ride.fare.breakdown = {};
  }
  ride.fare.breakdown = {
    ...ride.fare.breakdown,
    ...fareBreakdown,
    total: `₹${finalFare}`,
    platformFee: `₹${platformFee}`,
    waitingCharges: `+₹${waitingCharge} (${calculation.chargeableMinutes} chargeable mins)`
  };

  ride.waitingChargeDetails = calculation;
  ride.platformFeeDetails = PRICING_CONFIG.getPlatformFeeDetails(platformFee);

  return {
    fare: ride.fare,
    fareBreakdown,
    waitingChargeDetails: calculation,
    platformFeeDetails: ride.platformFeeDetails
  };
};
