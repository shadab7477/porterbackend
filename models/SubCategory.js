import mongoose from 'mongoose';

const subCategorySchema = new mongoose.Schema({
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category"
  },
  name: String,
  basePrice: Number,
  weight: Number,
  volume: Number,
  isFragile: Boolean,
  packingCharge: Number,
  requiresPacking: Boolean,
  laborTime: Number
}, { timestamps: true });

export default mongoose.model('SubCategory', subCategorySchema);
