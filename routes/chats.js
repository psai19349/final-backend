const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const Project = require('../models/Project');
const authMiddleware = require('../middlewares/authMiddleware');

// GET /api/chats/:projectId - fetch chat history for a project
router.get('/:projectId', authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  try {
    // validate projectId format early to avoid Mongoose CastError
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: 'Invalid projectId' });
    }

    const project = await Project.findById(projectId).select('client developer');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const requesterId = req.user && req.user._id ? String(req.user._id) : null;
    const requesterRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
    const isAuthorized = requesterId && (String(project.client) === requesterId || String(project.developer) === requesterId || requesterRole === 'admin');
    if (!isAuthorized) return res.status(403).json({ message: 'Not authorized to view chats for this project' });

    let messages = await ChatMessage.find({ projectId }).sort({ timestamp: 1 }).populate('from', 'name email').populate('to', 'name email');

    // remove messages deleted for this requester
    if (requesterId) {
      messages = messages.filter(m => {
        if (!m.deletedFor || !Array.isArray(m.deletedFor) || m.deletedFor.length === 0) return true;
        return !m.deletedFor.some(did => String(did) === requesterId);
      });
    }

    return res.json({ messages });
  } catch (err) {
    console.error('Error fetching chats for projectId', projectId, err && err.stack ? err.stack : err);
    // In development return the error message to the client to aid debugging. In production, hide details.
    const payload = { message: 'Server error' };
    if (process.env.NODE_ENV !== 'production') payload.error = (err && err.message) || String(err);
    return res.status(500).json(payload);
  }
});

// POST /api/chats/:projectId - save a chat message for a specific project
router.post('/:projectId', authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const { text, to, type, files } = req.body;
  try {
    // validate projectId format early
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: 'Invalid projectId' });
    }

    // Basic validation
    if (!text && (!files || files.length === 0)) {
      return res.status(400).json({ message: 'Text or files are required' });
    }

    // Verify project exists and user is authorized
    const project = await Project.findById(projectId).select('client developer');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Get user ID from authenticated session (more secure than trusting client)
    const requesterId = req.user && req.user._id ? String(req.user._id) : null;
    const requesterRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
    
    if (!requesterId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    // Verify user is part of the project
    const isAuthorized = (String(project.client) === requesterId || String(project.developer) === requesterId || requesterRole === 'admin');
    if (!isAuthorized) return res.status(403).json({ message: 'Not authorized to post to this project' });

    // Determine the role
    const fromModel = requesterRole === 'developer' ? 'Developer' : 'User';

    // Create and save the chat message
    const message = new ChatMessage({
      projectId,
      from: requesterId,
      fromModel,
      to: to || null,
      toModel: to ? (requesterRole === 'developer' ? 'User' : 'Developer') : null,
      text: text || '',
      files: files || [],
      type: type || 'user',
      timestamp: new Date()
    });
    
    const saved = await message.save();
    // Fetch the saved message with populated references
    const populated = await ChatMessage.findById(saved._id).populate('from', 'name email').populate('to', 'name email');

    const payload = populated.toObject ? populated.toObject() : populated;

    // Emit via Socket.IO if available - only to the project room to avoid duplicates
    try {
      const io = req.app && req.app.get && req.app.get('io');
      if (io) {
        io.to(String(projectId)).emit('chat-message', payload);
        console.log('REST chat saved and emitted for project', projectId, 'messageId', payload._id);
      }
    } catch (e) { console.error('Failed to emit chat via Socket.IO', e && e.message ? e.message : e); }

    return res.status(201).json({ ok: true, message: payload });
  } catch (err) {
    console.error('Error saving chat message', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
