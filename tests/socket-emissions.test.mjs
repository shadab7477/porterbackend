import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock tokens for testing
const customerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImN1c3RfMTIzIiwicm9sZSI6ImN1c3RvbWVyIn0.test';
const driverToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImRyaXZlcl8xMjMiLCJyb2xlIjoiZHJpdmVyIn0.test';

const decodedCustomer = { id: 'cust_123', role: 'customer' };
const decodedDriver = { id: 'driver_123', type: 'driver_auth' };

// Mock ride documents
const mockRide = {
  _id: 'ride_id_123',
  rideId: 'RID123456',
  status: 'searching',
  customer: {
    customerId: 'cust_123',
    name: 'Test Customer',
    phone: '1234567890'
  },
  driver: {
    driverId: 'driver_123',
    name: 'Test Driver',
    phone: '0987654321',
    vehicleType: 'car',
    vehicleNumber: 'KA-01-1234',
    rating: 4.8
  },
  fare: {
    finalAmount: 150,
    total: 150
  },
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  driversNotified: [{
    driverId: 'driver_123',
    response: 'pending'
  }],
  pickupLocation: {
    type: 'Point',
    coordinates: [77.2090, 28.6139] // lon, lat
  },
  dropLocation: {
    type: 'Point',
    coordinates: [77.1025, 28.7041] // lon, lat
  },
  routeInfo: {
    distanceText: '5 km'
  },
  save: jest.fn().mockResolvedValue(null),
  updateStatus: jest.fn(function(status) {
    this.status = status;
    return this;
  })
};

const mockDriver = {
  _id: 'driver_123',
  name: 'Test Driver',
  phone: '0987654321',
  vehicleType: 'car',
  vehicleNumber: 'KA-01-1234',
  rating: 4.8,
  isAvailable: true,
  isOnline: true,
  currentLocation: {
    coordinates: [77.2090, 28.6139] // lon, lat
  },
  applicationId: {
    _id: 'app_123',
    verificationStatus: 'verified'
  },
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
    findById: jest.fn(() => ({
      populate: jest.fn().mockResolvedValue(mockDriver),
      then: jest.fn((resolve) => resolve(mockDriver))
    }))
  }
}));

jest.unstable_mockModule('../models/Customer.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: 'cust_123', name: 'Test Customer', phone: '1234567890' })
  }
}));

jest.unstable_mockModule('../models/WalletTransaction.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue({})
  }
}));

let app;
let RideModel;
let ioMock;

beforeAll(async () => {
  const [rideRoutesModule, RideModule] = await Promise.all([
    import('../routes/rideRoutes.js'),
    import('../models/Ride.js')
  ]);

  RideModel = RideModule.default;

  app = express();
  app.use(express.json());
  
  // Setup fully chained socket.io mock
  ioMock = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnThis(),
    of: jest.fn().mockReturnThis()
  };

  app.set('io', ioMock);
  app.use('/api/rides', rideRoutesModule.default);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRide.status = 'searching';
  mockRide.paymentStatus = 'pending';
  mockRide.paymentMethod = 'cash';
  mockRide.customer.customerId = 'cust_123';
  mockRide.driver.driverId = 'driver_123';
  mockDriver.isAvailable = true;
  mockDriver.isOnline = true;
});

describe('Ride Socket Emissions Integration Tests', () => {
  test('acceptRide endpoint emits events to customer and ride rooms', async () => {
    const response = await request(app)
      .post('/api/rides/accept')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rideId: 'RID123456' });

    expect(response.status).toBe(200);
    
    // Should emit to room ride:RID123456
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    expect(ioMock.to).toHaveBeenCalledWith('customer:cust_123');
    
    // Verify ride:status-changed emission payload
    const statusChangedCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusChangedCall).toBeDefined();
    expect(statusChangedCall[1].status).toBe('driver_assigned');
    expect(statusChangedCall[1].rideId).toBe('RID123456');
  });

  test('acceptRideWithSocket endpoint emits events to customer and ride rooms', async () => {
    const response = await request(app)
      .post('/api/rides/accept-with-socket')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rideId: 'RID123456', driverLocation: { latitude: 28.6139, longitude: 77.2090 } });

    expect(response.status).toBe(200);
    
    // Should emit to room ride:RID123456
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    expect(ioMock.to).toHaveBeenCalledWith('customer:cust_123');
    
    // Verify ride:status-changed emission payload
    const statusChangedCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusChangedCall).toBeDefined();
    expect(statusChangedCall[1].status).toBe('driver_assigned');
  });

  test('driverArrived endpoint emits arrived status changed', async () => {
    mockRide.status = 'driver_assigned';

    const response = await request(app)
      .post('/api/rides/arrived')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rideId: 'RID123456' });

    expect(response.status).toBe(200);
    
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    
    const arrivedCall = ioMock.emit.mock.calls.find(call => call[0] === 'driver:arrived');
    expect(arrivedCall).toBeDefined();
    
    const statusCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusCall).toBeDefined();
    expect(statusCall[1].status).toBe('driver_arrived');
  });

  test('startRide endpoint emits started and progress status changed', async () => {
    mockRide.status = 'driver_arrived';

    const response = await request(app)
      .post('/api/rides/start')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rideId: 'RID123456' });

    expect(response.status).toBe(200);
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    
    const startedCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:started');
    expect(startedCall).toBeDefined();
    
    const statusCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusCall).toBeDefined();
    expect(statusCall[1].status).toBe('in_progress');
  });

  test('completeRide endpoint emits complete status changed', async () => {
    mockRide.status = 'in_progress';

    const response = await request(app)
      .post('/api/rides/complete')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rideId: 'RID123456' });

    expect(response.status).toBe(200);
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    
    const completedCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:completed');
    expect(completedCall).toBeDefined();
    
    const statusCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusCall).toBeDefined();
    expect(statusCall[1].status).toBe('completed');
  });

  test('cancelRide endpoint emits cancelled status changed', async () => {
    mockRide.status = 'driver_assigned';

    const response = await request(app)
      .post('/api/rides/RID123456/cancel')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ reason: 'Customer changed mind' });

    expect(response.status).toBe(200);
    expect(ioMock.to).toHaveBeenCalledWith('ride:RID123456');
    
    const cancelledCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:cancelled');
    expect(cancelledCall).toBeDefined();
    
    const statusCall = ioMock.emit.mock.calls.find(call => call[0] === 'ride:status-changed');
    expect(statusCall).toBeDefined();
    expect(statusCall[1].status).toBe('cancelled');
  });
});
