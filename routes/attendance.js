/**
 * routes/attendance.js
 * Attendance marking, anti-proxy pipeline, calendar/heatmap, and low-attendance alerts.
 */
const express    = require('express');
const mongoose   = require('mongoose');
const Session    = require('../models/Session');
const Attendance = require('../models/Attendance');
const Subject    = require('../models/Subject');
const Notification = require('../models/Notification');
const { auth, requireRole } = require('../middleware/auth');
const { verify, TOKEN_VALIDITY_MS } = require('../utils/token');
const { isValidLocation, distanceMeters } = require('../utils/geo');
const { logSecurityEvent } = require('../utils/audit');

const router = express.Router();

// POST /api/attendance/mark
// Full anti-proxy security pipeline with comprehensive audit logging
router.post('/mark', auth, requireRole('student'), async (req, res) => {
  try {
    const { s, t, sig, lat, lng } = req.body;

    // 1. Validate that 's' is a valid MongoDB ObjectId
    if (!mongoose.isValidObjectId(s)) {
      await logSecurityEvent(req, {
        event: 'SCAN_TAMPER_SIG',
        severity: 'critical',
        details: { message: 'Invalid session ObjectId in QR scan payload', s }
      });
      return res.status(400).json({ message: 'Invalid QR code' });
    }

    // 2. Session must exist AND be currently active
    const session = await Session.findOne({ _id: s, active: true }).populate('subject', 'name');
    if (!session) {
      return res.status(404).json({ message: 'Session not active' });
    }

    // 3. Verify HMAC-SHA256 signature
    if (!verify(s, t, sig, session.secret)) {
      await logSecurityEvent(req, {
        event: 'SCAN_TAMPER_SIG',
        severity: 'critical',
        details: {
          message: 'HMAC signature mismatch: potential forged or transferred QR code',
          sessionId: s,
          subject: session.subject ? session.subject.name : 'Unknown'
        }
      });
      return res.status(400).json({ message: 'Invalid QR code' });
    }

    // 4. Check token age (valid for 30s)
    const age = Date.now() - Number(t);
    if (!(age >= 0 && age <= TOKEN_VALIDITY_MS)) {
      await logSecurityEvent(req, {
        event: 'SCAN_EXPIRED_QR',
        severity: 'warning',
        details: {
          message: `Attempted scan of expired QR code (age: ${Math.round(age / 1000)}s)`,
          ageSeconds: Math.round(age / 1000),
          sessionId: s
        }
      });
      return res.status(400).json({ message: 'QR code expired, scan the latest one' });
    }

    // 5. Geo-fence check
    const loc = session.location;
    if (loc && isValidLocation(loc.lat, loc.lng)) {
      if (!isValidLocation(lat, lng)) {
        return res.status(400).json({ message: 'Location required. Allow location access and scan again' });
      }
      const dist = distanceMeters(loc.lat, loc.lng, lat, lng);
      if (dist > session.radius) {
        await logSecurityEvent(req, {
          event: 'SCAN_GEO_FAIL',
          severity: 'critical',
          details: {
            message: `Student attempted scan from outside allowed geo-fence (${Math.round(dist)}m away, radius: ${session.radius}m)`,
            distanceMeters: Math.round(dist),
            allowedRadius: session.radius,
            sessionId: s,
            subject: session.subject ? session.subject.name : 'Unknown'
          }
        });
        return res.status(400).json({
          message: 'You are too far from the classroom (' + Math.round(dist) + ' m away)'
        });
      }
    }

    // 6. Check if already marked for this session
    const existing = await Attendance.findOne({ session: session._id, student: req.user.id });
    if (existing) {
      await logSecurityEvent(req, {
        event: 'SCAN_DUPLICATE',
        severity: 'warning',
        details: {
          message: 'Duplicate scan attempt detected for the same session',
          sessionId: s,
          subject: session.subject ? session.subject.name : 'Unknown'
        }
      });
      return res.status(400).json({ message: 'Attendance already marked' });
    }

    // 7. Create attendance record
    const record = await Attendance.create({ session: session._id, student: req.user.id });

    // 8. Log success audit event
    await logSecurityEvent(req, {
      event: 'SCAN_SUCCESS',
      severity: 'info',
      details: {
        sessionId: session._id,
        subject: session.subject ? session.subject.name : 'Unknown'
      }
    });

    // 9. Create a confirmation notification for the student
    const subjectName = session.subject ? session.subject.name : 'Class';
    await Notification.create({
      recipient: req.user.id,
      title: 'Attendance Confirmed',
      message: `Your attendance for ${subjectName} was successfully recorded.`,
      type: 'success',
      link: 'student.html'
    }).catch(() => {});

    res.status(201).json({ message: 'Attendance marked', markedAt: record.markedAt });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Attendance already marked' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/attendance/my  — student's own attendance history
router.get('/my', auth, requireRole('student'), async (req, res) => {
  try {
    const records = await Attendance.find({ student: req.user.id })
      .populate({ path: 'session', populate: { path: 'subject', select: 'name' } })
      .sort({ markedAt: -1 });

    res.json(
      records
        .filter(r => r.session && r.session.subject)
        .map(r => ({ subject: r.session.subject.name, markedAt: r.markedAt }))
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/attendance/summary  — percentage per subject for the logged-in student
router.get('/summary', auth, requireRole('student'), async (req, res) => {
  try {
    const sessions = await Session.find().select('subject').lean();
    const mine = await Attendance.find({ student: req.user.id }).select('session').lean();
    const attendedSet = new Set(mine.map(a => a.session.toString()));

    const stats = {};
    sessions.forEach(s => {
      if (!s.subject) return;
      const key = s.subject.toString();
      if (!stats[key]) stats[key] = { total: 0, attended: 0 };
      stats[key].total++;
      if (attendedSet.has(s._id.toString())) stats[key].attended++;
    });

    const subjects = await Subject.find({ _id: { $in: Object.keys(stats) } }).lean();
    res.json(subjects.map(sub => {
      const st = stats[sub._id.toString()];
      const pct = st.total > 0 ? Math.round((st.attended / st.total) * 100) : 0;
      return {
        id:         sub._id,
        subject:    sub.name,
        code:       sub.code || '',
        total:      st.total,
        attended:   st.attended,
        percentage: pct,
        isLow:      pct < 75
      };
    }));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/attendance/calendar  — calendar and heatmap data
// Returns day-by-day attendance log for the last 90 days and full current month
router.get('/calendar', auth, requireRole('student'), async (req, res) => {
  try {
    const records = await Attendance.find({ student: req.user.id })
      .populate({ path: 'session', populate: { path: 'subject', select: 'name' } })
      .sort({ markedAt: 1 })
      .lean();

    // Map by YYYY-MM-DD
    const heatmapMap = {};
    records.forEach(r => {
      if (!r.markedAt) return;
      const d = new Date(r.markedAt);
      const dateKey = d.toISOString().split('T')[0];
      if (!heatmapMap[dateKey]) {
        heatmapMap[dateKey] = {
          date: dateKey,
          count: 0,
          sessions: []
        };
      }
      heatmapMap[dateKey].count++;
      heatmapMap[dateKey].sessions.push({
        subject: (r.session && r.session.subject) ? r.session.subject.name : 'Class',
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    // Intensity level: 0 = none, 1 = 1 class, 2 = 2 classes, 3 = 3 classes, 4 = 4+ classes
    const heatmapData = Object.values(heatmapMap).map(item => ({
      ...item,
      intensity: Math.min(item.count, 4)
    }));

    // Calculate streaks & total days
    const totalDaysAttended = Object.keys(heatmapMap).length;

    res.json({
      heatmap: heatmapData,
      totalDaysAttended,
      totalRecords: records.length
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/attendance/alerts  — low attendance alerts below 75%
router.get('/alerts', auth, requireRole('student'), async (req, res) => {
  try {
    const sessions = await Session.find().select('subject').lean();
    const mine = await Attendance.find({ student: req.user.id }).select('session').lean();
    const attendedSet = new Set(mine.map(a => a.session.toString()));

    const stats = {};
    sessions.forEach(s => {
      if (!s.subject) return;
      const key = s.subject.toString();
      if (!stats[key]) stats[key] = { total: 0, attended: 0 };
      stats[key].total++;
      if (attendedSet.has(s._id.toString())) stats[key].attended++;
    });

    const subjects = await Subject.find({ _id: { $in: Object.keys(stats) } }).lean();
    const alerts = [];

    subjects.forEach(sub => {
      const st = stats[sub._id.toString()];
      if (!st || st.total === 0) return;

      const pct = Math.round((st.attended / st.total) * 100);
      if (pct < 75) {
        // Classes needed calculation: (attended + X) / (total + X) >= 0.75
        // X >= (0.75 * total - attended) / 0.25 => X = 3*total - 4*attended
        const classesNeeded = Math.max(1, Math.ceil((0.75 * st.total - st.attended) / 0.25));

        alerts.push({
          subjectId:     sub._id,
          subject:       sub.name,
          attended:      st.attended,
          total:         st.total,
          percentage:    pct,
          classesNeeded,
          isCritical:    pct < 60,
          shortfall:     75 - pct,
          message:       `Attendance in ${sub.name} is ${pct}%. Attend the next ${classesNeeded} consecutive class${classesNeeded > 1 ? 'es' : ''} to meet the 75% minimum threshold.`
        });
      }
    });

    res.json({
      hasLowAttendance: alerts.length > 0,
      alertCount: alerts.length,
      alerts
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;