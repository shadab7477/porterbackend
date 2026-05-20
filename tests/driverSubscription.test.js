import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

const authToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMGMwZTIxNDM4ZDgxOWYyYWM0ZDE2OSIsInBob25lIjoiNjI2MzM1MjQ5NiIsInR5cGUiOiJkcml2ZXJfYXV0aCIsInJvbGUiOiJkcml2ZXIiLCJpc1ZlcmlmaWVkIjp0cnVlLCJpYXQiOjE3NzkxNzUxMDYsImV4cCI6MTc4MTc2NzEwNn0._9GFnVOhMgmOS3NqsAvUvxEr4Ls-1pVcq4WyYzPWewQ';

const decodedToken = {
  id: '6a0c0e21438d819f2ac4d169',
  phone: '6263352496',
  type: 'driver_auth',
  role: 'driver',
  isVerified: true
};

const applicationId = '650000000000000000000001';
const initialApplication = {
  _id: applicationId,
  driverId: 'DRV123',
  phone: '6263352496',
  fullName: 'Test Driver',
  vehicleType: 'bike',
  subscriptionPayment: {
    status: 'pending',
    razorpayOrderId: 'order_123',
    amount: 100
  },
  verificationStatus: 'verified',
  toObject() {
    return this;
  }
};

const driverDoc = {
  _id: decodedToken.id,
  applicationId: initialApplication,
  isBlocked: false
};

const createOrderMock = jest.fn().mockResolvedValue({
  id: 'order_123',
  amount: 10000,
  currency: 'INR'
});

jest.unstable_mockModule('jsonwebtoken', () => ({
  verify: jest.fn(() => decodedToken)
}));

jest.unstable_mockModule('../models/Driver.js', () => ({
  default: {
    findById: jest.fn(() => ({
      populate: jest.fn().mockResolvedValue(driverDoc)
    })),
    findOne: jest.fn(() => ({
      populate: jest.fn().mockResolvedValue(driverDoc)
    }))
  }
}));

jest.unstable_mockModule('../models/DriverApplication.js', () => ({
  default: {
    findOne: jest.fn(() => initialApplication),
    findById: jest.fn(() => initialApplication)
  }
}));

jest.unstable_mockModule('../models/Vehicle.js', () => ({
  default: {
    findOne: jest.fn(() => ({
      vehicleType: 'bike',
      name: 'Bike',
      subscriptionFee: 100
    }))
  }
}));

jest.unstable_mockModule('razorpay', () => ({
  default: jest.fn(() => ({
    orders: {
      create: createOrderMock
    }
  }))
}));

let app;
let Driver;
let DriverApplication;
let Vehicle;

beforeAll(async () => {
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';

  const [{ default: driverAuthRoutes }, DriverModule, DriverApplicationModule, VehicleModule] = await Promise.all([
    import('../routes/driverAuthRoutes.js'),
    import('../models/Driver.js'),
    import('../models/DriverApplication.js'),
    import('../models/Vehicle.js')
  ]);

  Driver = DriverModule.default;
  DriverApplication = DriverApplicationModule.default;
  Vehicle = VehicleModule.default;

  app = express();
  app.use(express.json());
  app.use('/api/driver', driverAuthRoutes);
});

beforeEach(() => {
  createOrderMock.mockClear();
  Driver.findById.mockClear();
  Driver.findOne.mockClear();
  DriverApplication.findOne.mockClear();
  DriverApplication.findById.mockClear();
  Vehicle.findOne.mockClear();
  Driver.findById.mockImplementation(() => ({
    populate: jest.fn().mockResolvedValue(driverDoc)
  }));
  Driver.findOne.mockImplementation(() => ({
    populate: jest.fn().mockResolvedValue(driverDoc)
  }));
  DriverApplication.findOne.mockResolvedValue(initialApplication);
  DriverApplication.findById.mockResolvedValue(initialApplication);
  Vehicle.findOne.mockResolvedValue({
    vehicleType: 'bike',
    name: 'Bike',
    subscriptionFee: 100
  });
  initialApplication.subscriptionPayment = {
    status: 'pending',
    razorpayOrderId: 'order_123',
    amount: 100
  };
});

describe('Driver subscription and applicationId API tests', () => {
  test('POST /api/driver/subscription/create-order works with token only and returns applicationId', async () => {
    const response = await request(app)
      .post('/api/driver/subscription/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBe(applicationId);
    expect(response.body.data.driverName).toBe('Test Driver');
    expect(response.body.data.driverPhone).toBe('6263352496');
    expect(createOrderMock).toHaveBeenCalled();
  });

  test('POST /api/driver/subscription/verify works with token only and returns applicationId', async () => {
    const paymentId = 'pay_123';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`order_123|${paymentId}`)
      .digest('hex');

    const response = await request(app)
      .post('/api/driver/subscription/verify')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        razorpay_order_id: 'order_123',
        razorpay_payment_id: paymentId,
        razorpay_signature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBe(applicationId);
    expect(response.body.data.driverId).toBe('DRV123');
    expect(response.body.data.verificationStatus).toBe('verified');
  });

  test('GET /api/driver/subscription/status without applicationId works with token only', async () => {
    const response = await request(app)
      .get('/api/driver/subscription/status')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBe(applicationId);
    expect(response.body.data.driverId).toBe('DRV123');
  });

  test('GET /api/driver/profile returns applicationId in profile response', async () => {
    const response = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBe(applicationId);
    expect(response.body.data.driverId).toBe('DRV123');
  });
});
