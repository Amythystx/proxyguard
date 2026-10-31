/**
 * routes/auth.js
 * Public registration and login with security audit logging and timing attack defenses.
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { logSecurityEvent } = require('../utils/audit');

const router = express.Router();

// Constant precomputed valid bcrypt hash used to equalize response timing when an email does not exist
const DUMMY_HASH = '$2b$10$wK1c5xQ7p0QY1M6eT2x.1e8w8GZq8VqjV1c1e5K/yfeqPzRjYhZ3h';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const safeRole = role === 'teacher' ? 'teacher' : 'student';

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashed,
      role: safeRole
    });

    await logSecurityEvent(req, {
      event: 'USER_REGISTERED',
      severity: 'info',
      user: user._id,
      userEmail: cleanEmail,
      role: safeRole,
      details: { name: user.name, role: safeRole }
    });

    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = await User.findOne({ email: cleanEmail });

    // Timing-consistent check: perform dummy bcrypt comparison if user not found
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      await logSecurityEvent(req, {
        event: 'LOGIN_FAILED',
        severity: 'warning',
        userEmail: cleanEmail,
        details: { reason: 'User not found' }
      });
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logSecurityEvent(req, {
        event: 'LOGIN_FAILED',
        severity: 'warning',
        user: user._id,
        userEmail: cleanEmail,
        role: user.role,
        details: { reason: 'Incorrect password' }
      });
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    await logSecurityEvent(req, {
      event: 'LOGIN_SUCCESS',
      severity: 'info',
      user: user._id,
      userEmail: cleanEmail,
      role: user.role,
      details: { role: user.role }
    });

    res.json({ token, role: user.role, name: user.name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;