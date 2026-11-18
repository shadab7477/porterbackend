import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import {
  getDriverNotifications,
  markDriverNotificationRead,
  markAllDriverNotificationsRead
} from '../controllers/driverNotificationController.js';

const mockResponse = () => {
  const res = {};
  res.statusCode = 200;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
};

async function runTests() {
  try {
    console.log('🧪 Starting Driver Notifications API Test...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const testDriverId = new mongoose.Types.ObjectId();
    const otherDriverId = new mongoose.Types.ObjectId();

    // Clean up any old test notifications
    await Notification.deleteMany({ title: { $regex: /^\[TEST\]/ } });

    // 1. Create test notifications
    // A: Broadcast to all
    const notifAll = await Notification.create({
      title: '[TEST] Welcome to GoDelivo',
      message: 'Welcome all partners!',
      recipientType: 'all',
      sentAt: new Date()
    });

    // B: Targeted to this driver
    const notifDriverSpecific = await Notification.create({
      title: '[TEST] Ride Completed',
      message: 'Great job! You earned ₹150 for this ride.',
      recipientType: 'driver',
      recipientIds: [testDriverId],
      data: { rideId: 'test123', fare: 150 },
      sentAt: new Date()
    });

    // C: Targeted to other driver (should NOT be visible to this driver)
    const notifOther = await Notification.create({
      title: '[TEST] Other driver notification',
      message: 'Not for you',
      recipientType: 'driver',
      recipientIds: [otherDriverId],
      sentAt: new Date()
    });

    console.log('✅ Created 3 test notifications');

    // 2. Test GET /api/driver/notifications
    const reqGet = {
      driver: { id: testDriverId.toString() },
      query: { page: 1, limit: 10 }
    };
    const resGet = mockResponse();
    await getDriverNotifications(reqGet, resGet);

    console.log('Status code:', resGet.statusCode);
    const notifications = resGet.body.notifications;
    console.log(`Fetched ${notifications.length} notifications, unread: ${resGet.body.unreadCount}`);

    // Verify notifications contains notifAll and notifDriverSpecific, but NOT notifOther
    const foundIds = notifications.map(n => n._id.toString());
    const hasAll = foundIds.includes(notifAll._id.toString());
    const hasSpecific = foundIds.includes(notifDriverSpecific._id.toString());
    const hasOther = foundIds.includes(notifOther._id.toString());

    if (hasAll && hasSpecific && !hasOther) {
      console.log('✅ PASS: Filter correctly returns broadcast + driver specific, excludes other driver');
    } else {
      throw new Error(`Filter mismatch: hasAll=${hasAll}, hasSpecific=${hasSpecific}, hasOther=${hasOther}`);
    }

    // 3. Test mark specific as read
    const reqRead = {
      params: { id: notifDriverSpecific._id.toString() },
      driver: { id: testDriverId.toString() }
    };
    const resRead = mockResponse();
    await markDriverNotificationRead(reqRead, resRead);
    console.log('✅ Mark read status:', resRead.statusCode, resRead.body.message);

    // Verify unread count decreased
    const resGet2 = mockResponse();
    await getDriverNotifications(reqGet, resGet2);
    console.log(`✅ After read: unreadCount is ${resGet2.body.unreadCount}`);

    // 4. Test mark all as read
    const reqReadAll = {
      driver: { id: testDriverId.toString() }
    };
    const resReadAll = mockResponse();
    await markAllDriverNotificationsRead(reqReadAll, resReadAll);
    console.log('✅ Mark all read:', resReadAll.body.message);

    // 5. Clean up
    await Notification.deleteMany({ title: { $regex: /^\[TEST\]/ } });
    console.log('✅ Cleanup complete');

    await mongoose.disconnect();
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
