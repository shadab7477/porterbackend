import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Customer from './models/Customer.js';
import { sendNotification } from './utils/notificationService.js';

dotenv.config();

const runTest = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/godelivo');
        console.log('DB Connected');
        
        // Find a customer with an fcmToken
        const customer = await Customer.findOne({ fcmToken: { $exists: true, $ne: null } });
        if (!customer) {
            console.log('No customer found with fcmToken in DB. This is why it is failing!');
            process.exit(1);
        }
        
        console.log(`Found Customer: ${customer.name || customer.phone}, Token: ${customer.fcmToken.substring(0, 20)}...`);
        
        const res = await sendNotification(customer.fcmToken, 'Test Notification', 'This is a test to verify FCM', { type: 'test' });
        console.log('Notification Response:', res);
        
    } catch (err) {
        console.error('Error:', err);
    } finally {
        mongoose.disconnect();
        process.exit(0);
    }
}

runTest();
