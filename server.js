const WebSocket = require('ws');
const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

// Store client information
const clients = new Map(); // Maps ws => client info object

// Store messages for history and tracking
const messageHistory = [];
const MAX_HISTORY = 100;
const messages = new Map(); // messageId => { readers: Set<username>, ... }

/**
 * Broadcasts a message to all connected clients except excluded ones
 * @param {Object} data - Data to broadcast
 * @param {WebSocket} exclude - Client to exclude (optional)
 */
function broadcast(data, exclude = null) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Updates the active users list for all clients
 */
function updateActiveUsers() {
  const users = [...clients.values()].map(c => ({
    username: c.username,
    status: c.status,
    avatar: c.avatar,
    lastSeen: c.lastSeen
  }));
  
  broadcast({ type: 'users', users });
}

/**
 * Detects mentions in a message
 * @param {string} message - The message to check for mentions
 * @returns {string[]} - Array of mentioned usernames
 */
function detectMentions(message) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(message)) !== null) {
    mentions.push(match[1]); // Capture the username without @
  }
  return mentions;
}

/**
 * Sends a push notification to a specific user
 * @param {string} username - Username to notify
 * @param {Object} notification - Notification data
 */
function sendPushNotification(username, notification) {
  for (const [ws, clientInfo] of clients.entries()) {
    if (clientInfo.username === username && clientInfo.notificationsEnabled) {
      ws.send(JSON.stringify({
        type: 'pushNotification',
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        data: notification.data
      }));
    }
  }
}

