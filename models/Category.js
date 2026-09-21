import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: String,
  icon: String
}, { timestamps: true });

export default mongoose.model('Category', categorySchema);
