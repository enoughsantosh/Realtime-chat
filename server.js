// server.js (Node.js for Vercel)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins (for development, restrict in production)
  },
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html'); // Serve your HTML file
});

io.on('connection', (socket) => {
  let username;

  socket.on('set username', (name) => {
    username = name;
    console.log(`${username} connected`);
    io.emit('user joined', `${username} joined the chat`);
  });

  socket.on('chat message', (msg) => {
    io.emit('chat message', { username, message: msg, timestamp: Date.now() });
  });

  socket.on('reply', (replyData) => {
    io.emit('reply', replyData);
  });

  socket.on('disconnect', () => {
    if (username) {
      console.log(`${username} disconnected`);
      io.emit('user left', `${username} left the chat`);
    }
  });
});

module.exports = app; // Export for Vercel

// index.html (Frontend)
/*
Create a file named index.html in the same directory as server.js.
*/
