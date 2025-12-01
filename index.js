require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const geminiRoutes = require('./routes/gemini');
const Project = require('./models/Project');
const User = require('./models/User');
const Developer = require('./models/Developer');

const app = express();
// Enable CORS for Vite dev servers on different hostnames/IPs during development.
// This echoes/permits the request origin for common dev origins (localhost, 127.0.0.1, LAN IPs on port 5173).
const corsOptions = {
  origin: (origin, callback) => {
    // allow non-browser (server-to-server) requests with no origin
    if (!origin) return callback(null, true);
    // quickly allow typical dev hosts
    const allowed = [ 'http://localhost:5173', 'http://127.0.0.1:5173' ];
    if (allowed.includes(origin)) return callback(null, true);
    // allow any origin that is served from port 5173 (Vite dev server)
    try {
      const u = new URL(origin);
      if (u.port === '5173') return callback(null, true);
    } catch (e) {
      // ignore
    }
    // fallback: allow (development only). In production you should restrict origins.
    return callback(null, true);
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

const PORT = process.env.PORT || 5050;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/easyweb';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // echo/allow the requesting origin for socket polling/ws handshakes.
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST"],
    credentials: true
  }
});

// make io available to routes
app.set('io', io);

const ChatMessage = require('./models/ChatMessage');

