import FAQ from '../models/FAQ.js';

// PUBLIC: Get all published FAQs (optionally filter by category)
export const getPublicFAQs = async (req, res) => {
  try {
    const filter = { isPublished: true };
    if (req.query.category && ['user', 'driver', 'general'].includes(req.query.category)) {
      filter.category = req.query.category;
    }
    const faqs = await FAQ.find(filter).sort({ category: 1, order: 1, createdAt: 1 });
    res.json({ success: true, data: faqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADMIN: Get all FAQs (including unpublished)
export const getAllFAQs = async (req, res) => {
  try {
    const faqs = await FAQ.find().sort({ category: 1, order: 1, createdAt: 1 });
    res.json({ success: true, data: faqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADMIN: Create FAQ
export const createFAQ = async (req, res) => {
  try {
    const { question, answer, category, subcategory, order, isPublished } = req.body;
    if (!question || !answer || !category) {
      return res.status(400).json({ success: false, message: 'Question, answer and category are required' });
    }
    const faq = await FAQ.create({
      question,
      answer,
      category,
      subcategory: subcategory || '',
      order: order || 0,
      isPublished: isPublished !== false
    });
    res.status(201).json({ success: true, data: faq, message: 'FAQ created successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADMIN: Update FAQ
export const updateFAQ = async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!faq) return res.status(404).json({ success: false, message: 'FAQ not found' });
    res.json({ success: true, data: faq, message: 'FAQ updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADMIN: Delete FAQ
export const deleteFAQ = async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndDelete(req.params.id);
    if (!faq) return res.status(404).json({ success: false, message: 'FAQ not found' });
    res.json({ success: true, message: 'FAQ deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
