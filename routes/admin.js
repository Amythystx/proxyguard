/**
 * routes/admin.js
 * Admin-only endpoints:
 *   GET  /api/admin/stats          - platform statistics
 *   GET  /api/admin/users          - list all users (passwords excluded)
 *   DELETE /api/admin/users/:id    - delete a teacher/student (not admins)
 *   GET  /api/admin/audit-logs     - security audit trail
 *   GET  /api/admin/at-risk        - institution-wide low attendance tracking (< 75%)
 */
const express    = require('express');
const mongoose   = require('mongoose');
const User       = require('../models/User');
const Subject    = require('../models/Subject');
const Session    = require('../models/Session');
const Attendance = require('../models/Attendance');
const AuditLog   = require('../models/AuditLog');
const { auth, requireRole } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/audit');

const router = express.Router();

// GET /api/admin/stats
router.get('/stats', auth, requireRole('admin'), async (req, res) => {
  try {
    const [students, teachers, subjects, sessions, attendance, securityAlerts] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'teacher' }),
      Subject.countDocuments(),
      Session.countDocuments(),
      Attendance.countDocuments(),
      AuditLog.countDocuments({ severity: { $in: ['warning', 'critical'] } })
    ]);
    res.json({ students, teachers, subjects, sessions, attendance, securityAlerts });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/users  — never sends password field
router.get('/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (err) {
    console.error('Admin users error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete admin accounts' });
    }

    if (user.role === 'teacher') {
      const subjects = await Subject.find({ teacher: id }).select('_id').lean();
      const subjectIds = subjects.map(s => s._id);

      const sessions = await Session.find({ subject: { $in: subjectIds } }).select('_id').lean();
      const sessionIds = sessions.map(s => s._id);

      await Attendance.deleteMany({ session: { $in: sessionIds } });
      await Session.deleteMany({ _id: { $in: sessionIds } });
      await Subject.deleteMany({ teacher: id });
    }

    if (user.role === 'student') {
      await Attendance.deleteMany({ student: id });
    }

    await User.findByIdAndDelete(id);

    await logSecurityEvent(req, {
      event: 'USER_DELETED',
      severity: 'info',
      details: { deletedUserId: id, deletedUserName: user.name, deletedUserEmail: user.email, deletedUserRole: user.role }
    });

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Admin delete user error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/audit-logs  — security audit log trail
router.get('/audit-logs', auth, requireRole('admin'), async (req, res) => {
  try {
    const { severity, event, search, limit = 50, page = 1 } = req.query;
    const query = {};

    if (severity && severity !== 'all') {
      query.severity = severity;
    }
    if (event && event !== 'all') {
      query.event = event;
    }
    if (search && typeof search === 'string') {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (escaped) {
        query.$or = [
          { userEmail: { $regex: escaped, $options: 'i' } },
          { ip: { $regex: escaped, $options: 'i' } },
          { 'details.message': { $regex: escaped, $options: 'i' } }
        ];
      }
    }

    const rawPage   = parseInt(page, 10);
    const rawLimit  = parseInt(limit, 10);
    const safePage  = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const safeLimit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 50;

    const skip = (safePage - 1) * safeLimit;
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate('user', 'name email role')
        .lean(),
      AuditLog.countDocuments(query)
    ]);

    res.json({
      logs: logs.map(l => ({
        id: l._id,
        event: l.event,
        severity: l.severity,
        userEmail: l.userEmail || (l.user ? l.user.email : 'Anonymous/Guest'),
        userName: l.user ? l.user.name : 'Unknown',
        role: l.role || (l.user ? l.user.role : 'none'),
        ip: l.ip,
        details: l.details || {},
        createdAt: l.createdAt
      })),
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit) || 1
    });
  } catch (err) {
    console.error('Admin audit logs error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/at-risk  — institution-wide list of students below 75%
router.get('/at-risk', auth, requireRole('admin'), async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('name email').lean();
    const sessions = await Session.find().select('subject').populate('subject', 'name').lean();
    const attendances = await Attendance.find().select('student session').lean();

    // Map: studentId -> attended session id set
    const studentAttendanceMap = {};
    attendances.forEach(a => {
      const sId = a.student.toString();
      if (!studentAttendanceMap[sId]) studentAttendanceMap[sId] = new Set();
      studentAttendanceMap[sId].add(a.session.toString());
    });

    // Subject total sessions map
    const subjectSessionMap = {};
    sessions.forEach(sess => {
      if (!sess.subject) return;
      const subId = sess.subject._id.toString();
      if (!subjectSessionMap[subId]) subjectSessionMap[subId] = { name: sess.subject.name, sessions: [] };
      subjectSessionMap[subId].sessions.push(sess._id.toString());
    });

    const atRiskList = [];

    students.forEach(student => {
      const sId = student._id.toString();
      const attendedSet = studentAttendanceMap[sId] || new Set();

      Object.entries(subjectSessionMap).forEach(([subId, subInfo]) => {
        const total = subInfo.sessions.length;
        if (total === 0) return;

        let attended = 0;
        subInfo.sessions.forEach(sessId => {
          if (attendedSet.has(sessId)) attended++;
        });

        const pct = Math.round((attended / total) * 100);
        if (pct < 75) {
          const classesNeeded = Math.max(1, Math.ceil((0.75 * total - attended) / 0.25));
          atRiskList.push({
            studentId: sId,
            studentName: student.name,
            studentEmail: student.email,
            subjectId: subId,
            subjectName: subInfo.name,
            total,
            attended,
            percentage: pct,
            classesNeeded,
            isCritical: pct < 60
          });
        }
      });
    });

    // Sort by lowest percentage first
    atRiskList.sort((a, b) => a.percentage - b.percentage);

    res.json({
      atRiskCount: atRiskList.length,
      students: atRiskList
    });
  } catch (err) {
    console.error('Admin at-risk calculation error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
