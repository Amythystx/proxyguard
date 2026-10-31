// teacher.js — Faculty course & live session management
// All user text inserted via textContent to prevent XSS.

requireRole('teacher');
initUserInfo();
initSidebar();

const msgEl = document.getElementById('msg');
const subjectMsgEl = document.getElementById('subjectMsg');

let sessionId      = null;
let refreshTimer   = null;
let countdownTimer = null;
let scanTimer      = null;

// ── Message helpers ────────────────────────────────────────────────────────
function showMsg(text, ok = false) {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className   = 'msg-bar ' + (text ? (ok ? 'ok' : 'err') : '');
}

function showSubjectMsg(text, ok = false) {
  if (!subjectMsgEl) return;
  subjectMsgEl.textContent = text;
  subjectMsgEl.className   = 'msg-bar ' + (text ? (ok ? 'ok' : 'err') : '');
  if (text) setTimeout(() => { subjectMsgEl.textContent = ''; subjectMsgEl.className = 'msg-bar'; }, 4000);
}

// ── Subjects Registry ──────────────────────────────────────────────────────
async function loadSubjects() {
  const { ok, data } = await api('/api/subjects');
  const select = document.getElementById('subjectSelect');
  const rows   = document.getElementById('subjectRows');
  if (!select || !rows) return;

  select.innerHTML = '<option value="">— Choose subject —</option>';
  rows.innerHTML   = '';

  if (!ok) {
    showSubjectMsg(data.message || 'Failed to load courses');
    return;
  }

  if (data.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'hint';
    td.style.textAlign = 'center';
    td.style.padding   = '28px';
    td.textContent = 'No courses registered yet. Add your first subject above.';
    tr.appendChild(td);
    rows.appendChild(tr);
    return;
  }

  data.forEach(s => {
    // Dropdown option
    const opt = document.createElement('option');
    opt.value       = s._id;
    opt.textContent = s.name;
    select.appendChild(opt);

    // Table row
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'td-primary';
    nameTd.textContent = s.name;

    const lastTd = document.createElement('td');
    lastTd.className = 'td-muted';
    lastTd.textContent = s.lastSession ? new Date(s.lastSession).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

    const statusTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className   = s.active ? 'pill pill-live' : 'pill pill-idle';
    pill.textContent = s.active ? 'Active Now' : 'Idle';
    statusTd.appendChild(pill);

    // Quick Action button
    const actionTd = document.createElement('td');
    if (!s.active && !sessionId) {
      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-primary btn-xs';
      startBtn.textContent = 'Start Session';
      startBtn.onclick = () => {
        select.value = s._id;
        startSession();
      };
      actionTd.appendChild(startBtn);
    } else {
      actionTd.textContent = '—';
      actionTd.className = 'td-muted';
    }

    tr.appendChild(nameTd);
    tr.appendChild(lastTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionTd);
    rows.appendChild(tr);
  });
}

async function addSubject() {
  const input = document.getElementById('subjectName');
  const name  = input ? input.value.trim() : '';
  if (!name) { showSubjectMsg('Please enter a subject name'); return; }

  const btn = document.getElementById('addSubjectBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Registering…';
  }

  const { ok, data } = await api('/api/subjects', 'POST', { name });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Register Subject`;
  }

  if (!ok) {
    showSubjectMsg(data.message || 'Failed to register subject');
    return;
  }

  input.value = '';
  showSubjectMsg(`Subject "${name}" registered successfully`, true);
  showToast(`Registered: ${name}`, 'success');
  loadSubjects();
}

// ── Session Control ────────────────────────────────────────────────────────
async function startSession() {
  const select = document.getElementById('subjectSelect');
  const subjectId = select ? select.value : '';
  if (!subjectId) { showMsg('Please select a course subject first'); return; }

  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = 'Acquiring GPS location…';
  }

  showMsg('Acquiring classroom location…', true);
  const loc = await getLocation();

  if (startBtn) startBtn.textContent = 'Starting session…';
  const { ok, data } = await api('/api/sessions/start', 'POST', { subjectId, ...(loc || {}) });

  if (!ok) {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
    }
    showMsg(data.message || 'Failed to start session');
    showToast(data.message || 'Failed to start session', 'error');
    return;
  }

  sessionId = data.sessionId;
  activateSessionUI(data.subject, data.geofence, data.radius);
  showMsg('Live attendance session active — QR is live!', true);
  showToast(`Session active for ${data.subject}`, 'success');

  await refreshQR();
  await pollScans();
  refreshTimer = setInterval(refreshQR,  20000);
  scanTimer    = setInterval(pollScans,   5000);
  loadSubjects();
}

function activateSessionUI(subject, geofence, radius) {
  const badge = document.getElementById('sessionBadge');
  if (badge) {
    badge.textContent = 'Live Session';
    badge.className   = 'pill pill-live';
  }

  const statusEl = document.getElementById('sessionStatus');
  if (statusEl) {
    statusEl.style.display = 'flex';
    statusEl.className = 'session-status live';
    statusEl.textContent =
      '● Active Classroom Session — ' + subject +
      (geofence ? `  •  Geo-fence ON (${radius} m radius)` : '  •  Geo-fence OFF');
  }

  document.getElementById('startBtn')?.classList.add('hidden');
  document.getElementById('endBtn')?.classList.remove('hidden');
  const sel = document.getElementById('subjectSelect');
  if (sel) sel.disabled = true;

  // Prominent QR card
  const qrBox = document.getElementById('qrBox');
  if (qrBox) qrBox.classList.add('active');
  document.getElementById('qrPlaceholder')?.classList.add('hidden');
  document.getElementById('qrImg')?.classList.remove('hidden');
}

function deactivateSessionUI() {
  const badge = document.getElementById('sessionBadge');
  if (badge) {
    badge.textContent = 'No active session';
    badge.className   = 'pill pill-idle';
  }

  const statusEl = document.getElementById('sessionStatus');
  if (statusEl) statusEl.style.display = 'none';

  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Start Session`;
    startBtn.classList.remove('hidden');
  }
  document.getElementById('endBtn')?.classList.add('hidden');

  const sel = document.getElementById('subjectSelect');
  if (sel) sel.disabled = false;

  const qrBox = document.getElementById('qrBox');
  if (qrBox) qrBox.classList.remove('active');
  document.getElementById('qrPlaceholder')?.classList.remove('hidden');
  const qrImg = document.getElementById('qrImg');
  if (qrImg) {
    qrImg.classList.add('hidden');
    qrImg.src = '';
  }

  const timer = document.getElementById('timer');
  if (timer) timer.textContent = '';
  document.getElementById('countdownWrap')?.classList.remove('active');
  const bar = document.getElementById('countdownProgress');
  if (bar) bar.style.width = '100%';
}

