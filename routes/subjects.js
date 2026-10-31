const express = require('express');
const Subject = require('../models/Subject');
const { auth, requireRole } = require('../middleware/auth');
const Session = require('../models/Session');

const router = express.Router();

// Create a subject (teacher only)
router.post('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const subject = await Subject.create({ name: req.body.name, teacher: req.user.id });
    res.status(201).json(subject);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// List my subjects (teacher only)
router.get('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const subjects = await Subject.find({ teacher: req.user.id }).lean();
    const result = await Promise.all(subjects.map(async (s) => {
      const last = await Session.findOne({ subject: s._id }).sort({ startedAt: -1 });
      return { ...s, lastSession: last ? last.startedAt : null, active: last ? last.active : false };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;