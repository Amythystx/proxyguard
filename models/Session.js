const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  secret: { type: String, required: true },
  active: { type: Boolean, default: true },
  location: { lat: Number, lng: Number },
  radius: { type: Number, default: 150 },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);