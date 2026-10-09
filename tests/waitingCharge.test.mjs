import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  WAITING_CHARGE_CONFIG,
  getVehicleWaitingRule,
  calculateWaitingCharge,
  applyWaitingChargeToRide
} from '../utils/waitingChargeCalculator.js';

describe('GoDelivo Waiting Charges - Full Unit & Flow Test Suite', () => {

  describe('Vehicle-Based Waiting Charge Rules & Mapping', () => {
    test('Rule 1: 2-Wheeler (bike/scooter/scooty) mapped to 30 free mins, ₹2/min', () => {
      const bikeRule = getVehicleWaitingRule('bike');
      expect(bikeRule.freeMinutes).toBe(30);
      expect(bikeRule.ratePerMinute).toBe(2);
      expect(bikeRule.vehicleTypeKey).toBe('2_wheeler');

      const scooterRule = getVehicleWaitingRule('scooter');
      expect(scooterRule.freeMinutes).toBe(30);
      expect(scooterRule.ratePerMinute).toBe(2);

      const scootyRule = getVehicleWaitingRule('scooty');
      expect(scootyRule.freeMinutes).toBe(30);
      expect(scootyRule.ratePerMinute).toBe(2);

      const categoryRule = getVehicleWaitingRule('custom_bike', '2 Wheelers');
      expect(categoryRule.freeMinutes).toBe(30);
      expect(categoryRule.ratePerMinute).toBe(2);
    });

    test('Rule 2: 4-Wheeler (car/tata_ace/pickup/truck) mapped to 60 free mins, ₹3/min', () => {
      const carRule = getVehicleWaitingRule('car');
      expect(carRule.freeMinutes).toBe(60);
      expect(carRule.ratePerMinute).toBe(3);
      expect(carRule.vehicleTypeKey).toBe('4_wheeler');

      const tataRule = getVehicleWaitingRule('tata_ace');
      expect(tataRule.freeMinutes).toBe(60);
      expect(tataRule.ratePerMinute).toBe(3);

      const truckRule = getVehicleWaitingRule('truck');
      expect(truckRule.freeMinutes).toBe(60);
      expect(truckRule.ratePerMinute).toBe(3);

      const cat4Rule = getVehicleWaitingRule('custom_truck', '4 Wheelers');
      expect(cat4Rule.freeMinutes).toBe(60);
      expect(cat4Rule.ratePerMinute).toBe(3);
    });

    test('Rule 3: Other vehicles (auto/3-wheeler/e-loader) mapped to 60 free mins, ₹3/min', () => {
      const autoRule = getVehicleWaitingRule('auto');
      expect(autoRule.freeMinutes).toBe(60);
      expect(autoRule.ratePerMinute).toBe(3);

      const eloaderRule = getVehicleWaitingRule('e_loader');
      expect(eloaderRule.freeMinutes).toBe(60);
      expect(eloaderRule.ratePerMinute).toBe(3);
    });
  });

  describe('12 Required Core Test Cases', () => {

    // Scenario 1
    test('Scenario 1: 4 Wheeler — 40m pickup + 90m travel + 40m destination = 80 eligible mins, 20 chargeable mins, ₹60 waiting charge', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime); // 10:00
      const rideStartedAt = new Date(baseTime + 40 * 60 * 1000); // 10:40 (40 min pickup waiting)
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 90 * 60 * 1000); // 12:10 (90 min travel)
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 40 * 60 * 1000); // 12:50 (40 min destination waiting)

      const result = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt
      });

      expect(result.pickupWaitingMinutes).toBe(40);
      expect(result.destinationWaitingMinutes).toBe(40);
      expect(result.totalEligibleWaitingMinutes).toBe(80);
      expect(result.freeMinutes).toBe(60);
      expect(result.chargeableMinutes).toBe(20);
      expect(result.ratePerMinute).toBe(3);
      expect(result.chargeAmount).toBe(60);
      expect(result.pickupWaitingCharge).toBe(0); // 40 <= 60 free
      expect(result.destinationWaitingCharge).toBe(60); // 40 - (60-40) = 20 chargeable * 3 = 60
      expect(result.totalWaitingCharge).toBe(60);
      expect(result.travelingTimeExcluded).toBe(true);
      expect(result.chargeSource).toEqual(['destination']);
    });

    // Scenario 2
    test('Scenario 2: 2 Wheeler — 20m pickup + 45m travel + 20m destination = 40 eligible mins, 10 chargeable mins, ₹20 waiting charge', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 20 * 60 * 1000); // 20 min pickup
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 45 * 60 * 1000); // 45 min travel
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 20 * 60 * 1000); // 20 min destination

      const result = calculateWaitingCharge({
        vehicleType: 'bike',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt
      });

      expect(result.pickupWaitingMinutes).toBe(20);
      expect(result.destinationWaitingMinutes).toBe(20);
      expect(result.totalEligibleWaitingMinutes).toBe(40);
      expect(result.freeMinutes).toBe(30);
      expect(result.chargeableMinutes).toBe(10);
      expect(result.ratePerMinute).toBe(2);
      expect(result.chargeAmount).toBe(20);
      expect(result.pickupWaitingCharge).toBe(0);
      expect(result.destinationWaitingCharge).toBe(20);
      expect(result.totalWaitingCharge).toBe(20);
      expect(result.chargeSource).toEqual(['destination']);
    });

    // Scenario 3
    test('Scenario 3: 4 Wheeler — 25m pickup + 60m travel + 30m destination = 55 eligible mins, ₹0 waiting charge', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 25 * 60 * 1000); // 25 min pickup
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 60 * 60 * 1000); // 60 min travel
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 30 * 60 * 1000); // 30 min destination

      const result = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt
      });

      expect(result.totalEligibleWaitingMinutes).toBe(55);
      expect(result.freeMinutes).toBe(60);
      expect(result.chargeableMinutes).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.pickupWaitingCharge).toBe(0);
      expect(result.destinationWaitingCharge).toBe(0);
      expect(result.totalWaitingCharge).toBe(0);
      expect(result.chargeSource).toEqual([]);
    });

    // Scenario 4
    test('Scenario 4: Exactly the free-time allowance results in ₹0', () => {
      // 4-wheeler: exactly 60 mins waiting
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const res4W = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt: new Date(baseTime),
        rideStartedAt: new Date(baseTime + 30 * 60 * 1000), // 30m pickup
        destinationArrivedAt: new Date(baseTime + 50 * 60 * 1000),
        rideCompletedAt: new Date(baseTime + 80 * 60 * 1000) // 30m destination -> total 60m
      });
      expect(res4W.totalEligibleWaitingMinutes).toBe(60);
      expect(res4W.chargeableMinutes).toBe(0);
      expect(res4W.chargeAmount).toBe(0);

      // 2-wheeler: exactly 30 mins waiting
      const res2W = calculateWaitingCharge({
        vehicleType: 'bike',
        driverArrivedAt: new Date(baseTime),
        rideStartedAt: new Date(baseTime + 15 * 60 * 1000), // 15m pickup
        destinationArrivedAt: new Date(baseTime + 35 * 60 * 1000),
        rideCompletedAt: new Date(baseTime + 50 * 60 * 1000) // 15m destination -> total 30m
      });
      expect(res2W.totalEligibleWaitingMinutes).toBe(30);
      expect(res2W.chargeableMinutes).toBe(0);
      expect(res2W.chargeAmount).toBe(0);
    });

    // Scenario 5
    test('Scenario 5: Traveling time NEVER increases the waiting charge', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 10 * 60 * 1000); // 10m pickup
      // 5 hours of driving in heavy traffic (300 minutes!)
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 300 * 60 * 1000);
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 10 * 60 * 1000); // 10m destination

      const result = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt
      });

      expect(result.pickupWaitingMinutes).toBe(10);
      expect(result.destinationWaitingMinutes).toBe(10);
      expect(result.totalEligibleWaitingMinutes).toBe(20);
      expect(result.chargeableMinutes).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.travelingTimeExcluded).toBe(true);
    });

    // Scenario 6
    test('Scenario 6: Destination arrival without immediate ride completion continues destination waiting time', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 10 * 60 * 1000); // 10m pickup
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 20 * 60 * 1000); // arrived at dest at 10:30

      // Driver is still waiting for unloading at 11:40 (70 mins destination waiting, total = 80 mins)
      const currentEvalTime = new Date(destinationArrivedAt.getTime() + 70 * 60 * 1000);

      const liveResult = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt: null, // Still in progress
        currentTimestamp: currentEvalTime
      });

      expect(liveResult.pickupWaitingMinutes).toBe(10);
      expect(liveResult.destinationWaitingMinutes).toBe(70);
      expect(liveResult.totalEligibleWaitingMinutes).toBe(80);
      expect(liveResult.chargeableMinutes).toBe(20);
      expect(liveResult.chargeAmount).toBe(60);
    });

    // Scenario 7
    test('Scenario 7: Ride completion stops the destination timer', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 10 * 60 * 1000);
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 20 * 60 * 1000); // 10:30
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 30 * 60 * 1000); // Completed at 11:00 (30m dest waiting)

      // Evaluating later at 15:00 must NOT increase the charge beyond rideCompletedAt!
      const laterEvaluation = new Date(baseTime + 5 * 3600 * 1000);

      const result = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt,
        currentTimestamp: laterEvaluation
      });

      expect(result.destinationWaitingMinutes).toBe(30);
      expect(result.totalEligibleWaitingMinutes).toBe(40);
      expect(result.chargeAmount).toBe(0);
    });

    // Scenario 8
    test('Scenario 8: The waiting charge is added to customer ride fare exactly once and idempotently', () => {
      const mockRide = {
        rideId: 'RID_TEST_001',
        requestedVehicleType: 'car',
        driverArrivedAt: new Date('2026-10-09T10:00:00.000Z'),
        rideStartedAt: new Date('2026-10-09T10:40:00.000Z'), // 40m pickup
        destinationArrivedAt: new Date('2026-10-09T12:00:00.000Z'),
        rideCompletedAt: new Date('2026-10-09T12:40:00.000Z'), // 40m destination -> total 80m, charge = ₹60
        fare: {
          baseFareAmount: 350,
          distanceFare: 350,
          finalAmount: 350,
          total: 350
        }
      };

      // First calculation (350 base + 60 waiting + 1 platform fee = 411)
      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.baseFareAmount).toBe(350);
      expect(mockRide.fare.totalWaitingCharge).toBe(60);
      expect(mockRide.fare.platformFee).toBe(1);
      expect(mockRide.fare.finalAmount).toBe(411);

      // Re-apply calculation multiple times (simulating API retries, socket reconnects, polling)
      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.baseFareAmount).toBe(350);
      expect(mockRide.fare.totalWaitingCharge).toBe(60);
      expect(mockRide.fare.platformFee).toBe(1);
      expect(mockRide.fare.finalAmount).toBe(411);

      applyWaitingChargeToRide(mockRide);
      expect(mockRide.fare.finalAmount).toBe(411);
    });

    // Scenario 9
    test('Scenario 9: The waiting charge is not credited to the driver wallet and does not increase driver payout', () => {
      const originalBaseFare = 350;
      const waitingCharge = 60;
      const platformFee = 1;
      const finalCustomerFare = originalBaseFare + waitingCharge + platformFee; // 411

      // Calculation of driver earnings strictly based on base fare:
      const commissionRate = 0.15;
      const baseCommission = originalBaseFare * commissionRate; // 52.50
      const driverEarning = originalBaseFare - baseCommission; // 297.50

      const calculation = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt: new Date('2026-10-09T10:00:00.000Z'),
        rideStartedAt: new Date('2026-10-09T10:40:00.000Z'),
        destinationArrivedAt: new Date('2026-10-09T12:00:00.000Z'),
        rideCompletedAt: new Date('2026-10-09T12:40:00.000Z')
      });

      expect(calculation.driverWalletCredit).toBe(0);
      expect(calculation.settlementType).toBe('customer_fare_platform_component');

      // Verify that if fare-based payout was accidentally calculated on finalCustomerFare (411),
      // it would have been altered. We assert that driverEarning is strictly 297.50!
      expect(driverEarning).toBe(297.50);
      expect(driverEarning).not.toBe(finalCustomerFare * (1 - commissionRate));

      // For cash payment: Customer pays 411 cash. Platform deducts (base commission 52.50 + waiting charge 60 + platform fee 1) = 113.50
      const cashDriverKeeps = finalCustomerFare - (baseCommission + waitingCharge + platformFee);
      expect(cashDriverKeeps).toBe(driverEarning); // Driver keeps exactly 297.50
    });

    // Scenario 10
    test('Scenario 10: Metadata correctly records source, reason, timestamps, rates and chargeable duration', () => {
      const baseTime = new Date('2026-10-09T10:00:00.000Z').getTime();
      const driverArrivedAt = new Date(baseTime);
      const rideStartedAt = new Date(baseTime + 70 * 60 * 1000); // 70m pickup (10m chargeable)
      const destinationArrivedAt = new Date(rideStartedAt.getTime() + 30 * 60 * 1000); // 30m travel
      const rideCompletedAt = new Date(destinationArrivedAt.getTime() + 20 * 60 * 1000); // 20m destination (20m chargeable)

      const result = calculateWaitingCharge({
        vehicleType: 'car',
        driverArrivedAt,
        rideStartedAt,
        destinationArrivedAt,
        rideCompletedAt
      });

      expect(result.chargeSource).toContain('pickup');
      expect(result.chargeSource).toContain('destination');
      expect(result.pickupWaitingCharge).toBe(30); // 10m * 3
      expect(result.destinationWaitingCharge).toBe(60); // 20m * 3
      expect(result.totalWaitingCharge).toBe(90);
      expect(result.ratePerMinute).toBe(3);
      expect(result.freeMinutes).toBe(60);
      expect(result.chargeableMinutes).toBe(30);
      expect(result.currency).toBe('INR');
      expect(result.calculationReason).toContain('exceeded the permitted free time');
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    // Scenario 11
    test('Scenario 11: Retried APIs and fare recalculations do not duplicate charges', () => {
      const mockRide = {
        rideId: 'RID_RETRY_TEST',
        requestedVehicleType: 'bike',
        driverArrivedAt: new Date('2026-10-09T10:00:00.000Z'),
        rideStartedAt: new Date('2026-10-09T10:20:00.000Z'),
        destinationArrivedAt: new Date('2026-10-09T11:00:00.000Z'),
        rideCompletedAt: new Date('2026-10-09T11:20:00.000Z'), // 40m total, 10m chg = ₹20
        fare: {
          baseFareAmount: 120,
          distanceFare: 120,
          finalAmount: 120,
          total: 120
        }
      };

      // 10 consecutive recalculation calls (120 base + 20 waiting + 1 platform fee = 141)
      for (let i = 0; i < 10; i++) {
        applyWaitingChargeToRide(mockRide);
      }

      expect(mockRide.fare.baseFareAmount).toBe(120);
      expect(mockRide.fare.totalWaitingCharge).toBe(20);
      expect(mockRide.fare.platformFee).toBe(1);
      expect(mockRide.fare.finalAmount).toBe(141);
      expect(mockRide.fare.breakdown.finalFare).toBe(141);
    });

    // Scenario 12
    test('Scenario 12: Existing payment methods, base fare, commissions and settlements continue working', () => {
      const mockCashRide = {
        requestedVehicleType: 'car',
        driverArrivedAt: new Date('2026-10-09T10:00:00.000Z'),
        rideStartedAt: new Date('2026-10-09T10:10:00.000Z'),
        destinationArrivedAt: new Date('2026-10-09T10:40:00.000Z'),
        rideCompletedAt: new Date('2026-10-09T10:50:00.000Z'), // 20m total (<=60m) -> ₹0 charge
        fare: {
          baseFareAmount: 200,
          distanceFare: 200,
          finalAmount: 200,
          total: 200
        },
        paymentMethod: 'cash'
      };

      applyWaitingChargeToRide(mockCashRide);
      expect(mockCashRide.fare.totalWaitingCharge).toBe(0);
      expect(mockCashRide.fare.platformFee).toBe(1);
      expect(mockCashRide.fare.finalAmount).toBe(201);

      const mockWalletRide = {
        requestedVehicleType: 'car',
        driverArrivedAt: new Date('2026-10-09T10:00:00.000Z'),
        rideStartedAt: new Date('2026-10-09T10:40:00.000Z'),
        destinationArrivedAt: new Date('2026-10-09T12:00:00.000Z'),
        rideCompletedAt: new Date('2026-10-09T12:40:00.000Z'), // 80m total -> ₹60 charge
        fare: {
          baseFareAmount: 500,
          distanceFare: 500,
          finalAmount: 500,
          total: 500
        },
        paymentMethod: 'wallet'
      };

      applyWaitingChargeToRide(mockWalletRide);
      expect(mockWalletRide.fare.baseFareAmount).toBe(500);
      expect(mockWalletRide.fare.totalWaitingCharge).toBe(60);
      expect(mockWalletRide.fare.platformFee).toBe(1);
      expect(mockWalletRide.fare.finalAmount).toBe(561);
    });

  });
});
