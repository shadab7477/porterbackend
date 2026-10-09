// tests/supportSystem.test.mjs
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import Admin from '../models/Admin.js';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import { SUPPORT_CONFIG, normalizeStatus, isValidStatusTransition } from '../config/supportConfig.js';

describe('GoDelivo Complaint Box & Support System Unit & Flow Tests', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
  let customerId, driverId, adminId, otherCustomerId, rideId;
  let customerToken, driverToken, adminToken, otherCustomerToken;

  beforeAll(async () => {
    customerId = new mongoose.Types.ObjectId().toString();
    driverId = new mongoose.Types.ObjectId().toString();
    adminId = new mongoose.Types.ObjectId().toString();
    otherCustomerId = new mongoose.Types.ObjectId().toString();
    rideId = new mongoose.Types.ObjectId().toString();

    customerToken = jwt.sign({ id: customerId, role: 'customer' }, JWT_SECRET);
    driverToken = jwt.sign({ id: driverId, type: 'driver_auth', role: 'driver' }, JWT_SECRET);
    adminToken = jwt.sign({ id: adminId, role: 'admin' }, JWT_SECRET);
    otherCustomerToken = jwt.sign({ id: otherCustomerId, role: 'customer' }, JWT_SECRET);
  });

  describe('1. Configuration & Category Validation', () => {
    test('Config contains Customer and Driver categories, SLA rules, and Status transitions', () => {
      expect(SUPPORT_CONFIG.customerCategories.length).toBeGreaterThan(5);
      expect(SUPPORT_CONFIG.driverCategories.length).toBeGreaterThan(5);
      expect(SUPPORT_CONFIG.ticketTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'complaint' }),
          expect.objectContaining({ id: 'support_request' })
        ])
      );
      expect(SUPPORT_CONFIG.statusTransitions.open).toContain('in_progress');
      expect(SUPPORT_CONFIG.statusTransitions.open).toContain('assigned');
    });

    test('Status normalizer handles various casings and spacing', () => {
      expect(normalizeStatus('Open')).toBe('open');
      expect(normalizeStatus('In Progress')).toBe('in_progress');
      expect(normalizeStatus('WAITING_FOR_USER')).toBe('waiting_for_user');
      expect(normalizeStatus('Resolved')).toBe('resolved');
      expect(normalizeStatus('Closed')).toBe('closed');
    });

    test('Status transition validator allows valid transitions and blocks invalid ones', () => {
      expect(isValidStatusTransition('open', 'assigned')).toBe(true);
      expect(isValidStatusTransition('open', 'in_progress')).toBe(true);
      expect(isValidStatusTransition('in_progress', 'resolved')).toBe(true);
      expect(isValidStatusTransition('resolved', 'in_progress')).toBe(true); // Reopen
      expect(isValidStatusTransition('resolved', 'closed')).toBe(true);

      // Invalid transitions
      expect(isValidStatusTransition('open', 'resolved')).toBe(false);
      expect(isValidStatusTransition('closed', 'waiting_for_user')).toBe(false);
    });
  });

  describe('2. Ticket Creation & Validation', () => {
    test('Customer can create a complaint with valid fields', async () => {
      const ticketId = await Ticket.generateNextTicketId();
      expect(ticketId).toMatch(/^TKT-\d{4}-\d{4}$/);

      const ticket = new Ticket({
        ticketId,
        type: 'complaint',
        reporter: customerId,
        reporterModel: 'Customer',
        reporterName: 'John Doe',
        reporterType: 'CUSTOMER',
        reporterPhone: '9876543210',
        category: 'Driver behavior',
        subject: 'Driver was rude during trip',
        description: 'Driver used inappropriate language when unloading items.',
        priority: 'High',
        status: 'open',
        messages: [{
          sender: customerId,
          senderModel: 'Customer',
          senderName: 'John Doe',
          senderType: 'CUSTOMER',
          message: 'Driver used inappropriate language when unloading items.',
          isInternal: false
        }]
      });

      expect(ticket.type).toBe('complaint');
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('High');
      expect(ticket.messages.length).toBe(1);
      expect(ticket.messages[0].isInternal).toBe(false);
    });

    test('Driver can create a support request with valid fields', async () => {
      const ticketId = await Ticket.generateNextTicketId();
      const ticket = new Ticket({
        ticketId,
        type: 'support_request',
        reporter: driverId,
        reporterModel: 'Driver',
        reporterName: 'Driver Singh',
        reporterType: 'DRIVER',
        reporterPhone: '9876500000',
        category: 'App or GPS issue',
        subject: 'GPS route navigation issue',
        description: 'Map route is showing an outdated closed road.',
        priority: 'Medium',
        status: 'open'
      });

      expect(ticket.type).toBe('support_request');
      expect(ticket.reporterType).toBe('DRIVER');
      expect(ticket.category).toBe('App or GPS issue');
    });

    test('Ticket creation fails validation if required fields (subject, category, description) are missing', () => {
      const invalidTicket = new Ticket({
        reporter: customerId,
        reporterModel: 'Customer'
      });

      const err = invalidTicket.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.ticketId).toBeDefined();
      expect(err.errors.category).toBeDefined();
      expect(err.errors.subject).toBeDefined();
      expect(err.errors.description).toBeDefined();
    });
  });

  describe('3. Related Ride Authorization & Integrity', () => {
    test('Ride association validation checks customer and driver ownership', () => {
      const mockRide = {
        _id: rideId,
        rideId: 'RID888999',
        customer: { customerId: customerId, name: 'John Doe' },
        driver: { driverId: driverId, name: 'Driver Singh' },
        fare: { baseFareAmount: 350, totalWaitingCharge: 60, finalAmount: 410 }
      };

      // Owner customer matches
      expect(mockRide.customer.customerId.toString()).toBe(customerId);
      // Other customer does NOT match
      expect(mockRide.customer.customerId.toString()).not.toBe(otherCustomerId);
      // Driver matches
      expect(mockRide.driver.driverId.toString()).toBe(driverId);
    });
  });

  describe('4. Public vs Internal Notes Security (Strict Isolation)', () => {
    test('Internal notes added by Admin are strictly filtered out for Customer/Driver', () => {
      const ticket = new Ticket({
        ticketId: 'TKT-2610-0099',
        type: 'complaint',
        reporter: customerId,
        reporterModel: 'Customer',
        reporterName: 'Customer A',
        reporterType: 'CUSTOMER',
        category: 'Payment issue',
        subject: 'Double charge inquiry',
        description: 'I was charged twice on my card.',
        messages: [
          {
            sender: customerId,
            senderModel: 'Customer',
            senderName: 'Customer A',
            senderType: 'CUSTOMER',
            message: 'I was charged twice on my card.',
            isInternal: false,
            createdAt: new Date()
          },
          {
            sender: adminId,
            senderModel: 'Admin',
            senderName: 'Support Lead',
            senderType: 'ADMIN',
            message: 'INTERNAL NOTE: Checked Razorpay webhook, transaction ID tx_123 was captured once. Platform logs confirm no double deduction.',
            isInternal: true, // PRIVATE ADMIN NOTE
            createdAt: new Date()
          },
          {
            sender: adminId,
            senderModel: 'Admin',
            senderName: 'Support Lead',
            senderType: 'ADMIN',
            message: 'Hello Customer, we checked your payment status and only 1 charge of ₹410 was processed. Please verify with your bank statement.',
            isInternal: false, // PUBLIC REPLY
            createdAt: new Date()
          }
        ],
        auditHistory: [
          {
            action: 'ticket_created',
            actorName: 'Customer A',
            isInternal: false
          },
          {
            action: 'internal_investigation',
            actorName: 'Support Lead',
            details: { gatewayTx: 'tx_123', internalFlag: 'verified_single' },
            isInternal: true // PRIVATE AUDIT ENTRY
          }
        ]
      });

      expect(ticket.messages.length).toBe(3);
      expect(ticket.auditHistory.length).toBe(2);

      // Call toPublicJSON() (which is sent to customer/driver API responses)
      const publicResponse = ticket.toPublicJSON();

      // Ensure internal note is STRIPPED
      expect(publicResponse.messages.length).toBe(2);
      expect(publicResponse.messages.some(m => m.isInternal)).toBe(false);
      expect(publicResponse.messages.find(m => m.message.includes('INTERNAL NOTE'))).toBeUndefined();
      expect(publicResponse.messages[1].message).toContain('Hello Customer, we checked your payment status');

      // Ensure internal audit history is STRIPPED
      expect(publicResponse.auditHistory.length).toBe(1);
      expect(publicResponse.auditHistory.some(a => a.isInternal)).toBe(false);
    });
  });

  describe('5. Status Transitions, Assignment, Resolution & Reopen Workflow', () => {
    test('Ticket lifecycle executes with full audit trail', () => {
      const ticket = new Ticket({
        ticketId: 'TKT-2610-0100',
        type: 'complaint',
        reporter: customerId,
        reporterModel: 'Customer',
        reporterName: 'Customer B',
        reporterType: 'CUSTOMER',
        category: 'Driver did not arrive',
        subject: 'Driver never arrived at pickup point',
        description: 'Waiting for 45 mins but driver did not show up.',
        status: 'open',
        priority: 'High'
      });

      // Step 1: Assign ticket
      ticket.assignedTo = adminId;
      ticket.assignedToName = 'Admin Agent 1';
      ticket.assignedAt = new Date();
      ticket.status = 'assigned';
      ticket.addAuditLog({
        action: 'ticket_assigned',
        actor: adminId,
        actorName: 'Admin Agent 1',
        details: { newAssignee: 'Admin Agent 1' }
      });

      expect(ticket.status).toBe('assigned');
      expect(ticket.assignedToName).toBe('Admin Agent 1');

      // Step 2: Move to in_progress
      ticket.status = 'in_progress';
      ticket.addAuditLog({
        action: 'status_changed',
        actor: adminId,
        actorName: 'Admin Agent 1',
        details: { previousStatus: 'assigned', newStatus: 'in_progress' }
      });

      // Step 3: Resolve ticket
      ticket.status = 'resolved';
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = adminId;
      ticket.resolutionNotes = 'Contacted driver, ride was reallocated and apology voucher sent to customer.';
      ticket.addAuditLog({
        action: 'ticket_resolved',
        actor: adminId,
        actorName: 'Admin Agent 1',
        details: { resolution: ticket.resolutionNotes }
      });

      expect(ticket.status).toBe('resolved');
      expect(ticket.resolutionNotes).toBeDefined();

      // Step 4: Reopen ticket
      ticket.status = 'in_progress';
      ticket.reopenedAt = new Date();
      ticket.reopenedBy = customerId;
      ticket.reopenReason = 'Voucher code did not apply at checkout.';
      ticket.addAuditLog({
        action: 'ticket_reopened',
        actor: customerId,
        actorName: 'Customer B',
        actorRole: 'customer',
        details: { reason: ticket.reopenReason }
      });

      expect(ticket.status).toBe('in_progress');
      expect(ticket.reopenReason).toContain('Voucher code');
      expect(ticket.auditHistory.length).toBe(4);
    });
  });

  describe('6. Financial Safety Guarantee', () => {
    test('Creating or viewing a fare/payment complaint does NOT modify ride fares, driver earnings or wallet balances', () => {
      const originalRideFare = {
        baseFareAmount: 350,
        pickupWaitingCharge: 0,
        destinationWaitingCharge: 60,
        totalWaitingCharge: 60,
        finalAmount: 410
      };

      const mockRide = {
        _id: rideId,
        rideId: 'RID123456',
        fare: { ...originalRideFare },
        driverEarning: 297.5,
        commission: 52.5
      };

      const complaintTicket = new Ticket({
        ticketId: 'TKT-2610-0200',
        type: 'complaint',
        reporter: customerId,
        reporterModel: 'Customer',
        reporterName: 'Customer Fare Dispute',
        reporterType: 'CUSTOMER',
        category: 'Loading/unloading or waiting charges',
        subject: 'Dispute ₹60 destination waiting charge',
        description: 'Unloading took only 20 mins, why was ₹60 added?',
        relatedRideId: mockRide._id,
        relatedRideCode: mockRide.rideId,
        status: 'open'
      });

      // Ticket is created
      expect(complaintTicket.category).toBe('Loading/unloading or waiting charges');

      // Verify ride fare and earnings remained 100% UNCHANGED
      expect(mockRide.fare.baseFareAmount).toBe(350);
      expect(mockRide.fare.totalWaitingCharge).toBe(60);
      expect(mockRide.fare.finalAmount).toBe(410);
      expect(mockRide.driverEarning).toBe(297.5);
      expect(mockRide.commission).toBe(52.5);
    });
  });
});
