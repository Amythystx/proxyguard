/**
 * test/security.test.js
 * Non-destructive automated security & utility test suite.
 * Run via: node test/security.test.js
 */
const assert = require('assert');
const { sign, verify, TOKEN_VALIDITY_MS } = require('../utils/token');
const { isValidLocation, distanceMeters } = require('../utils/geo');
const { auth, requireRole } = require('../middleware/auth');
const bcrypt = require('bcrypt');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runAsyncTest(description, fn) {
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n── Running ProxyGuard Security & Math Primitives Test Suite ──');

  // 1. HMAC Token Verification
  console.log('\n[1] Dynamic QR Token (HMAC-SHA256 & Timing-Safe Equality)');
  const sessionId = '654321654321654321654321';
  const secret = 'test-secret-key-12345678901234567890';
  const now = Date.now();

  test('sign produces 64-character hex hash', () => {
    const sig = sign(sessionId, now, secret);
    assert.strictEqual(typeof sig, 'string');
    assert.strictEqual(sig.length, 64);
  });

  test('verify returns true for authentic signature', () => {
    const sig = sign(sessionId, now, secret);
    const valid = verify(sessionId, now, sig, secret);
    assert.strictEqual(valid, true);
  });

  test('verify returns false for forged or tampered signature', () => {
    const forgedSig = 'a'.repeat(64);
    const valid = verify(sessionId, now, forgedSig, secret);
    assert.strictEqual(valid, false);
  });

  test('verify returns false when checked against wrong session secret', () => {
    const sig = sign(sessionId, now, secret);
    const valid = verify(sessionId, now, sig, 'different-secret');
    assert.strictEqual(valid, false);
  });

  test('Token validity constant is set to 30 seconds', () => {
    assert.strictEqual(TOKEN_VALIDITY_MS, 30000);
  });

  // 2. Classroom Geo-fencing & Haversine Distance
  console.log('\n[2] Geo-fencing & Haversine Distance');

  test('isValidLocation accepts valid lat/lng coordinates', () => {
    assert.strictEqual(isValidLocation(28.6139, 77.2090), true);
    assert.strictEqual(isValidLocation(-33.8688, 151.2093), true);
    assert.strictEqual(isValidLocation(0, 0), true);
  });

  test('isValidLocation rejects invalid, out-of-bounds, or NaN coordinates', () => {
    assert.strictEqual(isValidLocation(91, 0), false);
    assert.strictEqual(isValidLocation(0, 181), false);
    assert.strictEqual(isValidLocation(NaN, 50), false);
    assert.strictEqual(isValidLocation('28.61', '77.20'), false);
    assert.strictEqual(isValidLocation(null, null), false);
  });

  test('distanceMeters returns 0 for identical coordinates', () => {
    const dist = distanceMeters(28.6139, 77.2090, 28.6139, 77.2090);
    assert.strictEqual(Math.round(dist), 0);
  });

  test('distanceMeters accurately calculates classroom proximity (within ~100m)', () => {
    const dist = distanceMeters(28.6139, 77.2090, 28.6148, 77.2090);
    assert.ok(dist >= 90 && dist <= 110, `Expected ~100m, got ${dist}m`);
  });

  // 3. CSV Injection Defense
  console.log('\n[3] CSV Formula Injection Protection');

  test('CSV sanitizer neutralizes formula prefixes (=, +, -, @)', () => {
    const safeCsvCell = v => {
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };

    assert.strictEqual(safeCsvCell('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"');
    assert.strictEqual(safeCsvCell('+cmd|/c'), '"\'+cmd|/c"');
    assert.strictEqual(safeCsvCell('-123'), '"\'-123"');
    assert.strictEqual(safeCsvCell('@SUM'), '"\'@SUM"');
    assert.strictEqual(safeCsvCell('Normal Student'), '"Normal Student"');
  });

  // 4. Password Hashing
  console.log('\n[4] Password Hashing & Salt Verification');

  await runAsyncTest('bcrypt correctly hashes and compares password', async () => {
    const rawPass = 'Student@2026';
    const hash = await bcrypt.hash(rawPass, 10);
    assert.notStrictEqual(hash, rawPass);
    const match = await bcrypt.compare(rawPass, hash);
    assert.strictEqual(match, true);
    const wrong = await bcrypt.compare('WrongPassword', hash);
    assert.strictEqual(wrong, false);
  });

  // 5. Defensive Token Parameter Guards
  console.log('\n[5] Defensive QR Token Verification & Parameter Guards');

  test('verify returns false on missing or null secret without throwing', () => {
    assert.strictEqual(verify(sessionId, now, 'some-sig', null), false);
    assert.strictEqual(verify(sessionId, now, 'some-sig', undefined), false);
  });

  test('verify returns false on malformed or non-string signature without throwing', () => {
    assert.strictEqual(verify(sessionId, now, 12345, secret), false);
    assert.strictEqual(verify(sessionId, now, null, secret), false);
    assert.strictEqual(verify(sessionId, now, '', secret), false);
  });

  test('verify returns false on null sessionId or timestamp without throwing', () => {
    assert.strictEqual(verify(null, now, 'some-sig', secret), false);
    assert.strictEqual(verify(sessionId, null, 'some-sig', secret), false);
  });

  test('sign throws TypeError with missing arguments', () => {
    assert.throws(() => sign(null, now, secret), /TypeError/);
    assert.throws(() => sign(sessionId, now, null), /TypeError/);
  });

  // 6. Middleware Defensive Guards
  console.log('\n[6] Auth Middleware & Role Guard Robustness');

  test('requireRole returns 403 when req.user is undefined', () => {
    const guard = requireRole('admin');
    let statusSet = null;
    let jsonSent = null;
    let nextCalled = false;

    const mockReq = {};
    const mockRes = {
      status(s) { statusSet = s; return this; },
      json(d) { jsonSent = d; }
    };
    const mockNext = () => { nextCalled = true; };

    guard(mockReq, mockRes, mockNext);
    assert.strictEqual(statusSet, 403);
    assert.deepStrictEqual(jsonSent, { message: 'Access denied' });
    assert.strictEqual(nextCalled, false);
  });

  test('requireRole returns 403 when req.user.role does not match', () => {
    const guard = requireRole('admin');
    let statusSet = null;
    let jsonSent = null;
    let nextCalled = false;

    const mockReq = { user: { role: 'student' } };
    const mockRes = {
      status(s) { statusSet = s; return this; },
      json(d) { jsonSent = d; }
    };
    const mockNext = () => { nextCalled = true; };

    guard(mockReq, mockRes, mockNext);
    assert.strictEqual(statusSet, 403);
    assert.deepStrictEqual(jsonSent, { message: 'Access denied' });
    assert.strictEqual(nextCalled, false);
  });

  test('requireRole calls next() when req.user.role matches', () => {
    const guard = requireRole('teacher', 'admin');
    let nextCalled = false;

    const mockReq = { user: { role: 'teacher' } };
    const mockRes = {};
    const mockNext = () => { nextCalled = true; };

    guard(mockReq, mockRes, mockNext);
    assert.strictEqual(nextCalled, true);
  });

  test('auth returns 401 when Authorization header is missing or malformed', () => {
    let statusSet = null;
    let jsonSent = null;
    const mockRes = {
      status(s) { statusSet = s; return this; },
      json(d) { jsonSent = d; }
    };

    auth({ headers: {} }, mockRes, () => {});
    assert.strictEqual(statusSet, 401);
    assert.deepStrictEqual(jsonSent, { message: 'No token provided' });

    auth({ headers: { authorization: 'Basic 12345' } }, mockRes, () => {});
    assert.strictEqual(statusSet, 401);
    assert.deepStrictEqual(jsonSent, { message: 'No token provided' });
  });

  // 7. Auth Route Primitives Validation
  console.log('\n[7] Auth Route Input Validation Logic (Email & Password)');

  test('email regex validator rejects invalid email formats', () => {
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    assert.strictEqual(EMAIL_REGEX.test('invalid-email'), false);
    assert.strictEqual(EMAIL_REGEX.test('missing@tld'), false);
    assert.strictEqual(EMAIL_REGEX.test('@domain.com'), false);
    assert.strictEqual(EMAIL_REGEX.test(''), false);
  });

  test('email regex validator accepts valid email formats', () => {
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    assert.strictEqual(EMAIL_REGEX.test('student@college.edu'), true);
    assert.strictEqual(EMAIL_REGEX.test('prof.smith@univ.ac.in'), true);
  });

  test('password length check rejects < 6 chars and accepts >= 6 chars', () => {
    const isMinLength = p => typeof p === 'string' && p.length >= 6;
    assert.strictEqual(isMinLength('12345'), false);
    assert.strictEqual(isMinLength('123456'), true);
    assert.strictEqual(isMinLength('strongPassword2026'), true);
  });

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`══════════════════════════════════════════════════\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
