import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/logistics_db', {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err?.message || err}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected. Mongoose will attempt automatic reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🟢 MongoDB reconnected successfully');
    });

  } catch (error) {
    console.error(`❌ Initial connection error to MongoDB: ${error.message}`);
    // Keep server process running even if DB initially fails; Mongoose will retry when available
  }
};

export default connectDB;