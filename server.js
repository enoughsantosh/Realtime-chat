const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "chat")));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'] // Important for Vercel compatibility
});


// Store active users and chat history
const activeUsers = new Map(); // socket.id -> username
const chatHistory = [];
const MAX_HISTORY = 50; // Keep last 50 messages

// Socket.io events
io.on("connection", (socket) => {
    console.log(`New connection: ${socket.id}`);
    
    // Send chat history to new users
    socket.emit("chatHistory", chatHistory);
    
    // Send active users list
    io.emit("activeUsers", Array.from(activeUsers.values()));
    
    // User joins with username
    socket.on("userJoin", (username) => {
        activeUsers.set(socket.id, username);
        
        // Broadcast user joined notification
        const joinMessage = {
            id: Date.now().toString(),
            type: "notification",
            content: `${username} joined the chat`,
            timestamp: new Date().toISOString()
        };
        
        chatHistory.push(joinMessage);
        io.emit("message", joinMessage);
        io.emit("activeUsers", Array.from(activeUsers.values()));
        
        console.log(`User joined: ${username}`);
    });
    
    // User sends message
    socket.on("chatMessage", (msg) => {
        const username = activeUsers.get(socket.id) || "Anonymous";
        
        const messageData = {
            id: Date.now().toString(),
            type: "message",
            username: username,
            content: msg.content,
            timestamp: new Date().toISOString(),
            replyTo: msg.replyTo || null
        };
        
        // Add to chat history
        chatHistory.push(messageData);
        if (chatHistory.length > MAX_HISTORY) {
            chatHistory.shift(); // Remove oldest message
        }
        
        // Broadcast to all clients
        io.emit("message", messageData);
        
        console.log(`Message from ${username}: ${msg.content}`);
    });
    
    // User is typing
    socket.on("typing", () => {
        const username = activeUsers.get(socket.id);
        if (username) {
            socket.broadcast.emit("userTyping", username);
        }
    });
    
    // User stops typing
    socket.on("stopTyping", () => {
        const username = activeUsers.get(socket.id);
        if (username) {
            socket.broadcast.emit("userStopTyping", username);
        }
    });
    
    // User reacts to message
    socket.on("reaction", (data) => {
        const username = activeUsers.get(socket.id) || "Anonymous";
        
        // Find message in history and add reaction
        const message = chatHistory.find(msg => msg.id === data.messageId);
        if (message) {
            // Initialize reactions array if it doesn't exist
            if (!message.reactions) {
                message.reactions = [];
            }
            
            // Check if user already reacted with this emoji
            const existingReaction = message.reactions.findIndex(
                r => r.emoji === data.emoji && r.username === username
            );
            
            if (existingReaction >= 0) {
                // Remove reaction if it exists (toggle behavior)
                message.reactions.splice(existingReaction, 1);
            } else {
                // Add new reaction
                message.reactions.push({
                    username,
                    emoji: data.emoji
                });
            }
            
            // Broadcast updated reactions
            io.emit("messageReaction", {
                messageId: data.messageId,
                reactions: message.reactions
            });
        }
    });
    
    // User deletes message
    socket.on("deleteMessage", (messageId) => {
        const username = activeUsers.get(socket.id);
        
        // Find message index in history
        const messageIndex = chatHistory.findIndex(msg => msg.id === messageId);
        
        // Only allow deletion if it's the user's own message
        if (messageIndex >= 0 && chatHistory[messageIndex].username === username) {
            // Mark as deleted rather than removing
            chatHistory[messageIndex].deleted = true;
            chatHistory[messageIndex].content = "This message was deleted";
            
            // Broadcast deletion
            io.emit("messageDeleted", messageId);
        }
    });
    
    // User disconnects
    socket.on("disconnect", () => {
        const username = activeUsers.get(socket.id);
        
        if (username) {
            // Remove from active users
            activeUsers.delete(socket.id);
            
            // Broadcast user left notification
            const leaveMessage = {
                id: Date.now().toString(),
                type: "notification",
                content: `${username} left the chat`,
                timestamp: new Date().toISOString()
            };
            
            chatHistory.push(leaveMessage);
            io.emit("message", leaveMessage);
            io.emit("activeUsers", Array.from(activeUsers.values()));
            
            console.log(`User disconnected: ${username}`);
        } else {
            console.log("Anonymous user disconnected");
        }
    });
});

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Export the server for Vercel
module.exports = server;


