// Authentication controller for easyweb
const User = require('../models/User');
const Developer = require('../models/Developer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail } = require('../middlewares/Email.js');
const dotenv = require('dotenv');
dotenv.config();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const escapeRegExp = (string) => {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

exports.register = async (req, res) => {
  try {
    let { name, email, password, role, country } = req.body;
    // Normalize email to avoid case-sensitivity issues
    email = (email || '').toLowerCase().trim();
    // Accept country from either req.body.country or req.body['country'] (handle possible undefined or empty string)
    if (!country && typeof req.body['country'] === 'string') {
      country = req.body['country'];
    }
    if (!name || !email || !password || !role || !country) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (role === 'developer') {
      const existing = await Developer.findOne({ email: new RegExp('^' + escapeRegExp(email) + '$', 'i') });
      if (existing) return res.status(409).json({ message: 'Email already registered' });
      const hash = await bcrypt.hash(password, 10);
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
      const developer = new Developer({
        name,
        email,
        password: hash,
        role,
        country,
        otp,
        otpExpires,
      });
      await developer.save();
      await sendVerificationEmail(email, otp);
      return res.status(201).json({ message: 'Registration successful, verification code sent to email.' });
    } else {
      const existing = await User.findOne({ email: new RegExp('^' + escapeRegExp(email) + '$', 'i') });
      if (existing) return res.status(409).json({ message: 'Email already registered' });
      const hash = await bcrypt.hash(password, 10);
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
      const user = new User({
        name,
        email,
        password: hash,
        role,
        country,
        otp,
        otpExpires,
      });
      await user.save();
      await sendVerificationEmail(email, otp);
      return res.status(201).json({ message: 'Registration successful, verification code sent to email.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    let { email, otp, role, country } = req.body;
    // Normalize email
    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail || !otp || !role) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    let user;
    if (role === 'developer') {
      user = await Developer.findOne({ email: new RegExp('^' + escapeRegExp(normalizedEmail) + '$', 'i') });
    } else {
      user = await User.findOne({ email: new RegExp('^' + escapeRegExp(normalizedEmail) + '$', 'i') });
    }
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.otp || !user.otpExpires || user.otpExpires < new Date()) {
      return res.status(400).json({ message: 'OTP expired. Please register again.' });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    // Save country if not already set (for legacy users or missing client country)
    if (country && !user.country) {
      user.country = country;
    }
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    // Generate JWT token after OTP verification
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '7d' });
    res.json({ message: 'Email verified successfully', token, user: { id: user._id, name: user.name, email: user.email, role: user.role, country: user.country } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    // Normalize incoming email to avoid case-sensitivity issues and trim whitespace
    email = (email || '').toLowerCase().trim();
    if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

    // Debug log for failed login investigations (no password logging)
    console.log('Login attempt for:', email);

    // Admin login logic (compare using normalized admin email)
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    if (
      adminEmail &&
      process.env.ADMIN_PASSWORD &&
      email === adminEmail &&
      password === process.env.ADMIN_PASSWORD
    ) {
      // Return a special admin token and role
      const token = jwt.sign({ id: 'admin', role: 'admin' }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '7d' });
      return res.json({ token, user: { id: 'admin', name: 'Admin', email, role: 'admin' } });
    }

    // Try developer first, then user (case-insensitive)
    let user = await Developer.findOne({ email: new RegExp('^' + escapeRegExp(email) + '$', 'i') });
    let userRole = 'developer';
    if (!user) {
      user = await User.findOne({ email: new RegExp('^' + escapeRegExp(email) + '$', 'i') });
      userRole = 'client';
    }

    // Log whether user was found and which collection
    if (!user) {
      console.log('Login failed: no user found for', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    } else {
      console.log('User found for login:', email, 'roleDetected:', userRole, 'userId:', user._id.toString());
    }``

    // Ensure password hash exists before comparing
    if (!user.password) {
      console.error('User record missing password hash for', email, 'userId:', user._id.toString());
      return res.status(500).json({ message: 'User account misconfigured' });
    }

    const match = await bcrypt.compare(password, user.password);
    console.log('Password compare result for', email, ':', match);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user._id, role: userRole }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: userRole } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
    } catch (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    if (payload.role === 'admin') {
      return res.json({
        user: { id: 'admin', name: 'Admin', email: process.env.ADMIN_EMAIL, role: 'admin' },
        role: 'admin'
      });
    }
    let user = null;
    if (payload.role === 'developer') {
      user = await Developer.findById(payload.id);
    } else if (payload.role === 'client') {
      user = await User.findById(payload.id);
    }
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Include country in the response
    res.json({
      user: { id: user._id, name: user.name, email: user.email, role: payload.role, country: user.country },
      role: payload.role
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
