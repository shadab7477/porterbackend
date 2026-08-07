import cron from 'node-cron';
import Customer from '../models/Customer.js';
import Driver from '../models/Driver.js';
import Notification from '../models/Notification.js';
import { sendNotification } from '../utils/notificationService.js';

// Dummy promotional notifications
const PROMOTIONAL_MESSAGES = [
  {
    title: 'Flash Sale! 🚀',
    message: 'Get 10% off on your next ride. Book now!',
    data: { type: 'promotion', discount: '10%' }
  },
  {
    title: 'Weekend Special! 🎉',
    message: 'Enjoy a flat ₹50 off on deliveries this weekend. Let us handle the heavy lifting!',
    data: { type: 'promotion', discount: '50_INR' }
  },
  {
    title: 'Refer & Earn! 🤝',
    message: 'Refer a friend and both of you get ₹100 added to your wallet!',
    data: { type: 'promotion', campaign: 'referral' }
  }
];

// Dummy promotional notifications for Drivers
const DRIVER_PROMOTIONAL_MESSAGES = [
  {
    title: 'Peak Hours Approaching! 📈',
    message: 'High demand expected in your area. Go online to earn 20% extra today!',
    data: { type: 'promotion', campaign: 'peak_hours' }
  },
  {
    title: 'Weekend Bonus 💰',
    message: 'Complete 10 rides this weekend and earn a guaranteed ₹500 bonus!',
    data: { type: 'promotion', campaign: 'weekend_bonus' }
  }
];

/**
 * Initializes all cron jobs for the backend server
 */
export const initializeCronJobs = () => {
  console.log('🕒 Initializing Cron Jobs...');

  // Schedule job for 10:00 AM every day
  // Format: 'Minute Hour DayOfMonth Month DayOfWeek'
  cron.schedule('0 10 * * *', async () => {
    console.log('📢 Running daily 10 AM promotional notification job...');
    
    try {
      // Pick a random promo message
      const randomPromo = PROMOTIONAL_MESSAGES[Math.floor(Math.random() * PROMOTIONAL_MESSAGES.length)];
      
      // Fetch all active customers who have an FCM token
      const customers = await Customer.find({ fcmToken: { $exists: true, $ne: null }, isBlocked: false });
      
      if (customers.length === 0) {
        console.log('No eligible customers found for promotional notification.');
        return;
      }
      
      const customerIds = customers.map(c => c._id);
      
      // 1. Save a single global Notification document for these users
      await Notification.create({
        title: randomPromo.title,
        message: randomPromo.message,
        recipientType: 'user', // Sending to users/customers
        recipientIds: customerIds,
        data: randomPromo.data
      });
      
      // 2. Broadcast push notifications
      let successCount = 0;
      let failureCount = 0;
      
      // Send notifications in parallel batches to prevent blocking
      const BATCH_SIZE = 50;
      for (let i = 0; i < customers.length; i += BATCH_SIZE) {
        const batch = customers.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (customer) => {
          const res = await sendNotification(customer.fcmToken, randomPromo.title, randomPromo.message, randomPromo.data);
          if (res.success) successCount++;
          else failureCount++;
        });
        
        await Promise.all(promises);
      }
      
      console.log(`✅ Promotional job completed: Sent ${successCount} notifications, failed ${failureCount}.`);
      
      
      // ============================================
      // PART 2: DRIVER NOTIFICATIONS
      // ============================================
      const randomDriverPromo = DRIVER_PROMOTIONAL_MESSAGES[Math.floor(Math.random() * DRIVER_PROMOTIONAL_MESSAGES.length)];
      const drivers = await Driver.find({ fcmToken: { $exists: true, $ne: null }, isBlocked: false });
      
      if (drivers.length > 0) {
        const driverIds = drivers.map(d => d._id);
        
        // Save DB Notification
        await Notification.create({
          title: randomDriverPromo.title,
          message: randomDriverPromo.message,
          recipientType: 'driver',
          recipientIds: driverIds,
          data: randomDriverPromo.data
        });
        
        let driverSuccessCount = 0;
        let driverFailureCount = 0;
        
        for (let i = 0; i < drivers.length; i += BATCH_SIZE) {
          const batch = drivers.slice(i, i + BATCH_SIZE);
          const promises = batch.map(async (driver) => {
            const res = await sendNotification(driver.fcmToken, randomDriverPromo.title, randomDriverPromo.message, randomDriverPromo.data);
            if (res.success) driverSuccessCount++;
            else driverFailureCount++;
          });
          await Promise.all(promises);
        }
        console.log(`✅ Driver Promotional job completed: Sent ${driverSuccessCount} notifications, failed ${driverFailureCount}.`);
      } else {
        console.log('No eligible drivers found for promotional notification.');
      }
      
    } catch (error) {
      console.error('❌ Error executing daily promotional job:', error);
    }
  });

  console.log('✅ Cron Jobs initialized.');
};
