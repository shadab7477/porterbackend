import express from 'express';
import {
    getTickets,
    getTicketById,
    createTicket,
    updateTicketStatus,
    assignTicket,
    addMessage,
    addCustomerMessage, // New public message handler
    escalateTicket,
    getUserTickets,
    getSupportStats,
    getUnassignedTickets,
    getMyTickets,
} from '../controllers/supportController.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// Public routes (for customers/drivers)
router.post('/tickets', createTicket);
router.post('/tickets/:id/messages', addCustomerMessage); // Public message endpoint
router.get('/user/:userId/:userType', getUserTickets);
router.get('/tickets/:id', adminAuth, getTicketById);

// Admin routes (protected)
router.get('/tickets', adminAuth, getTickets);
router.get('/stats', adminAuth, getSupportStats);
router.get('/unassigned', adminAuth, getUnassignedTickets);
router.get('/my-tickets', adminAuth, getMyTickets);
router.put('/tickets/:id/status', adminAuth, updateTicketStatus);
router.put('/tickets/:id/assign', adminAuth, assignTicket);
router.post('/tickets/:id/admin-messages', adminAuth, addMessage); // Admin message endpoint
router.post('/tickets/:id/escalate', adminAuth, escalateTicket);

export default router;