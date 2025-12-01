// Auth routes for easyweb
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const Project = require('../models/Project');
const authMiddleware = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const ChatMessage = require('../models/ChatMessage');

// Multer storage config for attachments
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Register (client or developer)
router.post('/register', authController.register);
// OTP verification
router.post('/verify-otp', authController.verifyOtp);
// Login
router.post('/login', authController.login);
// Persistent login: validate token and get user info
router.get('/me', authController.getMe);
// POST /api/projects - Create a new project (protected, with file upload)
router.post('/projects', authMiddleware, upload.array('attachments'), async (req, res) => {
  try {
    console.log('POST /api/projects called');
    console.log('Body:', req.body);
    console.log('Files:', req.files);
    const { title, description, budget, deadline } = req.body;
    if (!title || !description || !budget || !deadline) {
      console.log('Missing required fields');
      return res.status(400).json({ message: 'All fields are required.' });
    }
    const attachments = req.files ? req.files.map(f => f.filename) : [];
    const project = new Project({
      title,
      description,
      budget,
      deadline,
      client: req.user._id,
      attachments
    });
    await project.save();
    console.log('Project saved:', project);

    // Emit real-time event so developers' dashboards can pick up new open projects
    try {
      const io = req.app.get('io');
      if (io) {
        // send only to developers room (sockets authenticated as developers join this room)
        io.to('developers').emit('project:created', { project });
      }
    } catch (emitErr) {
      console.error('Socket emit error on project create:', emitErr);
    }

    res.status(201).json({ message: 'Project created successfully', project });
  } catch (err) {
    console.error('Error in /api/projects:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// GET /api/projects - List recent projects (protected, for dashboard)
router.get('/projects', authMiddleware, async (req, res) => {
  try {
    console.log('GET /api/projects called by user:', req.user && req.user.email, 'role:', req.user && req.user.role);
    // Determine filter based on role. Default to client-owned projects as a safe fallback.
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    let filter = {};
    if (role === 'developer') {
      filter = { developer: req.user._id };
    } else if (role === 'client' || role === 'user') {
      filter = { client: req.user._id };
    } else if (role === 'admin') {
      filter = {}; // admin sees all projects
    } else {
      // Fallback: show client's projects
      filter = { client: req.user._id };
    }

    const projects = await Project.find(filter)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('client', 'name email')
      .populate('developer', 'name email');
    console.log('Projects returned:', projects.length);
    res.json({ projects });
  } catch (err) {
    console.error('Error in GET /api/projects:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// GET /api/projects/open - list open projects for developers
router.get('/projects/open', authMiddleware, async (req, res) => {
  try {
    // Only developers should call this endpoint
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    if (role !== 'developer') return res.status(403).json({ message: 'Only developers can view open projects.' });

    const projects = await Project.find({ status: 'open', developer: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('client', 'name email');
    res.json({ projects });
  } catch (err) {
    console.error('Error in GET /api/projects/open:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// GET /api/projects/:id - Get a single project (populated). Allows client owner, assigned developer, or admin.
router.get('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('client', 'name email')
      .populate('developer', 'name email')
      .lean();
    if (!project) return res.status(404).json({ message: 'Project not found.' });

    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    // Only allow client owner, assigned developer, or admin
    if (role === 'client' && String(project.client._id || project.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view this project.' });
    }
    if (role === 'developer' && String(project.developer._id || project.developer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view this project.' });
    }

    res.json({ project });
  } catch (err) {
    console.error('Error in GET /projects/:id:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// PUT /api/projects/:id - Edit a project (protected)
router.put('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, budget, deadline } = req.body;
    if (!title || !description || !budget || !deadline) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    // Only allow owner to edit
    if (String(project.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to edit this project.' });
    }
    project.title = title;
    project.description = description;
    project.budget = budget;
    project.deadline = deadline;
    await project.save();
    res.json({ message: 'Project updated successfully', project });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE /api/projects/:id - Delete a project (protected)
router.delete('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    // Only allow owner to delete
    if (String(project.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to delete this project.' });
    }

    // Prevent deletion if the project has been accepted/assigned or is not open
    if (project.developer || project.acceptedAt || (project.status && String(project.status).toLowerCase() !== 'open')) {
      return res.status(400).json({ message: 'Cannot delete a project that has been accepted by a developer. Please request deletion and wait for developer approval.' });
    }

    await project.deleteOne();
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
router.get('/projects/count', authMiddleware, async (req, res) => {
  try {
    // Only count projects where client matches logged-in user
    const count = await Project.countDocuments({ client: req.user._id });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
router.put('/projects/:id/timeline', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    // Only developer assigned to the project can post timeline updates
    if (!req.user || String(req.user._id) !== String(project.developer)) {
      return res.status(403).json({ message: 'Not authorized to update timeline.' });
    }

    const { status, message } = req.body;
    if (!status && !message) return res.status(400).json({ message: 'status or message required.' });

    // More tolerant normalization: detect keywords and map to canonical statuses
    const allowedStatuses = ['open', 'in progress', 'completed', 'testing', 'qa', 'review'];
    let normalizedStatus = null;

    if (status) {
      const s = String(status).toLowerCase().trim();
      const cleaned = s.replace(/[&,+]/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      // detect keywords
      const hasTest = /\btest|testing\b/.test(cleaned);
      const hasQa = /\bqa\b/.test(cleaned) || /\bq a\b/.test(cleaned) || /\bq and a\b/.test(cleaned) || /\bq&a\b/.test(s);
      const hasInProgress = /\bin[- ]?progress\b|inprogress|in-progress/.test(cleaned);
      const hasCompleted = /\bcomplete|completed\b/.test(cleaned);
      const hasOpen = /\bopen\b/.test(cleaned);

      if (hasQa && hasTest) {
        // prefer 'qa' when both mentioned
        normalizedStatus = 'qa';
      } else if (hasQa) {
        normalizedStatus = 'qa';
      } else if (hasTest) {
        normalizedStatus = 'testing';
      } else if (hasInProgress) {
        normalizedStatus = 'in progress';
      } else if (hasCompleted) {
        normalizedStatus = 'completed';
      } else if (hasOpen) {
        normalizedStatus = 'open';
      } else {
        // last attempt: map some common exact variants
        const mapping = {
          'inprogress': 'in progress',
          'in-progress': 'in progress',
          'in progress': 'in progress',
          'testing': 'testing',
          'test': 'testing',
          'qa': 'qa',
          'review': 'review',
          'completed': 'completed',
          'open': 'open'
        };
        const key = cleaned.replace(/\s+/g, ' ').trim();
        if (mapping[key]) normalizedStatus = mapping[key];
      }

      if (!normalizedStatus) {
        return res.status(400).json({ message: 'Invalid or unsupported status. Allowed examples: open, in progress, testing, qa, review, completed.' });
      }
    }

    const entry = {
      status: normalizedStatus || project.status,
      message: message || '',
      by: req.user._id,
      byModel: req.user.role === 'developer' ? 'Developer' : 'User',
      createdAt: new Date()
    };

    project.timeline = project.timeline || [];
    project.timeline.push(entry);
    // Optionally update project status only when a validated status was provided
    if (normalizedStatus) project.status = normalizedStatus;

    await project.save();

    // Populate the timeline 'by' reference so listeners get user/developer name/email
    await project.populate('timeline.by', 'name email');

    const lastEntry = project.timeline[project.timeline.length - 1];

    // Emit real-time update via Socket.IO to the project room
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(project._id)).emit('timeline:update', { projectId: String(project._id), projectTitle: project.title, entry: lastEntry, timeline: project.timeline });
      }
    } catch (emitErr) {
      console.error('Socket emit error:', emitErr);
    }

    res.json({ message: 'Timeline updated', entry: lastEntry });
  } catch (err) {
    console.error('Error updating timeline:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/projects/:id/timeline', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate('timeline.by', 'name email');
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    // Allow client or developer or admin to read timeline
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    if (role === 'client' && String(project.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view timeline.' });
    }
    if (role === 'developer' && String(project.developer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view timeline.' });
    }
    const timeline = (project.timeline || []).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ timeline });
  } catch (err) {
    console.error('Error fetching timeline:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// New: developer accepts a project (atomic)
router.put('/projects/:id/accept', authMiddleware, async (req, res) => {
  try {
    // Only developers can accept projects
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    if (role !== 'developer') return res.status(403).json({ message: 'Only developers can accept projects.' });

    const projectId = req.params.id;
    const entry = {
      status: 'in progress',
      message: `Project accepted by developer ${req.user.email || req.user._id}`,
      by: req.user._id,
      byModel: 'Developer',
      createdAt: new Date()
    };

    // Atomic find-and-update: only succeed if project is still open and has no developer
    const updated = await Project.findOneAndUpdate(
      { _id: projectId, status: 'open', developer: { $exists: false } },
      { $set: { developer: req.user._id, status: 'in progress', acceptedAt: new Date() }, $push: { timeline: entry } },
      { new: true }
    ).populate('client', 'name email').populate('developer', 'name email');

    if (!updated) {
      return res.status(409).json({ message: 'Project has already been accepted or is not open.' });
    }

    // Re-fetch and populate timeline.by so emitted timeline entries have user info
    const populated = await Project.findById(updated._id).populate('timeline.by', 'name email').populate('client', 'name email').populate('developer', 'name email');
    const lastEntry = populated.timeline && populated.timeline.length ? populated.timeline[populated.timeline.length - 1] : entry;

    // Emit real-time events to project room so client and other listeners update
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(populated._id)).emit('project:accepted', { projectId: String(populated._id), developer: populated.developer, projectTitle: populated.title });
        io.to(String(populated._id)).emit('timeline:update', { projectId: String(populated._id), projectTitle: populated.title, entry: lastEntry, timeline: populated.timeline });
      }
    } catch (emitErr) {
      console.error('Socket emit error on accept:', emitErr);
    }

    res.json({ message: 'Project accepted', project: populated });
  } catch (err) {
    console.error('Error accepting project:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Client requests deletion for a project they own (only allowed after project accepted by developer)
router.post('/projects/:id/request-delete', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });

    // Only the client who owns the project may request deletion
    if (!req.user || String(req.user._id) !== String(project.client)) {
      return res.status(403).json({ message: 'Not authorized to request deletion.' });
    }

    // Only allow request if project has been accepted (in progress or beyond) and has a developer
    if (!project.developer || project.status === 'open') {
      return res.status(400).json({ message: 'Cannot request deletion for an unaccepted project.' });
    }

    // Create a deletion request subdocument
    project.deletionRequest = {
      requestedBy: req.user._id,
      requestedAt: new Date(),
      status: 'requested'
    };
    await project.save();

    // Notify the assigned developer via socket
    try {
      const io = req.app.get('io');
      if (io) {
        // include project snapshot and client info so frontends can render immediately
        const payload = { projectId: String(project._id), projectTitle: project.title, requestedAt: project.deletionRequest.requestedAt, clientId: String(req.user._id), clientName: req.user.name || req.user.email || null, reason: req.body.reason || '' , project };
        io.to(String(project.developer)).emit('project:deletionRequested', payload);
        // Also emit to the developers broadcast room as a fallback so at least one developer sees the request if personal room wasn't joined
        io.to('developers').emit('project:deletionRequested', payload);
      }
    } catch (emitErr) { console.error('Socket emit error:', emitErr); }

    res.json({ message: 'Deletion requested', deletionRequest: project.deletionRequest });
  } catch (err) {
    console.error('Error requesting deletion:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Developer approves the deletion request (developer only)
router.post('/projects/:id/approve-delete', authMiddleware, async (req, res) => {
  try {
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    if (role !== 'developer') return res.status(403).json({ message: 'Only developers can approve deletion requests.' });

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });

    // Only assigned developer can approve
    if (!project.developer || String(project.developer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to approve deletion for this project.' });
    }

    if (!project.deletionRequest || project.deletionRequest.status !== 'requested') {
      return res.status(400).json({ message: 'No active deletion request to approve.' });
    }

    // mark as approved and delete the project
    project.deletionRequest.status = 'approved';
    project.deletionRequest.approvedBy = req.user._id;
    project.deletionRequest.approvedByModel = 'Developer';
    project.deletionRequest.approvedAt = new Date();

    // Save record of approval before deletion (optional). Then remove project
    await project.save();

    // Emit socket event to client and developer rooms
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(project.client)).emit('project:deletionApproved', { projectId: String(project._id) });
        io.to(String(project.developer)).emit('project:deletionApproved', { projectId: String(project._id) });
        // also to developers broadcast room
        io.to('developers').emit('project:deletionApproved', { projectId: String(project._id) });
      }
    } catch (emitErr) { console.error('Socket emit error:', emitErr); }

    // finally delete the project document
    await project.deleteOne();

    res.json({ message: 'Project deleted after developer approval.' });
  } catch (err) {
    console.error('Error approving deletion:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// New: Get chat messages for a project
router.get('/chats/:projectId', authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    // verify project and authorization
    const project = await Project.findById(projectId).select('client developer');
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    const role = (req.user && req.user.role) ? String(req.user.role).toLowerCase() : 'client';
    if (role === 'client' && String(project.client) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view chats for this project.' });
    }
    if (role === 'developer' && String(project.developer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to view chats for this project.' });
    }

    const messages = await ChatMessage.find({ projectId: projectId })
      .sort({ timestamp: 1 })
      .populate('from', 'name email')
      .populate('to', 'name email')
      .lean();

    res.json({ messages });
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
