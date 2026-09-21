export const initializePackerSockets = (io) => {
  const packerNamespace = io.of('/packer-tracking'); // Optional namespace or use default

  io.on('connection', (socket) => {
    console.log(`🔌 Packer Socket Connected: ${socket.id}`);

    // Join a specific booking room to listen for updates
    socket.on('join_booking_room', (data) => {
      if (data && data.bookingId) {
        const roomName = `booking_${data.bookingId}`;
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined room: ${roomName}`);
        socket.emit('joined_room', { success: true, room: roomName });
      } else {
        socket.emit('error', 'Booking ID is required to join room');
      }
    });

    // Leave booking room
    socket.on('leave_booking_room', (data) => {
      if (data && data.bookingId) {
        const roomName = `booking_${data.bookingId}`;
        socket.leave(roomName);
        console.log(`Socket ${socket.id} left room: ${roomName}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Packer Socket Disconnected: ${socket.id}`);
    });
  });
};
