export const initializeSupportSockets = (io) => {
  const supportNamespace = io.of('/support');
  
  supportNamespace.on('connection', (socket) => {
    console.log('New support connection:', socket.id);

    // Join ticket room
    socket.on('join-ticket', (ticketId) => {
      socket.join(`ticket-${ticketId}`);
      console.log(`Socket ${socket.id} joined ticket-${ticketId}`);
    });

    // Leave ticket room
    socket.on('leave-ticket', (ticketId) => {
      socket.leave(`ticket-${ticketId}`);
      console.log(`Socket ${socket.id} left ticket-${ticketId}`);
    });

    // Join admin room for real-time notifications
    socket.on('join-admin', (adminId) => {
      socket.join('admin-room');
      socket.join(`admin-${adminId}`);
      console.log(`Admin ${adminId} connected`);
    });

    // Typing indicator
    socket.on('typing', ({ ticketId, userId, userName }) => {
      socket.to(`ticket-${ticketId}`).emit('user-typing', { userId, userName });
    });

    // Stop typing
    socket.on('stop-typing', ({ ticketId, userId }) => {
      socket.to(`ticket-${ticketId}`).emit('user-stop-typing', { userId });
    });

    // Mark message as read
    socket.on('mark-read', ({ ticketId, messageId, userId, userType }) => {
      // This would update the database
      socket.to(`ticket-${ticketId}`).emit('message-read', { messageId, userId, userType });
    });

    socket.on('disconnect', () => {
      console.log('Support connection disconnected:', socket.id);
    });
  });

  return supportNamespace;
};