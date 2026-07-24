import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/porter_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  const Ride = (await import('./models/Ride.js')).default;
  const ride = await Ride.findOne({ rideId: 'RID84393997302' });
  console.log("Ride details:", JSON.stringify(ride, null, 2));
  mongoose.disconnect();
}).catch(err => {
  console.error("DB Error:", err);
  process.exit(1);
});
