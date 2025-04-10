const WebSocket = require('ws');
const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  console.log("Client connected");

  ws.on('message', (message) => {
    // Expecting JSON string
    const data = message.toString(); // ensure it's a string
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data); // just forward the message
      }
    });
  });

  ws.send(JSON.stringify({ username: "System", message: "Welcome to the chat!" }));
});

console.log(`WebSocket server running on port ${PORT}`);