// Set up WebSocket server connection handler
wss.on('connection', (ws) => {
  // Initialize client information
  clients.set(ws, { 
    username: null, 
    isTyping: false,
    avatar: null,
    status: 'online',
    aboutMe: '',
    lastSeen: new Date().toISOString(),
    notificationsEnabled: false
  });

  // Handle incoming messages
  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      console.error('Invalid message format:', err);
      return;
    }

    const client = clients.get(ws);

    // Handle different message types
    switch (data.type) {
      // Initial join
      case 'join':
        client.username = data.username;
        client.lastSeen = new Date().toISOString();
        broadcast({ type: 'system', message: `${client.username} joined the chat.` });
        updateActiveUsers();

        // Send message history to new user
        ws.send(JSON.stringify({
          type: 'history',
          messages: messageHistory
        }));
        break;

      // Typing indicator
      case 'typing':
        client.isTyping = data.isTyping;
        broadcast({ 
          type: 'typing', 
          username: client.username, 
          isTyping: client.isTyping 
        }, ws);
        break;

      // Read receipt
      case 'read':
        const messageId = data.messageId;
        const username = client.username;
        
        if (messages.has(messageId)) {
          const messageInfo = messages.get(messageId);
          messageInfo.readers.add(username);
          
          broadcast({
            type: 'messageRead',
            messageId: messageId,
            readBy: Array.from(messageInfo.readers)
          });
        }
        break;

      // Normal message
      case 'message':
        const timestamp = new Date().toISOString();
        const newMessageId = data.id || Date.now().toString();
        
        // Create message object
        const messageData = {
          type: 'message',
          username: client.username,
          message: data.message,
          format: data.format || 'plaintext', // Format type (plaintext, markdown, html)
          replyTo: data.replyTo || null,
          timestamp,
          id: newMessageId
        };
        
        // Track message for read status
        messages.set(newMessageId, {
          timestamp,
          readers: new Set(),
          sender: client.username
        });
        
        // Add to history and trim if necessary
        messageHistory.push(messageData);
        if (messageHistory.length > MAX_HISTORY) {
          messageHistory.shift();
        }
        
        // Detect mentions and add them to the message data
        const mentions = detectMentions(data.message);
        if (mentions.length > 0) {
          messageData.mentions = mentions;
        }
        
        broadcast(messageData);
        
        // Send notifications for mentions
        if (mentions.length > 0) {
          for (const [clientWs, clientInfo] of clients.entries()) {
            if (mentions.includes(clientInfo.username)) {
              clientWs.send(JSON.stringify({
                type: 'notification',
                notificationType: 'mention',
                from: client.username,
                message: data.message,
                messageId: messageData.id,
                timestamp
              }));
              
              // Send push notification if enabled
              if (clientInfo.notificationsEnabled) {
                sendPushNotification(clientInfo.username, {
                  title: `@${client.username} mentioned you`,
                  body: data.message,
                  icon: client.avatar || null,
                  data: { messageId: messageData.id }
                });
              }
            }
          }
        }
        break;

      // Edit message
      case 'edit':
        broadcast({
          type: 'edit',
          messageId: data.messageId,
          username: client.username,
          newMessage: data.newMessage,
          editedAt: new Date().toISOString()
        });
        
        // Update message in history
        const editIndex = messageHistory.findIndex(m => m.id === data.messageId);
        if (editIndex !== -1) {
          messageHistory[editIndex].message = data.newMessage;
          messageHistory[editIndex].edited = true;
          messageHistory[editIndex].editedAt = new Date().toISOString();
        }
        break;

      // Reaction
      case 'reaction':
        broadcast({
          type: 'reaction',
          username: client.username,
          messageId: data.messageId,
          reaction: data.reaction
        });
        break;

      // File upload
      case 'file':
        const fileTimestamp = new Date().toISOString();
        const fileData = {
          type: 'file',
          username: client.username,
          filename: data.filename,
          content: data.content,
          mime: data.mime,
          timestamp: fileTimestamp,
          id: data.id
        };
        
        // Generate preview info based on MIME type
        if (data.mime.startsWith('image/')) {
          fileData.preview = {
            type: 'image',
            thumbnailContent: data.thumbnail || null,
            width: data.width,
            height: data.height
          };
        } else if (data.mime.startsWith('video/')) {
          fileData.preview = {
            type: 'video',
            poster: data.poster || null,
            duration: data.duration
          };
        } else if (data.mime.startsWith('audio/')) {
          fileData.preview = {
            type: 'audio',
            duration: data.duration
          };
        } else if (data.mime === 'application/pdf') {
          fileData.preview = {
            type: 'pdf',
            pageCount: data.pageCount
          };
        } else if (data.mime.includes('text/') || data.mime === 'application/json') {
          fileData.preview = {
            type: 'text',
            snippet: data.snippet || null
          };
        }
        
        // Add to message history
        messageHistory.push(fileData);
        if (messageHistory.length > MAX_HISTORY) {
          messageHistory.shift();
        }
        
        broadcast(fileData);
        break;

      // Message deletion
      case 'delete':
        broadcast({
          type: 'delete',
          messageId: data.messageId,
          username: client.username
        });
        
        // Remove from history
        const deleteIndex = messageHistory.findIndex(m => m.id === data.messageId);
        if (deleteIndex !== -1) {
          messageHistory.splice(deleteIndex, 1);
        }
        
        // Remove from messages map
        messages.delete(data.messageId);
        break;

      // Profile update
      case 'profile':
        // Update only the fields the user sent
        if (data.avatar !== undefined) client.avatar = data.avatar;
        if (data.status !== undefined) client.status = data.status;
        if (data.aboutMe !== undefined) client.aboutMe = data.aboutMe;
        
        // Broadcast the profile update
        broadcast({
          type: 'profile',
          username: client.username,
          avatar: client.avatar,
          status: client.status,
          aboutMe: client.aboutMe
        });
        
        // Update users list
        updateActiveUsers();
        break;

      // Notification settings
      case 'notificationSettings':
        client.notificationsEnabled = data.enabled;
        break;

      default:
        console.warn('Unknown message type:', data.type);
    }
  });

  // Handle disconnections
  ws.on('close', () => {
    const client = clients.get(ws);
    if (client.username) {
      // Update last seen timestamp
      client.lastSeen = new Date().toISOString();
      client.status = 'offline';
      
      broadcast({ 
        type: 'system', 
        message: `${client.username} left the chat.` 
      });
      
      clients.delete(ws);
      updateActiveUsers();
    }
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'system',
    message: 'Welcome to the chat! You can start typing once you join.'
  }));
});

console.log(`Enhanced WebSocket chat server running on port ${PORT}`);

// Optional: Periodic cleanup of old messages
setInterval(() => {
  const now = new Date();
  const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  // Clean up messages older than 24 hours if we're over the limit
  if (messageHistory.length > MAX_HISTORY / 2) {
    messageHistory = messageHistory.filter(msg => {
      const msgTime = new Date(msg.timestamp);
      return (now - msgTime) < ONE_DAY;
    });
  }
}, 60 * 60 * 1000); // Run every hour
