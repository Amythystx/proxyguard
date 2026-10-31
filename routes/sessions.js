/**
 * routes/sessions.js
 * Teacher session lifecycle:
 *   POST   /start             - start a new session (generates crypto secret, optionally records geo-fence)
 *   POST   /:id/end           - end an active session
 *   GET    /active            - restore running session after a page reload
 *   GET    /:id/qr            - generate a time-limited QR payload (HMAC-SHA256 signed)
 *   GET    /:id/attendance    - list students who have scanned in this session
 *   GET    /                  - full session history with present counts
 *   GET    /:id/export        - download one session's attendance as CSV (injection-safe)
 *
 * Security notes:
 *   • The session secret is stored server-side only; it is NEVER sent to the browser.
 *   • The QR payload is { s, t, sig } where sig = HMAC-SHA256(sessionId + "." + t, secret).
 *   • QRs expire after TOKEN_VALIDITY_MS (30 s). The teacher page fetches a fresh one every 20 s.
 *   • Geo-fence radius defaults to 150 m (Haversine in utils/geo.js).
 */
const express  = require('express');
const crypto   = require('crypto');
const mongoose = require('mongoose');
const Session   = require('../models/Session');
const Subject   = require('../models/Subject');
const { auth, requireRole } = require('../middleware/auth');
const QRCode    = require('qrcode');
const { sign, TOKEN_VALIDITY_MS } = require('../utils/token');
const Attendance = require('../models/Attendance');
const { isValidLocation } = require('../utils/geo');

const router = express.Router();

// ── helper ─────────────────────────────────────────────────────────────────
function badId(res) {
  return res.status(400).json({ message: 'Invalid session ID' });
}

// POST /api/sessions/start
router.post('/start', auth, requireRole('teacher'), async (req, res) => {
  try {
    const subject = await Subject.findOne({ _id: req.body.subjectId, teacher: req.user.id });
    if (!subject) return res.status(404).json({ message: 'Subject not found' });

    // Prevent duplicate active sessions for the same teacher
    const alreadyActive = await Session.findOne({ teacher: req.user.id, active: true });
    if (alreadyActive) {
      return res.status(400).json({ message: 'You already have an active session. End it before starting a new one.' });
    }

    // Geo-fence: if the teacher's browser provides valid coordinates, store them.
    // If not (denied / unavailable), the session runs without location checking.
    const { lat, lng } = req.body;
    const location = isValidLocation(lat, lng) ? { lat, lng } : undefined;

    // crypto.randomBytes generates a cryptographically random secret per session.
    // This secret never leaves the server — it is used only for HMAC signing.
    const session = await Session.create({
      subject:  subject._id,
      teacher:  req.user.id,
      secret:   crypto.randomBytes(32).toString('hex'),
      location
    });

    res.status(201).json({
      sessionId: session._id,
      subject:   subject.name,
      startedAt: session.startedAt,
      geofence:  !!location,
      radius:    session.radius
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/sessions/:id/end
router.post('/:id/end', auth, requireRole('teacher'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);

    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, teacher: req.user.id, active: true },
      { active: false, endedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!session) return res.status(404).json({ message: 'Active session not found' });
    res.json({ message: 'Session ended', endedAt: session.endedAt });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/sessions/active  — restores UI state after a teacher page reload
// NOTE: this route MUST be registered before /:id routes to avoid being matched as id="active"
router.get('/active', auth, requireRole('teacher'), async (req, res) => {
  try {
    const session = await Session.findOne({ teacher: req.user.id, active: true })
      .populate('subject', 'name');
    if (!session) return res.json({ session: null });
    res.json({
      session: {
        sessionId:  session._id,
        subject:    session.subject ? session.subject.name : 'Unknown',
        subjectId:  session.subject ? session.subject._id  : null,
        startedAt:  session.startedAt,
        geofence:   !!(session.location && isValidLocation(session.location.lat, session.location.lng)),
        radius:     session.radius
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/sessions/:id/qr
// Generates a fresh HMAC-signed payload and encodes it as a QR data URL.
// The signature binds sessionId + timestamp to the session secret, so the student
// cannot forge or replay tokens across different sessions.
router.get('/:id/qr', auth, requireRole('teacher'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);

    const session = await Session.findOne({ _id: req.params.id, teacher: req.user.id, active: true });
    if (!session) return res.status(404).json({ message: 'Active session not found' });

    const timestamp = Date.now();
    const sig       = sign(session._id.toString(), timestamp, session.secret);
    // payload is the raw object the student scanner will POST to /api/attendance/mark
    const payload   = JSON.stringify({ s: session._id, t: timestamp, sig });
    const qr        = await QRCode.toDataURL(payload);

    res.json({
      payload:        { s: session._id, t: timestamp, sig },
      expiresInSeconds: TOKEN_VALIDITY_MS / 1000,
      qr
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/sessions/:id/attendance  — live list of scanned students
router.get('/:id/attendance', auth, requireRole('teacher'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);

    const session = await Session.findOne({ _id: req.params.id, teacher: req.user.id });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const records = await Attendance.find({ session: session._id })
      .populate('student', 'name email')
      .sort({ markedAt: -1 });

    res.json(records.filter(r => r.student).map(r => ({
      name:     r.student.name,
      email:    r.student.email,
      markedAt: r.markedAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/sessions  — history list with attendance counts
router.get('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const sessions = await Session.find({ teacher: req.user.id })
      .populate('subject', 'name')
      .sort({ startedAt: -1 })
      .lean();

    // Single aggregation to count present students per session
    const counts = await Attendance.aggregate([
      { $match: { session: { $in: sessions.map(s => s._id) } } },
      { $group: { _id: '$session', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id.toString()] = c.count; });

    res.json(sessions.map(s => ({
      id:        s._id,
      subject:   s.subject ? s.subject.name : 'Deleted subject',
      startedAt: s.startedAt,
      endedAt:   s.endedAt,
      active:    s.active,
      present:   countMap[s._id.toString()] || 0
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/sessions/:id/export  — CSV download (injection-safe)
router.get('/:id/export', auth, requireRole('teacher'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);

    const session = await Session.findOne({ _id: req.params.id, teacher: req.user.id })
      .populate('subject', 'name');
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const records = await Attendance.find({ session: session._id })
      .populate('student', 'name email')
      .sort({ markedAt: 1 });

    // CSV injection protection: escape double-quotes and prepend ' to cells
    // starting with = + - @ which spreadsheet apps may interpret as formulas.
    const safe = v => {
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };

    const subjectName = session.subject ? session.subject.name : 'Deleted subject';
    const lines = ['Subject,Student Name,Email,Marked At'];
    records.filter(r => r.student).forEach(r => {
      lines.push([subjectName, r.student.name, r.student.email, r.markedAt.toISOString()].map(safe).join(','));
    });

    // Set Content-Disposition so the browser downloads the file
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${subjectName.replace(/[^a-z0-9]/gi, '_')}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;