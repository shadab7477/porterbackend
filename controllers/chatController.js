// controllers/chatController.js
import ChatMessage from '../models/ChatMessage.js';
import Ride from '../models/Ride.js';

// Send a message
export const sendMessage = async (req, res) => {
  try {
    const { rideId, message } = req.body;
    const userId = req.userId;
    const userType = req.userType;
    
    if (!rideId || !message) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID and message are required'
      });
    }
    
    // Verify ride exists
    const ride = await Ride.findOne({ rideId: rideId });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }
    
    // Determine sender and receiver
    let senderName, receiverId, receiverType;
    
    if (userType === 'driver') {
      // Check if driver is assigned to this ride
      if (!ride.driver || ride.driver.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to chat for this ride'
        });
      }
      
      senderName = ride.driver.name;
      receiverId = ride.customer.customerId;
      receiverType = 'customer';
      
    } else if (userType === 'customer') {
      // Check if customer is the one who requested the ride
      if (ride.customer.customerId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to chat for this ride'
        });
      }
      
      senderName = ride.customer.name;
      
      if (ride.driver && ride.driver.driverId) {
        receiverId = ride.driver.driverId;
        receiverType = 'driver';
      } else {
        return res.status(400).json({
          success: false,
          message: 'No driver assigned to this ride yet'
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user type'
      });
    }
    
    // Create and save message
    const chatMessage = new ChatMessage({
      rideId,
      senderId: userId,
      senderType: userType,
      senderName,
      receiverId,
      receiverType,
      message
    });
    
    await chatMessage.save();
    
    // Get IO instance
    const io = req.app.get('io');
    
    // Prepare message data for broadcast
    const messageData = {
      _id: chatMessage._id,
      rideId,
      senderId: userId,
      senderType: userType,
      senderName,
      message,
      createdAt: chatMessage.createdAt
    };
    
    // Emit to receiver's room
    const receiverRoom = `${receiverType}:${receiverId}`;
    io.to(receiverRoom).emit('chat:new_message', messageData);
    
    // Also emit to ride room
    io.to(`ride:${rideId}`).emit('chat:new_message', messageData);
    
    // Send response to sender
    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        _id: chatMessage._id,
        rideId,
        message,
        createdAt: chatMessage.createdAt
      }
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send message'
    });
  }
};

// Get chat history for a ride
export const getChatHistory = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.userId;
    const userType = req.userType;
    
    // Verify user is part of the ride
    const ride = await Ride.findOne({ rideId: rideId });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }
    
    let isAuthorized = false;
    
    if (userType === 'driver' && ride.driver && ride.driver.driverId.toString() === userId) {
      isAuthorized = true;
    } else if (userType === 'customer' && ride.customer.customerId.toString() === userId) {
      isAuthorized = true;
    }
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view chat history'
      });
    }
    
    // Get chat messages
    const messages = await ChatMessage.find({ rideId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();
    
    const total = await ChatMessage.countDocuments({ rideId });
    
    // Add flag to identify own messages
    const formattedMessages = messages.map(msg => ({
      ...msg,
      isOwnMessage: msg.senderId.toString() === userId.toString()
    }));
    
    res.json({
      success: true,
      data: {
        messages: formattedMessages.reverse(), // Chronological order
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
    
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get chat history'
    });
  }
};