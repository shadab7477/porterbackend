import express from 'express';
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  createSubCategory,
  getSubCategories,
  getSubCategoriesByCategory,
  updateSubCategory,
  deleteSubCategory,
  createOrUpdatePricingRule,
  getPricingRules,
  updatePricingRule,
  calculatePrice
} from '../controllers/adminPricingController.js';

const router = express.Router();

// Category
router.post('/category', createCategory);
router.get('/categories', getCategories);
router.put('/category/:id', updateCategory);
router.delete('/category/:id', deleteCategory);

// Subcategories
router.post('/subcategory', createSubCategory);
router.get('/subcategories', getSubCategories);
router.get('/subcategories/:categoryId', getSubCategoriesByCategory);
router.put('/subcategory/:id', updateSubCategory);
router.delete('/subcategory/:id', deleteSubCategory);

// Pricing Rules
router.post('/pricing-rule', createOrUpdatePricingRule);
router.get('/pricing-rules', getPricingRules);
router.put('/pricing-rule/:type', updatePricingRule);

// Calculation
router.post('/calculate-price', calculatePrice);

export default router;
