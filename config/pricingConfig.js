// config/pricingConfig.js

export const PRICING_CONFIG = {
  // Fixed platform fee per billable ride
  platformFee: 1,
  currency: 'INR',
  feeType: 'platform_fee',
  calculationType: 'fixed_per_billable_ride',
  reason: 'Fixed GoDelivo platform fee',
  calculationVersion: 1,

  // Commission rates
  platformCommissionPercent: 15,
  driverPayoutPercent: 85,

  /**
   * Centralized helper to calculate final customer payable fare
   * Formula: finalFare = baseFareAmount + totalWaitingCharge + platformFee
   */
  calculateFinalCustomerFare: ({
    baseFareAmount = 0,
    totalWaitingCharge = 0,
    platformFee = 1,
    merchantSurcharge = 0
  } = {}) => {
    const base = Number(baseFareAmount) || 0;
    const waiting = Number(totalWaitingCharge) || 0;
    const fee = (platformFee !== undefined && platformFee !== null) ? Number(platformFee) : 1;
    const surcharge = Number(merchantSurcharge) || 0;
    return Math.round(base + waiting + fee + surcharge);
  },

  /**
   * Helper to build platform fee audit details object
   */
  getPlatformFeeDetails: (appliedFee = 1) => ({
    amount: (appliedFee !== undefined && appliedFee !== null) ? Number(appliedFee) : 1,
    currency: 'INR',
    feeType: 'platform_fee',
    calculationType: 'fixed_per_billable_ride',
    reason: 'Fixed GoDelivo platform fee',
    charged: true,
    calculationVersion: 1,
    calculatedAt: new Date()
  })
};

export default PRICING_CONFIG;
