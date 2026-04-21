import Category from '../models/Category.js';
import SubCategory from '../models/SubCategory.js';
import PricingRule from '../models/PricingRule.js';

// Category Management
export const createCategory = async (req, res) => {
  try {
    const category = new Category(req.body);
    await category.save();
    res.status(201).json({ success: true, category });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find().lean();
    res.status(200).json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ success: true, category });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// SubCategory (Item) Management
export const createSubCategory = async (req, res) => {
  try {
    const subCategory = new SubCategory(req.body);
    await subCategory.save();
    res.status(201).json({ success: true, subCategory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSubCategories = async (req, res) => {
  try {
    const subCategories = await SubCategory.find().populate('categoryId').lean();
    res.status(200).json({ success: true, subCategories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSubCategoriesByCategory = async (req, res) => {
  try {
    const subCategories = await SubCategory.find({ categoryId: req.params.categoryId }).lean();
    res.status(200).json({ success: true, subCategories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateSubCategory = async (req, res) => {
  try {
    const subCategory = await SubCategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ success: true, subCategory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSubCategory = async (req, res) => {
  try {
    await SubCategory.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'SubCategory deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Pricing Rules Management
export const createOrUpdatePricingRule = async (req, res) => {
  try {
    const { type, value } = req.body;
    let rule = await PricingRule.findOne({ type });
    if (rule) {
      rule.value = value;
      await rule.save();
    } else {
      rule = new PricingRule({ type, value });
      await rule.save();
    }
    res.status(200).json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPricingRules = async (req, res) => {
  try {
    const rules = await PricingRule.find().lean();
    res.status(200).json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePricingRule = async (req, res) => {
  try {
    const { type } = req.params;
    const { value } = req.body;
    let rule = await PricingRule.findOne({ type });
    if (rule) {
      rule.value = value;
      await rule.save();
    } else {
      rule = new PricingRule({ type, value });
      await rule.save();
    }
    res.status(200).json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Calculation Logic
export const calculatePrice = async (req, res) => {
  try {
    const { items, distance, options } = req.body;

    let totalWeight = 0;
    let itemCost = 0;
    let extraCost = 0;

    // preload rules (important optimization)
    const pricingRules = await PricingRule.find().lean();

    const getRule = (type) =>
      pricingRules.find(r => r.type === type)?.value || 0;

    for (let i of items) {
      const itemData = await SubCategory.findById(i.itemId).lean();
      if (!itemData) continue;

      const qty = i.qty || 1;
      totalWeight += (itemData.weight || 0) * qty;
      itemCost += (itemData.basePrice || 0) * qty;

      // Fragile charge
      if (itemData.isFragile) {
        extraCost += getRule("fragile") * qty;
      }

      // Packing charge
      if (options?.includePacking && itemData.packingCharge) {
        extraCost += itemData.packingCharge * qty;
      }
    }

    // No lift charge
    if (options && !options.hasLift) {
      extraCost += getRule("noLift");
    }

    // Floor charge
    if (options && options.floors > 0) {
      extraCost += getRule("perFloor") * options.floors;
    }

    // Distance charge (admin configurable later)
    const distanceCharge = (distance || 0) * 10;

    const totalPrice = itemCost + extraCost + distanceCharge;

    res.status(200).json({
      success: true,
      data: {
        totalWeight,
        itemCost,
        extraCost,
        distanceCharge,
        totalPrice
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
