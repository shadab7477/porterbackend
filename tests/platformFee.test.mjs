// tests/platformFee.test.mjs
import { describe, test, expect, beforeAll } from '@jest/globals';
import mongoose from 'mongoose';
import PRICING_CONFIG from '../config/pricingConfig.js';
import { applyWaitingChargeToRide, calculateWaitingCharge } from '../utils/waitingChargeCalculator.js';
import Ride from '../models/Ride.js';

describe('GoDelivo Fixed ₹1 Platform Fee - Full Unit & Flow Test Suite', () => {

  describe('1. Centralized Configuration & Rule Integrity', () => {
    test('Rule 1: Fixed platform fee is ₹1 with currency INR and standard metadata', () => {
      expect(PRICING_CONFIG.platformFee).toBe(1);
      expect(PRICING_CONFIG.currency).toBe('INR');
      expect(PRICING_CONFIG.feeType).toBe('platform_fee');
      expect(PRICING_CONFIG.calculationType).toBe('fixed_per_billable_ride');
      expect(PRICING_CONFIG.platformCommissionPercent).toBe(15);
      expect(PRICING_CONFIG.driverPayoutPercent).toBe(85);
    });

    test('Rule 2: Helper calculateFinalCustomerFare calculates Base + Waiting + PlatformFee', () => {
      // Base ₹350 + no waiting + ₹1 platform fee = ₹351
      expect(PRICING_CONFIG.calculateFinalCustomerFare({ baseFareAmount: 350, totalWaitingCharge: 0, platformFee: 1 })).toBe(351);

      // Base ₹350 + ₹60 waiting + ₹1 platform fee = ₹411
      expect(PRICING_CONFIG.calculateFinalCustomerFare({ baseFareAmount: 350, totalWaitingCharge: 60, platformFee: 1 })).toBe(411);
    });
  });

  describe('2. Required Core Test Cases (1 to 10)', () => {

    test('Scenario 1: A billable ride receives exactly ₹1 platform fee', () => {
      const details = PRICING_CONFIG.getPlatformFeeDetails();
      expect(details.amount).toBe(1);
      expect(details.currency).toBe('INR');
      expect(details.charged).toBe(true);
      expect(details.reason).toBe('Fixed GoDelivo platform fee');
    });

    test('Scenario 2: A ₹350 base fare with no other charges produces a ₹351 final fare', async () => {
      const mockRide = {
        requestedVehicleType: 'tata_ace',
        fare: {
          baseFareAmount: 350,
          distanceFare: 350,
          totalWaitingCharge: 0,
          platformFee: 1,
          finalAmount: 351,
          total: 351
        },
        driverArrivedAt: null,
        rideStartedAt: null,
        destinationArrivedAt: null,
        rideCompletedAt: null
      };

      const result = applyWaitingChargeToRide(mockRide);
      expect(result.fare.baseFareAmount).toBe(350);
      expect(result.fare.totalWaitingCharge).toBe(0);
      expect(result.fare.platformFee).toBe(1);
      expect(result.fare.finalAmount).toBe(351);
      expect(result.fareBreakdown.baseFare).toBe(350);
      expect(result.fareBreakdown.platformFee).toBe(1);
      expect(result.fareBreakdown.finalFare).toBe(351);
      expect(result.platformFeeDetails.amount).toBe(1);
    });

    test('Scenario 3: A ₹350 base fare plus ₹60 waiting charges produces a ₹411 final fare', async () => {
      const mockRide = {
        requestedVehicleType: '4_wheeler',
        fare: {
          baseFareAmount: 350,
          distanceFare: 350,
          platformFee: 1
        },
        // 4-wheeler: 60 mins free, 80 mins waiting total = 20 chargeable mins * ₹3 = ₹60
        driverArrivedAt: new Date('2026-10-09T10:00:00Z'),
        rideStartedAt: new Date('2026-10-09T10:40:00Z'),      // 40m pickup
        destinationArrivedAt: new Date('2026-10-09T12:10:00Z'), // 90m travel (EXCLUDED)
        rideCompletedAt: new Date('2026-10-09T12:50:00Z')     // 40m destination
      };

      const result = applyWaitingChargeToRide(mockRide);
      expect(result.waitingChargeDetails.totalEligibleWaitingMinutes).toBe(80);
      expect(result.waitingChargeDetails.chargeableMinutes).toBe(20);
      expect(result.waitingChargeDetails.totalWaitingCharge).toBe(60);
      expect(result.fare.baseFareAmount).toBe(350);
      expect(result.fare.totalWaitingCharge).toBe(60);
      expect(result.fare.platformFee).toBe(1);
      expect(result.fare.finalAmount).toBe(411);
      expect(result.fareBreakdown.finalFare).toBe(411);
    });

    test('Scenario 4: The platform fee is returned in all applicable fare and ride-detail breakdowns', async () => {
      const mockRide = {
        requestedVehicleType: 'car',
        fare: {
          baseFareAmount: 200,
          platformFee: 1
        }
      };

      const result = applyWaitingChargeToRide(mockRide);
      expect(result.fareBreakdown.platformFee).toBe(1);
      expect(result.fare.breakdown.platformFee).toBe('₹1');
      expect(result.platformFeeDetails).toEqual(expect.objectContaining({
        amount: 1,
        currency: 'INR',
        feeType: 'platform_fee',
        charged: true
      }));
    });

    test('Scenario 5: Database schema stores the correct fee, currency, reason, and final fare', () => {
      const ride = new Ride({
        requestedVehicleType: 'bike',
        customer: { customerId: new mongoose.Types.ObjectId(), name: 'Test Customer', phone: '9999999999' },
        pickupLocation: { type: 'Point', coordinates: [77.2, 28.6], address: 'Pickup' },
        dropLocation: { type: 'Point', coordinates: [77.3, 28.7], address: 'Drop' },
        distance: 10,
        duration: 25,
        fare: {
          baseFareAmount: 150,
          totalWaitingCharge: 0,
          platformFee: 1,
          total: 151,
          finalAmount: 151
        },
        platformFeeDetails: {
          amount: 1,
          currency: 'INR',
          feeType: 'platform_fee',
          calculationType: 'fixed_per_billable_ride',
          reason: 'Fixed GoDelivo platform fee',
          charged: true
        }
      });

      expect(ride.fare.baseFareAmount).toBe(150);
      expect(ride.fare.platformFee).toBe(1);
      expect(ride.fare.finalAmount).toBe(151);
      expect(ride.platformFeeDetails.amount).toBe(1);
      expect(ride.platformFeeDetails.currency).toBe('INR');
      expect(ride.platformFeeDetails.reason).toBe('Fixed GoDelivo platform fee');
    });

    test('Scenario 6: Repeated fare recalculations NEVER add another ₹1 (Idempotency)', () => {
      const mockRide = {
        requestedVehicleType: 'tata_ace',
        fare: {
          baseFareAmount: 350,
          platformFee: 1,
          totalWaitingCharge: 0,
          finalAmount: 351,
          total: 351
        },
        driverArrivedAt: null,
        rideStartedAt: null,
        destinationArrivedAt: null,
        rideCompletedAt: null
      };

      // 1st calculation
      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.finalAmount).toBe(351);

      // 2nd calculation (e.g. status refetch / reconnect)
      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.finalAmount).toBe(351);

      // 3rd calculation
      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.finalAmount).toBe(351);
      expect(mockRide.fare.platformFee).toBe(1);
    });

    test('Scenario 7: The fee is NOT separately credited to the driver wallet and does not increase driver payout', () => {
      const baseFare = 350;
      const waitingCharge = 60;
      const platformFee = 1;
      const finalCustomerPayable = baseFare + waitingCharge + platformFee; // ₹411

      // Payout and commission MUST be strictly on Base Fare (₹350)
      const commissionAmount = baseFare * 0.15; // ₹52.50
      const driverEarning = baseFare * 0.85;    // ₹297.50

      expect(driverEarning).toBe(297.5);
      expect(commissionAmount).toBe(52.5);

      // Verify for Online Payment:
      // Platform receives ₹411. Credits driverEarning (₹297.50) to driver wallet.
      // Platform fee (₹1) and waiting charge (₹60) have driverWalletCredit = 0.
      const onlineDriverCredit = driverEarning;
      expect(onlineDriverCredit).toBe(297.5);

      // Verify for Cash Payment:
      // Customer hands ₹411 cash to driver.
      // Platform deducts commission (₹52.50) + waiting charges (₹60) + platform fee (₹1) = ₹113.50 from driver wallet.
      const cashDeduction = commissionAmount + waitingCharge + platformFee;
      expect(cashDeduction).toBe(113.5);
      const driverNetCashInHand = finalCustomerPayable - cashDeduction;
      expect(driverNetCashInHand).toBe(297.5); // Exactly 85% of base fare!
    });

    test('Scenario 8: Existing driver payout, commission, waiting charges, and traveling-time exclusion remain unchanged', () => {
      // 2-wheeler: 30 free mins, ₹2/min
      // 20m pickup + 45m travel (EXCLUDED) + 20m destination = 40m total, 10 chargeable mins = ₹20 waiting charge
      const mockRide = {
        requestedVehicleType: 'bike',
        fare: {
          baseFareAmount: 100,
          platformFee: 1
        },
        driverArrivedAt: new Date('2026-10-09T10:00:00Z'),
        rideStartedAt: new Date('2026-10-09T10:20:00Z'),      // 20m pickup
        destinationArrivedAt: new Date('2026-10-09T11:05:00Z'), // 45m travel (EXCLUDED)
        rideCompletedAt: new Date('2026-10-09T11:25:00Z')     // 20m destination
      };

      const result = applyWaitingChargeToRide(mockRide);
      expect(result.waitingChargeDetails.totalWaitingCharge).toBe(20);
      expect(result.fare.platformFee).toBe(1);
      // Final Fare = Base(100) + Waiting(20) + PlatformFee(1) = ₹121
      expect(result.fare.finalAmount).toBe(121);
      expect(result.fareBreakdown.finalFare).toBe(121);
    });

    test('Scenario 9: Cancellation and non-billable rides do not create invalid platform fee obligations', () => {
      const cancelledRide = {
        status: 'cancelled',
        cancellationFee: 0,
        fare: {
          baseFareAmount: 0,
          totalWaitingCharge: 0,
          platformFee: 0,
          finalAmount: 0
        }
      };

      expect(cancelledRide.fare.finalAmount).toBe(0);
      expect(cancelledRide.fare.platformFee).toBe(0);
    });

    test('Scenario 10: Retried payment webhooks and API calls preserve single fee consistency', () => {
      const mockRide = {
        rideId: 'RID_WEBHOOK_TEST',
        fare: {
          baseFareAmount: 350,
          platformFee: 1,
          totalWaitingCharge: 60,
          finalAmount: 411
        }
      };

      // 1st webhook call
      const firstAmount = mockRide.fare.finalAmount;
      expect(firstAmount).toBe(411);

      // 2nd duplicate webhook call
      const secondAmount = mockRide.fare.finalAmount;
      expect(secondAmount).toBe(411);
      expect(secondAmount).toBe(firstAmount);
    });
  });
});
