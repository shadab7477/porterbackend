import mongoose from 'mongoose';

const goodsItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  maxWeight: {
    type: Number, // in kg
    default: null
  },
  maxDimensions: {
    length: { type: Number, default: null }, // in cm
    width: { type: Number, default: null }, // in cm
    height: { type: Number, default: null }, // in cm
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

goodsItemSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const GoodsItem = mongoose.model('GoodsItem', goodsItemSchema);

export default GoodsItem;