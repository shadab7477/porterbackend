import mongoose from 'mongoose';

const merchantSettingsSchema = new mongoose.Schema({
  // Singleton key — only one document should exist
  key: {
    type: String,
    default: 'global',
    unique: true,
    immutable: true
  },

  // Price increase percentage applied to merchant rides
  priceIncreasePercent: {
    type: Number,
    default: 5,
    min: 0,
    max: 100
  },

  // Cashback percentage credited to merchant's wallet after ride completion
  cashbackPercent: {
    type: Number,
    default: 5,
    min: 0,
    max: 100
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  }
});

merchantSettingsSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Static helper to get the singleton settings (creates default if missing)
merchantSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: 'global' });
  if (!settings) {
    settings = await this.create({ key: 'global' });
  }
  return settings;
};

const MerchantSettings = mongoose.model('MerchantSettings', merchantSettingsSchema);

export default MerchantSettings;
