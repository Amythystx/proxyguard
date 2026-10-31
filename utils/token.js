const crypto = require('crypto');

const TOKEN_VALIDITY_MS = 30 * 1000; // QR is valid for 30 seconds

function sign(sessionId, timestamp, secret) {
  if (!sessionId || !timestamp || !secret || (typeof secret !== 'string' && !Buffer.isBuffer(secret))) {
    throw new TypeError('Invalid arguments for token signing: sessionId, timestamp, and secret are required.');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${sessionId}.${timestamp}`)
    .digest('hex');
}

function verify(sessionId, timestamp, sig, secret) {
  if (
    !sessionId ||
    !timestamp ||
    !sig ||
    !secret ||
    (typeof secret !== 'string' && !Buffer.isBuffer(secret)) ||
    typeof sig !== 'string'
  ) {
    return false;
  }
  try {
    const expected = Buffer.from(sign(sessionId, timestamp, secret));
    const received = Buffer.from(sig);
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch (err) {
    return false;
  }
}

module.exports = { sign, verify, TOKEN_VALIDITY_MS };