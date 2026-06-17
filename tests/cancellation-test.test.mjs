import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock tokens for testing
const customerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImN1c3RfMTIzIiwicm9sZSI6ImN1c3RvbWVyIn0.test';
const driverToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImRyaXZlcl8xMjMiLCJyb2xlIjoiZHJpdmVyIn0.test';

const decodedCustomer = { id: 'cust_123', role: 'customer' };
const decodedDriver = { id: 'driver_123', role: 'driver' };

// Mock ride documents
const mockRide = {
  _id: 'ride_id_123',
  rideId: 'RID123456',
  status: 'searching',
  customer: {
    customerId: 'cust_123',
    name: 'Test Customer'
  },
  driver: {
    driverId: 'driver_123',
    name: 'Test Driver'
  },
  fare: {
    finalAmount: 150,
    total: 150
  },
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  driversNotified: [],
  save: jest.fn().mockResolvedValue(null),
  updateStatus: jest.fn(function(status) {
    this.status = status;
    return this;
  })
};

const mockDriver = {
  _id: 'driver_123',
  isAvailable: false,
  save: jest.fn().mockResolvedValue(null)
};

// Mocks
jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: jest.fn((token) => {
      if (token === customerToken) return decodedCustomer;
      if (token === driverToken) return decodedDriver;
      throw new Error('Invalid token');
    })
  }
}));

jest.unstable_mockModule('../models/Ride.js', () => ({
  default: {
    findOne: jest.fn(() => ({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(mockRide),
      then: jest.fn((resolve) => resolve(mockRide))
    }))
  }
}));

jest.unstable_mockModule('../models/Driver.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue(mockDriver)
  }
}));

jest.unstable_mockModule('../models/Customer.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: 'cust_123', name: 'Test Customer' })
  }
}));

jest.unstable_mockModule('../models/WalletTransaction.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue({})
  }
}));

let app;
let RideModel;

beforeAll(async () => {
  const [rideRoutesModule, RideModule] = await Promise.all([
    import('../routes/rideRoutes.js'),
    import('../models/Ride.js')
  ]);

  RideModel = RideModule.default;

  app = express();
  app.use(express.json());
  
  // Socket.IO io setup helper
  app.set('io', {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    of: jest.fn().mockReturnThis()
  });

  app.use('/api/rides', rideRoutesModule.default);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRide.status = 'searching';
  mockRide.paymentStatus = 'pending';
  mockRide.paymentMethod = 'cash';
  mockRide.customer.customerId = 'cust_123';
  mockRide.driver.driverId = 'driver_123';
  mockDriver.isAvailable = false;
  
  // Re-mock findOne to return updated mockRide
  RideModel.findOne.mockImplementation(() => ({
    populate: jest.fn().mockReturnThis(),
    then: jest.fn((resolve) => resolve(mockRide))
  }));
});

describe('Ride Cancellation API tests with params and expanded statuses', () => {
  test('POST /api/rides/:rideId/cancel works for CUSTOMER with rideId in URL parameters', async () => {
    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
    expect(response.body.data.cancelledBy).toBe('customer');
  });

  test('POST /api/rides/:rideId/cancel works for CUSTOMER when body has cancelReason instead of reason', async () => {
    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ cancelReason: 'Alternative reason parameter' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
    expect(response.body.data.cancellationReason).toBe('Alternative reason parameter');
  });

  test('POST /api/rides/:rideId/cancel works for CUSTOMER when ride is in "in_progress" status', async () => {
    mockRide.status = 'in_progress';

    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Emergency stop' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
  });

  test('POST /api/rides/:rideId/cancel works for DRIVER when ride is in "driver_arrived" status', async () => {
    mockRide.status = 'driver_arrived';

    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ reason: 'Customer not showing up' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
    expect(response.body.data.cancelledBy).toBe('driver');
    expect(mockDriver.save).toHaveBeenCalled();
  });

  test('POST /api/rides/:rideId/cancel works for CUSTOMER when ride is in "no_drivers" status', async () => {
    mockRide.status = 'no_drivers';

    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'No drivers available' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
    expect(response.body.data.cancelledBy).toBe('customer');
  });

  test('POST /api/rides/:rideId/cancel returns 400 for already completed ride', async () => {
    mockRide.status = 'completed';

    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('completed');
  });
});