// ── QR Refresh & Animated Progress Countdown ──────────────────────────────
async function refreshQR() {
  if (!sessionId) return;
  const { ok, data } = await api('/api/sessions/' + sessionId + '/qr');
  if (!ok) { showMsg(data.message || 'QR refresh failed'); return; }

  const img = document.getElementById('qrImg');
  if (img) img.src = data.qr;
  startCountdown(20);
}

function startCountdown(seconds) {
  clearInterval(countdownTimer);
  let left = seconds;
  const el   = document.getElementById('timer');
  const wrap = document.getElementById('countdownWrap');
  const bar  = document.getElementById('countdownProgress');

  if (wrap) wrap.classList.add('active');
  if (el) el.textContent = `QR refreshes in ${left}s`;
  if (bar) bar.style.width = '100%';

  countdownTimer = setInterval(() => {
    left--;
    if (el) el.textContent = left > 0 ? `QR refreshes in ${left}s` : 'Refreshing dynamic QR…';
    if (bar) bar.style.width = `${Math.max(0, (left / seconds) * 100)}%`;

    if (left <= 0) {
      clearInterval(countdownTimer);
    }
  }, 1000);
}

// ── Real-Time Scan Polling ─────────────────────────────────────────────────
async function pollScans() {
  if (!sessionId) return;
  const { ok, data } = await api('/api/sessions/' + sessionId + '/attendance');
  if (!ok) return;

  const scanBadge = document.getElementById('scanCount');
  if (scanBadge) scanBadge.textContent = data.length;

  const list    = document.getElementById('scanList');
  const emptyEl = document.getElementById('scanEmptyState');
  if (!list) return;

  if (data.length === 0) {
    list.innerHTML = '';
    if (emptyEl) list.appendChild(emptyEl);
    return;
  }

  // Update only if scan count changed
  if (list.dataset.count === String(data.length)) return;
  list.dataset.count = data.length;
  list.innerHTML = '';

  data.forEach(r => {
    const li = document.createElement('li');

    const av = document.createElement('div');
    av.className   = 'scan-avatar';
    av.textContent = (r.name || '?').charAt(0).toUpperCase();

    const info = document.createElement('div');

    const nameEl = document.createElement('div');
    nameEl.className   = 'scan-name';
    nameEl.textContent = r.name;

    const timeEl = document.createElement('div');
    timeEl.className   = 'scan-time';
    timeEl.textContent = new Date(r.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    info.appendChild(nameEl);
    info.appendChild(timeEl);
    li.appendChild(av);
    li.appendChild(info);
    list.appendChild(li);
  });
}

// ── End Session ────────────────────────────────────────────────────────────
async function endSession() {
  const confirmed = await confirmDialog(
    'End Active Session?',
    'This will terminate the dynamic QR code and prevent further attendance scans. All recorded scans are securely saved.',
    'End Session',
    true
  );
  if (!confirmed) return;

  clearInterval(refreshTimer);
  clearInterval(countdownTimer);
  clearInterval(scanTimer);
  refreshTimer = countdownTimer = scanTimer = null;

  await pollScans();

  const { ok, data } = await api('/api/sessions/' + sessionId + '/end', 'POST');
  if (!ok) { showMsg(data.message || 'Failed to end session'); return; }

  sessionId = null;
  deactivateSessionUI();
  showMsg('Session ended. Attendance records saved successfully.', true);
  showToast('Session ended successfully', 'info');
  loadSubjects();
}

// ── Restore Active Session on Reload ──────────────────────────────────────
async function checkActiveSession() {
  const { ok, data } = await api('/api/sessions/active');
  if (!ok || !data || !data.session) return;

  const s = data.session;
  sessionId = s.sessionId;
  activateSessionUI(s.subject, s.geofence, s.radius);
  showMsg('Restored active session — ' + s.subject, true);

  await refreshQR();
  await pollScans();
  refreshTimer = setInterval(refreshQR,  20000);
  scanTimer    = setInterval(pollScans,   5000);
}

// ── Global Init ────────────────────────────────────────────────────────────
async function init() {
  await loadSubjects();
  await checkActiveSession();
}

init();