import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.join(__dirname, '.env') });

const migrateWallets = async () => {
    try {
        console.log('Connecting to MongoDB...', process.env.MONGO_URI || process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/porter');
        console.log('Connected to MongoDB.');

        const db = mongoose.connection.db;

        // 1. Migrate Driver Wallets
        console.log('Fetching drivers...');
        const drivers = await db.collection('drivers').find({}).toArray();
        console.log(`Found ${drivers.length} drivers. Migrating wallet balances...`);

        let driverWalletsCreated = 0;
        for (const driver of drivers) {
            const balance = driver.walletBalance || 0;
            
            // Upsert driver wallet
            await db.collection('driverwallets').updateOne(
                { driverId: driver._id },
                { 
                    $set: { 
                        balance: balance,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            driverWalletsCreated++;
        }
        console.log(`Successfully migrated ${driverWalletsCreated} driver wallets.`);

        // 2. Empty Customer Wallets (and cleanup raw data)
        console.log('Cleaning up customer wallets...');
        await db.collection('customerwallets').deleteMany({});
        await db.collection('customerwallettransactions').deleteMany({});
        console.log('Customer wallets and transactions cleared.');

        // 3. Remove old walletBalance field from raw documents
        console.log('Removing old walletBalance fields from drivers and customers collections...');
        const driverUpdateResult = await db.collection('drivers').updateMany(
            { walletBalance: { $exists: true } },
            { $unset: { walletBalance: "" } }
        );
        const customerUpdateResult = await db.collection('customers').updateMany(
            { walletBalance: { $exists: true } },
            { $unset: { walletBalance: "" } }
        );
        
        console.log(`Cleaned up ${driverUpdateResult.modifiedCount} driver documents.`);
        console.log(`Cleaned up ${customerUpdateResult.modifiedCount} customer documents.`);

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateWallets();
