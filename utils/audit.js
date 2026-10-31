/**
 * utils/audit.js
 * Central security audit logging & automated security alert dispatch.
 */
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

/**
 * Log a security or system event.
 * Runs asynchronously and never throws so it won't disrupt HTTP responses.
 */
async function logSecurityEvent(req, { event, severity = 'info', user = null, userEmail = null, role = null, details = {} }) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown').toString() : 'system';
    const userAgent = req ? (req.headers['user-agent'] || 'unknown') : 'system';

    const userId = user ? (user._id || user.id || user) : (req?.user?.id || null);
    const email = userEmail || req?.user?.email || null;
    const userRole = role || req?.user?.role || null;

    const log = await AuditLog.create({
      event,
      severity,
      user: userId,
      userEmail: email,
      role: userRole,
      ip,
      userAgent,
      details
    });

    // If critical security event (e.g., Geo-fence breach, tamper signature, expired token reuse),
    // automatically generate an in-app notification for the administrator.
    if (severity === 'critical' || event === 'SCAN_GEO_FAIL' || event === 'SCAN_TAMPER_SIG') {
      const summaryMsg = details.message || `Potential proxy attempt detected: ${event} from IP ${ip}`;
      await Notification.create({
        targetRole: 'admin',
        title: `Security Alert: ${event}`,
        message: summaryMsg,
        type: 'security',
        link: 'admin.html#auditLogs'
      }).catch(() => {});
    }

    return log;
  } catch (err) {
    console.error('Audit logging error:', err.message);
    return null;
  }
}

module.exports = { logSecurityEvent };
