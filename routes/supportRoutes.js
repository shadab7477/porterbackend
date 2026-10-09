// routes/supportRoutes.js
import express from 'express';
import {
  getCategories,
  getSupportConfig,
  createTicket,
  getMyTickets,
  getTicketById,
  addMessage,
  addCustomerMessage,
  addAttachment,
  closeTicket,
  reopenTicket,
  markTicketRead,
  getTickets,
  updateTicketStatus,
  assignTicket,
  updatePriority,
  escalateTicket,
  getRelatedRideData,
  getSupportStats,
  getUnassignedTickets,
  getAdminMyTickets,
  getUserTickets
} from '../controllers/supportController.js';
import adminAuth from '../middleware/adminAuth.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// =========================================================================
// 1. PUBLIC / CONFIGURATION ROUTES
// =========================================================================
router.get('/categories', getCategories);
router.get('/config', getSupportConfig);

// =========================================================================
// 2. AUTHENTICATED USER & DRIVER TICKET ROUTES
// =========================================================================
// List authenticated user's tickets
router.get('/tickets/my', authMiddleware, getMyTickets);

// Create new ticket / complaint
router.post('/tickets', optionalAuthMiddleware, createTicket);

// Public/legacy fetch tickets by user id
router.get('/user/:userId/:userType', getUserTickets);

// Single ticket details (Auth handles user vs admin permissions)
router.get('/tickets/:id', optionalAuthMiddleware, getTicketById);

// Add message / reply to ticket
router.post('/tickets/:id/messages', optionalAuthMiddleware, addMessage);
router.post('/tickets/:id/customer-messages', optionalAuthMiddleware, addCustomerMessage);

// Upload & attach file to ticket
router.post(
  '/tickets/:id/attachments',
  optionalAuthMiddleware,
  upload.single('file'),
  handleMulterError,
  addAttachment
);

// Mark messages as read
router.patch('/tickets/:id/read', optionalAuthMiddleware, markTicketRead);

// Close ticket
router.post('/tickets/:id/close', optionalAuthMiddleware, closeTicket);

// Reopen ticket
router.post('/tickets/:id/reopen', optionalAuthMiddleware, reopenTicket);

// =========================================================================
// 3. ADMIN & SUPPORT AGENT ROUTES (Protected by adminAuth)
// =========================================================================
router.get('/admin/tickets', adminAuth, getTickets);
router.get('/admin/stats', adminAuth, getSupportStats);
router.get('/stats', adminAuth, getSupportStats);
router.get('/unassigned', adminAuth, getUnassignedTickets);
router.get('/my-tickets', adminAuth, getAdminMyTickets);

// Legacy admin get tickets route
router.get('/tickets', (req, res, next) => {
  // If authorization header has admin token, route to getTickets
  adminAuth(req, res, () => getTickets(req, res, next));
});

// Admin lifecycle & management actions
router.put('/tickets/:id/status', adminAuth, updateTicketStatus);
router.patch('/tickets/:id/status', adminAuth, updateTicketStatus);
router.put('/tickets/:id/assign', adminAuth, assignTicket);
router.put('/tickets/:id/priority', adminAuth, updatePriority);
router.post('/tickets/:id/admin-messages', adminAuth, addMessage);
router.post('/tickets/:id/escalate', adminAuth, escalateTicket);
router.get('/tickets/:id/related-ride', adminAuth, getRelatedRideData);

export default router;