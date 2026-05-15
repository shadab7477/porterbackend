import mongoose from 'mongoose';

const vehiclePricingSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: ['2 Wheelers', '3 Wheelers', '4 Wheelers', 'Other'],
      default: '2 Wheelers',
    },
    type: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      // e.g. 'bike', 'mini_3w', 'tata_ace'
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      // e.g. 'Bike & Scooty'
    },
    ratePerKm: {
      type: Number,
      required: true,
      min: 0,
    },
    subscriptionFee: {
      type: Number,
      required: true,
      min: 0,
      default: 0, // temporary default for existing documents – remove after migration
    },
    image: {
      url: {
        type: String,
        required: true,
      },
      publicId: {
        type: String,
        required: true,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('VehiclePricing', vehiclePricingSchema);