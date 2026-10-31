/**
 * routes/notifications.js
 * In-app Notification Center endpoints.
 */
const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications  — fetch notifications for the current user
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    // Direct notifications or role broadcasts
    const query = {
      $or: [
        { recipient: userId },
        { recipient: null, targetRole: { $in: [role, 'all'] } }
      ]
    };

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();

    // Determine read status for each item
    const formatted = notifications.map(n => {
      const isRead = n.recipient
        ? !!n.read
        : (n.readBy && n.readBy.some(id => id.toString() === userId.toString()));
      return {
        id: n._id,
        title: n.title,
        message: n.message,
        type: n.type,
        createdAt: n.createdAt,
        link: n.link || '',
        read: isRead
      };
    });

    const unreadCount = formatted.filter(n => !n.read).length;

    res.json({
      notifications: formatted,
      unreadCount
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PATCH /api/notifications/:id/read  — mark single notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }

    const notif = await Notification.findById(id);
    if (!notif) return res.status(404).json({ message: 'Notification not found' });

    if (notif.recipient) {
      if (notif.recipient.toString() !== req.user.id.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
      notif.read = true;
    } else {
      // Broadcast: add user ID to readBy array if not already present
      if (!notif.readBy.some(u => u.toString() === req.user.id.toString())) {
        notif.readBy.push(req.user.id);
      }
    }

    await notif.save();
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/notifications/mark-all-read  — mark all as read for this user
router.post('/mark-all-read', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    // 1. Mark direct notifications
    await Notification.updateMany(
      { recipient: userId, read: false },
      { $set: { read: true } }
    );

    // 2. Mark broadcasts
    await Notification.updateMany(
      { recipient: null, targetRole: { $in: [role, 'all'] }, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/notifications/broadcast  — teacher or admin broadcast
router.post('/broadcast', auth, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { title, message, targetRole = 'student', type = 'info', link = '' } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    // Role safety: teachers can only broadcast to students
    const safeTarget = (req.user.role === 'teacher' && targetRole !== 'student') ? 'student' : targetRole;

    const notif = await Notification.create({
      recipient: null,
      targetRole: safeTarget,
      title: title.trim(),
      message: message.trim(),
      type: ['warning', 'info', 'success', 'security'].includes(type) ? type : 'info',
      link: link ? link.trim() : ''
    });

    res.status(201).json({ message: 'Notification broadcasted successfully', notificationId: notif._id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
