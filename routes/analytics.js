/**
 * routes/analytics.js
 * Advanced analytics & intelligence reports for teachers and administrators.
 */
const express = require('express');
const mongoose = require('mongoose');
const Subject = require('../models/Subject');
const Session = require('../models/Session');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/analytics/teacher  — comprehensive analytics for teacher's courses
router.get('/teacher', auth, requireRole('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;

    // 1. Get teacher's subjects
    const subjects = await Subject.find({ teacher: teacherId }).lean();
    const subjectIds = subjects.map(s => s._id);

    // 2. Get all sessions for these subjects
    const sessions = await Session.find({ subject: { $in: subjectIds } })
      .populate('subject', 'name code')
      .sort({ startedAt: 1 })
      .lean();

    const sessionIds = sessions.map(s => s._id);

    // 3. Get all attendance records for these sessions
    const attendances = await Attendance.find({ session: { $in: sessionIds } })
      .populate('student', 'name email')
      .lean();

    // Map attendances per session
    const sessionAttendanceMap = {};
    attendances.forEach(a => {
      const sessId = a.session.toString();
      if (!sessionAttendanceMap[sessId]) sessionAttendanceMap[sessId] = [];
      sessionAttendanceMap[sessId].push(a);
    });

    // Count enrolled students (all students who attended at least 1 session across these subjects)
    const activeStudentIds = new Set(attendances.map(a => a.student?._id?.toString()).filter(Boolean));
    const allStudentsCount = await User.countDocuments({ role: 'student' });
    const baselineClassSize = Math.max(activeStudentIds.size, 1);

    // 4. Per-subject analytics
    const subjectStats = subjects.map(sub => {
      const subSessions = sessions.filter(s => s.subject && s.subject._id.toString() === sub._id.toString());
      const totalSessions = subSessions.length;

      let totalPresent = 0;
      subSessions.forEach(sess => {
        totalPresent += (sessionAttendanceMap[sess._id.toString()] || []).length;
      });

      const avgTurnout = totalSessions > 0
        ? Math.round((totalPresent / (totalSessions * baselineClassSize)) * 100)
        : 0;

      return {
        id: sub._id,
        name: sub.name,
        code: sub.code || '',
        totalSessions,
        totalPresent,
        avgTurnout: Math.min(100, avgTurnout)
      };
    });

    // 5. Day of week distribution
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats = {};
    daysOfWeek.forEach(d => { dayStats[d] = { sessions: 0, attendance: 0 }; });

    sessions.forEach(sess => {
      const d = new Date(sess.startedAt);
      const dayName = daysOfWeek[d.getDay()];
      dayStats[dayName].sessions++;
      dayStats[dayName].attendance += (sessionAttendanceMap[sess._id.toString()] || []).length;
    });

    // 6. Overall totals
    const totalSessionsHeld = sessions.length;
    const totalAttendancesRecorded = attendances.length;
    const overallTurnout = totalSessionsHeld > 0
      ? Math.round((totalAttendancesRecorded / (totalSessionsHeld * baselineClassSize)) * 100)
      : 0;

    // 7. Find at-risk students (< 75%)
    const studentSubjectMap = {}; // studentId -> { student, subjects: { subId: { attended, total } } }

    subjects.forEach(sub => {
      const subSessions = sessions.filter(s => s.subject && s.subject._id.toString() === sub._id.toString());
      const subTotal = subSessions.length;
      if (subTotal === 0) return;

      subSessions.forEach(sess => {
        const atts = sessionAttendanceMap[sess._id.toString()] || [];
        atts.forEach(a => {
          if (!a.student) return;
          const sId = a.student._id.toString();
          if (!studentSubjectMap[sId]) {
            studentSubjectMap[sId] = {
              student: a.student,
              attendanceBySubject: {}
            };
          }
          if (!studentSubjectMap[sId].attendanceBySubject[sub._id.toString()]) {
            studentSubjectMap[sId].attendanceBySubject[sub._id.toString()] = 0;
          }
          studentSubjectMap[sId].attendanceBySubject[sub._id.toString()]++;
        });
      });
    });

    const atRiskStudents = [];
    Object.values(studentSubjectMap).forEach(item => {
      subjects.forEach(sub => {
        const subSessions = sessions.filter(s => s.subject && s.subject._id.toString() === sub._id.toString());
        const total = subSessions.length;
        if (total === 0) return;

        const attended = item.attendanceBySubject[sub._id.toString()] || 0;
        const pct = Math.round((attended / total) * 100);

        if (pct < 75) {
          const needed = Math.max(1, Math.ceil((0.75 * total - attended) / 0.25));
          atRiskStudents.push({
            studentId: item.student._id,
            studentName: item.student.name,
            studentEmail: item.student.email,
            subjectId: sub._id,
            subjectName: sub.name,
            attended,
            total,
            percentage: pct,
            classesNeeded: needed,
            isCritical: pct < 60
          });
        }
      });
    });

    atRiskStudents.sort((a, b) => a.percentage - b.percentage);

    res.json({
      summary: {
        totalSubjects: subjects.length,
        totalSessions: totalSessionsHeld,
        totalAttendances: totalAttendancesRecorded,
        overallTurnout: Math.min(100, overallTurnout),
        atRiskCount: atRiskStudents.length
      },
      subjectStats,
      dayStats,
      atRiskStudents: atRiskStudents.slice(0, 50)
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/analytics/teacher/notify-at-risk  — send targeted low-attendance alert to a student
router.post('/teacher/notify-at-risk', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { studentId, subjectName, percentage, classesNeeded } = req.body;

    if (!studentId || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Valid student ID is required' });
    }

    const student = await User.findById(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const notif = await Notification.create({
      recipient: studentId,
      title: `⚠️ Urgent: Low Attendance Warning in ${subjectName || 'Course'}`,
      message: `Your current attendance is ${percentage || '<75'}%. University rules require a minimum of 75% attendance to sit for final examinations. Please attend the next ${classesNeeded || 2} consecutive classes.`,
      type: 'warning',
      link: 'student.html'
    });

    res.status(201).json({ message: `Warning alert sent to ${student.name}`, notificationId: notif._id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/analytics/admin  — system-wide analytics
router.get('/admin', auth, requireRole('admin'), async (req, res) => {
  try {
    const [totalStudents, totalTeachers, totalSubjects, totalSessions, totalAttendances] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'teacher' }),
      Subject.countDocuments(),
      Session.countDocuments(),
      Attendance.countDocuments()
    ]);

    // Daily attendance volume over the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAttendance = await Attendance.aggregate([
      { $match: { markedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$markedAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalStudents,
      totalTeachers,
      totalSubjects,
      totalSessions,
      totalAttendances,
      dailyTrend: recentAttendance
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