io.on('connection', (socket) => {
  // Verify JWT from client handshake (use auth.token)
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: decoded.id, role: decoded.role };
      console.log('Socket authenticated user:', socket.user);
      // Join a personal room so server can address this specific user by their user id
      try { socket.join(String(decoded.id)); } catch (e) { /* ignore */ }
      // Keep a developers broadcast room for any developer-wide announcements
      if (String(decoded.role).toLowerCase() === 'developer') {
        socket.join('developers');
        console.log(`Socket ${socket.id} joined 'developers' room and personal room ${decoded.id}`);
      } else {
        console.log(`Socket ${socket.id} joined personal room ${decoded.id}`);
      }
    } catch (e) {
      console.warn('Socket JWT verification failed:', e.message);
      // Do not disconnect immediately: keep socket but unauthenticated
    }
  }

  console.log('Socket connected, id:', socket.id, 'user:', socket.user);

  // Handler to join a project room after verifying ownership/assignment
  socket.on('join-room', async (payload) => {
    const projectId = (payload && payload.projectId) || socket.handshake.query.projectId;
    if (!projectId) {
      socket.emit('error', 'projectId required to join room');
      return;
    }
    try {
      const project = await Project.findById(projectId).select('client developer');
      if (!project) {
        socket.emit('error', 'Project not found');
        return;
      }
      const clientId = project.client?.toString();
      const devId = project.developer?.toString();
      // allow join if the authenticated socket user matches client or developer
      if (socket.user && (String(socket.user.id) === clientId || String(socket.user.id) === devId)) {
        socket.join(projectId);
        socket.emit('joined', { projectId });
        console.log(`Socket ${socket.id} joined project room ${projectId}`);

        // announce presence to the project room
        try {
          const uid = socket.user && socket.user.id;
          const role = socket.user && socket.user.role;
          if (uid) {
            io.to(String(projectId)).emit('presence:update', { userId: String(uid), online: true, role });
          }
        } catch (e) { console.error('presence emit error', e); }

      } else {
        socket.emit('error', 'Not authorized to join this project room');
      }
    } catch (err) {
      console.error('join-room error', err);
      socket.emit('error', 'Server error while joining room');
    }
  });

  socket.on('leave-room', (payload) => {
    const projectId = payload && payload.projectId;
    if (projectId) {
      socket.leave(projectId);
      console.log(`Socket ${socket.id} left project room ${projectId}`);
      try {
        const uid = socket.user && socket.user.id;
        const role = socket.user && socket.user.role;
        if (uid) io.to(String(projectId)).emit('presence:update', { userId: String(uid), online: false, role });
      } catch (e) { console.error('presence leave emit error', e); }
    }
  });

  // Helper to resolve the project room the socket is in (excluding its own private room)
  const getProjectRoom = () => {
    const rooms = Array.from(socket.rooms || []);
    // first entry is the socket's own room id, the rest may include project rooms
    return rooms.length > 1 ? rooms.slice(1)[0] : null;
  };

  // Persist and broadcast chat messages
  // support acknowledgement callback: socket.emit('chat-message', msg, (ack) => { ... })
  socket.on('chat-message', async (msg, callback) => {
    try {
      // determine project room: prefer explicit projectId, otherwise look at joined rooms
      const projectRoomRaw = msg && (msg.projectId || msg.project) || getProjectRoom();
      const projectRoom = projectRoomRaw ? String(projectRoomRaw) : null;

      // If we don't have a projectId anywhere, abort early
      if (!projectRoom) {
        const rooms = Array.from(socket.rooms || []);
        rooms.slice(1).forEach(room => {
          io.to(room).emit('chat-message', { ...msg, status: 'sent' });
        });
        if (typeof callback === 'function') callback({ ok: false, error: 'no project room' });
        return;
      }

      // Validate project id format early
      if (!mongoose.Types.ObjectId.isValid(projectRoom)) {
        console.warn('Rejecting chat-message: invalid projectId', { socketId: socket.id, projectRoom });
        try { socket.emit('chat-error', { message: 'Invalid projectId' }); } catch (e) {}
        if (typeof callback === 'function') callback({ ok: false, error: 'Invalid projectId' });
        return;
      }

      // Ensure the requester is authorized to post to this project -- allows saving even if the socket hasn't joined the room yet
      let project;
      try {
        project = await Project.findById(projectRoom).select('client developer');
        if (!project) {
          if (typeof callback === 'function') callback({ ok: false, error: 'Project not found' });
          try { socket.emit('chat-error', { message: 'Project not found' }); } catch (e) {}
          return;
        }
      } catch (e) {
        console.error('Error loading project for chat-message authorization', e && e.message ? e.message : e);
        if (typeof callback === 'function') callback({ ok: false, error: 'Server error' });
        return;
      }

      // Determine sender id: use authenticated socket user when available (authoritative)
      let fromId = null;
      if (socket.user && socket.user.id) {
        fromId = String(socket.user.id);
      } else if (msg && msg.from) {
        fromId = String(msg.from);
      }

      if (!fromId) {
        try { socket.emit('chat-error', { message: 'Sender id (from) is required' }); } catch (e) {}
        if (typeof callback === 'function') callback({ ok: false, error: 'missing sender id' });
        return;
      }

      const clientId = project.client ? String(project.client) : null;
      const devId = project.developer ? String(project.developer) : null;
      const requesterRole = socket.user && socket.user.role ? String(socket.user.role).toLowerCase() : '';
      const requesterId = fromId;
      const isAuthorized = requesterId && (requesterId === clientId || requesterId === devId || requesterRole === 'admin');
      if (!isAuthorized) {
        try { socket.emit('chat-error', { message: 'Not authorized to post to this project' }); } catch (e) {}
        if (typeof callback === 'function') callback({ ok: false, error: 'not authorized' });
        return;
      }

      // Normalize models and timestamp. Prefer server-known role when available.
      const fromModel = socket.user && socket.user.role ? (String(socket.user.role).toLowerCase() === 'developer' ? 'Developer' : 'User') : (msg && msg.fromModel ? msg.fromModel : 'User');
      const to = msg && msg.to ? msg.to : null;
      const toModel = msg && msg.toModel ? msg.toModel : 'User';
      const text = msg && typeof msg.text === 'string' ? msg.text : '';
      const files = Array.isArray(msg && msg.files) ? msg.files : [];
      const type = msg && msg.type ? msg.type : 'user';
      const timestamp = msg && msg.timestamp ? new Date(msg.timestamp) : new Date();

      // Save message to DB
      const chatDoc = new ChatMessage({
        projectId: projectRoom,
        from: fromId,
        fromModel,
        to,
        toModel,
        text,
        files,
        type,
        timestamp
      });

      await chatDoc.save();
      const populated = await ChatMessage.findById(chatDoc._id).populate('from', 'name email').populate('to', 'name email');

      const payload = populated.toObject ? populated.toObject() : populated;
      
      // Broadcast ONLY to the project room to avoid duplicates
      // All clients in the project room will receive the message
      // If they're not in the room yet, they'll get history via GET /api/chats/:projectId
      io.to(String(projectRoom)).emit('chat-message', payload);
      
      console.log('Chat saved and emitted for project', projectRoom, 'messageId', payload._id);

      // acknowledge to sender with saved message
      if (typeof callback === 'function') callback({ ok: true, message: payload });
    } catch (err) {
      // Log concise error info to avoid flooding the console with Mongoose internals
      console.error('Error handling chat-message:', err && err.message ? err.message : err);
      try { socket.emit('chat-error', { message: 'Server error sending message' }); } catch (e) {}
      if (typeof callback === 'function') callback({ ok: false, error: (err && err.message) || 'server error' });
    }
  });

  // Typing indicators - forward to project room
  socket.on('typing', (payload) => {
    const projectRoom = payload?.projectId || getProjectRoom();
    if (projectRoom) io.to(String(projectRoom)).emit('typing', payload || {});
  });
  socket.on('stop-typing', (payload) => {
    const projectRoom = payload?.projectId || getProjectRoom();
    if (projectRoom) io.to(String(projectRoom)).emit('stop-typing', payload || {});
  });

  // Message deletion for everyone
  socket.on('delete-message', async ({ messageId }) => {
    try {
      if (!messageId) return;
      const msg = await ChatMessage.findById(messageId);
      if (!msg) return;
      // Only allow delete if requester is the sender or a developer assigned to project
      const requesterId = socket.user && socket.user.id;
      if (!requesterId) return;
      if (String(msg.from) !== String(requesterId) && String(socket.user.role).toLowerCase() !== 'developer') {
        // not authorized to delete for everyone
        return;
      }
      const projectRoom = String(msg.projectId);
      await ChatMessage.findByIdAndDelete(messageId);
      io.to(projectRoom).emit('delete-message', { messageId });
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  // Delete message for me only
  socket.on('delete-message-for-me', async ({ messageId, userId }) => {
    try {
      if (!messageId || !userId) return;
      await ChatMessage.findByIdAndUpdate(messageId, { $addToSet: { deletedFor: userId } });
      const msg = await ChatMessage.findById(messageId);
      const projectRoom = msg ? String(msg.projectId) : getProjectRoom();
      if (projectRoom) io.to(projectRoom).emit('delete-message-for-me', { messageId, userId });
    } catch (err) {
      console.error('Error in delete-message-for-me:', err);
    }
  });

  // WebRTC signaling pass-through (video calls)
  // Support both legacy 'video-*' and new 'webrtc-*' event names; forward to project room
  socket.on('video-offer', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('video-offer', payload);
    } catch (err) { console.error('video-offer error', err); }
  });
  socket.on('video-answer', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('video-answer', payload);
    } catch (err) { console.error('video-answer error', err); }
  });
  socket.on('ice-candidate', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('ice-candidate', payload);
    } catch (err) { console.error('ice-candidate error', err); }
  });

  // New event names used by client: webrtc-offer / webrtc-answer / webrtc-ice-candidate / webrtc-hangup
  socket.on('webrtc-offer', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('webrtc-offer', payload);
    } catch (err) { console.error('webrtc-offer error', err); }
  });
  socket.on('webrtc-answer', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('webrtc-answer', payload);
    } catch (err) { console.error('webrtc-answer error', err); }
  });
  socket.on('webrtc-ice-candidate', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('webrtc-ice-candidate', payload);
    } catch (err) { console.error('webrtc-ice-candidate error', err); }
  });
  socket.on('webrtc-hangup', (payload) => {
    try {
      const projectRoom = payload?.projectId || getProjectRoom();
      if (projectRoom) io.to(String(projectRoom)).emit('webrtc-hangup', payload || {});
    } catch (err) { console.error('webrtc-hangup error', err); }
  });

  socket.on('read-message', (msgId) => {
    const rooms = Array.from(socket.rooms || []);
    rooms.slice(1).forEach(room => {
      io.to(room).emit('message-status', { id: msgId, status: 'read' });
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
    try {
      const rooms = Array.from(socket.rooms || []);
      // skip the socket's own room id at index 0
      rooms.slice(1).forEach(room => {
        const uid = socket.user && socket.user.id;
        const role = socket.user && socket.user.role;
        if (uid) io.to(String(room)).emit('presence:update', { userId: String(uid), online: false, role });
      });
    } catch (e) { console.error('presence disconnect emit error', e); }
  });
});

app.get('/', (req, res) => {
  res.send('easyweb backend running');
});

// Use auth routes
app.use('/api', authRoutes);
app.use('/api/gemini', geminiRoutes);
// Chat routes (chat history)
app.use('/api/chats', require('./routes/chats'));

// Feedbacks API
const feedbacksRoute = require('./routes/feedbacks');
app.use('/api/feedbacks', feedbacksRoute);

// Serve static files from the React app (production build)
app.use(express.static(path.join(__dirname, '../client/dist')));

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback: serve index.html for any unknown route (for React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Start both Express and Socket.IO server on the same port
server.listen(PORT, () => {
  console.log(`Server and Socket.IO running on port ${PORT}`);
});
