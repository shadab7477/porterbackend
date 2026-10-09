// sockets/supportSocketHandler.js
import jwt from 'jsonwebtoken';

export const initializeSupportSockets = (io) => {
  const supportNamespace = io.of('/support');

  // Socket middleware for authentication (optional for public, but decodes if token provided)
  supportNamespace.use((socket, next) => {
    try {
      const token = 
        socket.handshake.auth?.token || 
        socket.handshake.query?.token || 
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
      }
    } catch (err) {
      // Allow connection but mark unauthenticated
      socket.user = null;
    }
    next();
  });

  supportNamespace.on('connection', (socket) => {
    console.log('🔌 New support socket connection:', socket.id, socket.user ? `(User: ${socket.user.id || socket.user.role})` : '(Guest)');

    // Join ticket room
    socket.on('join-ticket', (ticketId) => {
      if (!ticketId) return;
      const tid = typeof ticketId === 'object' ? (ticketId.ticketId || ticketId._id || ticketId.id) : ticketId;
      if (tid) {
        socket.join(`ticket-${tid}`);
        console.log(`Socket ${socket.id} joined ticket-${tid}`);
      }
    });

    // Leave ticket room
    socket.on('leave-ticket', (ticketId) => {
      if (!ticketId) return;
      const tid = typeof ticketId === 'object' ? (ticketId.ticketId || ticketId._id || ticketId.id) : ticketId;
      if (tid) {
        socket.leave(`ticket-${tid}`);
        console.log(`Socket ${socket.id} left ticket-${tid}`);
      }
    });

    // Join admin room for real-time ticket alerts (only for admins)
    socket.on('join-admin', (adminId) => {
      if (socket.user && (socket.user.role === 'admin' || socket.user.role === 'super_admin' || socket.user.type === 'admin_auth')) {
        socket.join('admin-room');
        socket.join(`admin-${adminId || socket.user.id}`);
        console.log(`Admin ${adminId || socket.user.id} joined admin-room`);
      } else {
        // In dev or backward compat, join admin-room
        socket.join('admin-room');
        if (adminId) socket.join(`admin-${adminId}`);
      }
    });

    // Join user-specific notification room
    socket.on('join-user', (userId) => {
      if (userId) {
        socket.join(`user-${userId}`);
        console.log(`User ${userId} joined user-${userId} room`);
      }
    });

    // Typing indicator
    socket.on('typing', ({ ticketId, userId, userName }) => {
      if (ticketId) {
        socket.to(`ticket-${ticketId}`).emit('user-typing', { ticketId, userId, userName });
      }
    });

    // Stop typing
    socket.on('stop-typing', ({ ticketId, userId }) => {
      if (ticketId) {
        socket.to(`ticket-${ticketId}`).emit('user-stop-typing', { ticketId, userId });
      }
    });

    // Mark message as read
    socket.on('mark-read', ({ ticketId, messageId, userId, userType }) => {
      if (ticketId) {
        socket.to(`ticket-${ticketId}`).emit('message-read', { ticketId, messageId, userId, userType });
      }
    });

    socket.on('disconnect', () => {
      console.log('🔌 Support socket disconnected:', socket.id);
    });
  });

  return supportNamespace;
};

export default initializeSupportSockets;