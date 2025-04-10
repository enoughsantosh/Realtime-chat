const WebSocket = require('ws');
const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Map(); // Maps ws => { username, isTyping }

function broadcast(data, exclude = null) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function updateActiveUsers() {
  const users = [...clients.values()].map(c => c.username);
  broadcast({ type: 'users', users });
}

wss.on('connection', (ws) => {
  clients.set(ws, { username: null, isTyping: false });

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      return;
    }

    const client = clients.get(ws);

    // Initial join
    if (data.type === 'join') {
      client.username = data.username;
      broadcast({ type: 'system', message: `${client.username} joined the chat.` });
      updateActiveUsers();
      return;
    }

    // Typing indicator
    if (data.type === 'typing') {
      client.isTyping = data.isTyping;
      broadcast({ type: 'typing', username: client.username, isTyping: client.isTyping }, ws);
      return;
    }

    // Read receipt
    if (data.type === 'read') {
      broadcast({ type: 'read', username: client.username });
      return;
    }

    // Normal message
    if (data.type === 'message') {
      const timestamp = new Date().toISOString();
      broadcast({
        type: 'message',
        username: client.username,
        message: data.message,
        replyTo: data.replyTo || null,
        timestamp,
        id: data.id || Date.now().toString()
      });
      return;
    }

    // Reaction
    if (data.type === 'reaction') {
      broadcast({
        type: 'reaction',
        username: client.username,
        messageId: data.messageId,
        reaction: data.reaction
      });
      return;
    }

    // Message deletion
    if (data.type === 'delete') {
      broadcast({
        type: 'delete',
        messageId: data.messageId,
        username: client.username
      });
      return;
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client.username) {
      broadcast({ type: 'system', message: `${client.username} left the chat.` });
      clients.delete(ws);
      updateActiveUsers();
    }
  });

  ws.send(JSON.stringify({
    type: 'system',
    message: 'Welcome to the chat!'
  }));
});

console.log(`WebSocket server running on port ${PORT}`);
