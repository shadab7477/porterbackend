import mongoose from 'mongoose';

const pricingRuleSchema = new mongoose.Schema({
  type: String, // "fragile", "noLift", "perFloor"
  value: Number
});

export default mongoose.model('PricingRule', pricingRuleSchema);
