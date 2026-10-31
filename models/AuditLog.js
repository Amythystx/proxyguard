const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  event: {
    type: String,
    required: true,
    enum: [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'USER_REGISTERED',
      'USER_DELETED',
      'SESSION_STARTED',
      'SESSION_ENDED',
      'SCAN_SUCCESS',
      'SCAN_DUPLICATE',
      'SCAN_EXPIRED_QR',
      'SCAN_GEO_FAIL',
      'SCAN_TAMPER_SIG'
    ]
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  userEmail: {
    type: String,
    default: null
  },
  role: {
    type: String,
    default: null
  },
  ip: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Index for fast audit filtering
auditLogSchema.index({ event: 1, severity: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
