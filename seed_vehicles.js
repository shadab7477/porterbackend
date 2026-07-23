import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Vehicle from './models/Vehicle.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const vehiclesToSeed = [
  {
    category: '2 Wheelers',
    vehicleType: 'bike',
    name: 'Bike',
    baseFare: 25,
    pricePerKm: 10,
    mainPricePerKm: 15,
    capacity: 1, // Default capacity, adjust if needed
    weight: '20 KG',
  },
  {
    category: '2 Wheelers',
    vehicleType: 'scooter',
    name: 'Scooter',
    baseFare: 35,
    pricePerKm: 12.5,
    mainPricePerKm: 20,
    capacity: 1,
    weight: '20 KG',
  },
  {
    category: '3 Wheelers',
    vehicleType: 'mini_3w',
    name: 'Mini 3W',
    baseFare: 120,
    pricePerKm: 12.5,
    mainPricePerKm: 35,
    capacity: 1,
    weight: '500 KG',
  },
  {
    category: '3 Wheelers',
    vehicleType: 'e_loader',
    name: 'E Loader',
    baseFare: 175,
    pricePerKm: 17.5,
    mainPricePerKm: 45,
    capacity: 1,
    weight: '750 KG',
  },
  {
    category: '3 Wheelers',
    vehicleType: '3_wheeler',
    name: '3 Wheeler',
    baseFare: 250,
    pricePerKm: 32.5,
    mainPricePerKm: 60,
    capacity: 1,
    weight: '1000 KG',
  },
  {
    category: '4 Wheelers',
    vehicleType: 'tata_ace',
    name: 'Tata Ace',
    baseFare: 360,
    pricePerKm: 30,
    mainPricePerKm: 90,
    capacity: 1,
    weight: '1500 KG',
  }
];

const seedVehicles = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    for (const vehicleData of vehiclesToSeed) {
      // Upsert vehicle by vehicleType
      const result = await Vehicle.findOneAndUpdate(
        { vehicleType: vehicleData.vehicleType },
        { $set: vehicleData },
        { new: true, upsert: true }
      );
      console.log(`Upserted vehicle: ${result.name}`);
    }

    console.log('Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding vehicles:', error);
    process.exit(1);
  }
};

seedVehicles();
