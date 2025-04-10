const WebSocket = require('ws');
const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Map(); // Maps client -> username

function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function updateActiveUsers() {
  const activeUsers = [...clients.values()];
  broadcast({ type: 'users', users: activeUsers });
}

wss.on('connection', (ws) => {
  let username = '';

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      return;
    }

    // Handle first-time connection (with username)
    if (data.type === 'join') {
      username = data.username;
      clients.set(ws, username);

      // Send join message
      broadcast({
        type: 'system',
        message: `${username} joined the chat.`,
      });

      updateActiveUsers();
      return;
    }

    // Normal message
    if (data.type === 'message') {
      broadcast({
        type: 'message',
        username,
        message: data.message,
        replyTo: data.replyTo || null,
      });
    }

    // Reaction
    if (data.type === 'reaction') {
      broadcast({
        type: 'reaction',
        username,
        messageId: data.messageId,
        reaction: data.reaction
      });
    }
  });

  ws.on('close', () => {
    if (username) {
      clients.delete(ws);
      broadcast({
        type: 'system',
        message: `${username} left the chat.`,
      });
      updateActiveUsers();
    }
  });

  // Optional welcome message to new user
  ws.send(JSON.stringify({
    type: 'system',
    message: 'Welcome to the chat!',
  }));
});

console.log(`WebSocket server running on port ${PORT}`);
