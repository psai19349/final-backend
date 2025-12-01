const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Feedback = require('../models/Feedback');
const jwt = require('jsonwebtoken');

// simple disk storage under server/uploads/feedbacks
const uploadsDir = path.join(__dirname, '..', 'uploads', 'feedbacks');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// helper to get user id from Authorization header (bearer)
function getUserIdFromReq(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth) return null;
  const parts = String(auth).split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded && decoded.id ? String(decoded.id) : null;
  } catch (e) { return null; }
}

// POST /api/feedbacks - submit feedback with optional screenshots
router.post('/', upload.array('screenshots', 5), async (req, res) => {
  try {
    const { description, projectLink, rating } = req.body;
    const screenshots = (req.files || []).map(f => `/uploads/feedbacks/${path.basename(f.path)}`);
    const createdBy = getUserIdFromReq(req);

    const fb = new Feedback({ description, projectLink, rating: Number(rating || 0), screenshots, createdBy });
    await fb.save();
    res.json({ ok: true, feedback: fb });
  } catch (e) {
    console.error('Feedback save error', e);
    res.status(500).json({ ok: false, message: 'Server error saving feedback' });
  }
});

// GET /api/feedbacks - list recent feedbacks
router.get('/', async (req, res) => {
  try {
    const list = await Feedback.find({}).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, feedbacks: list });
  } catch (e) {
    console.error('Feedback list error', e);
    res.status(500).json({ ok: false, message: 'Server error fetching feedbacks' });
  }
});

module.exports = router;
