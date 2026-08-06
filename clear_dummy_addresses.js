import mongoose from 'mongoose';
import Customer from './models/Customer.js';
import dotenv from 'dotenv';
dotenv.config();

const clearAddresses = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const customer = await Customer.findOne({ phone: '7477246478' });
    if (customer) {
      customer.savedAddresses = [];
      await customer.save();
      console.log('Successfully cleared saved addresses for PlayStore Tester');
    } else {
      console.log('Dummy customer not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
};

clearAddresses();
