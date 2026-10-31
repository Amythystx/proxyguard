// student.js — Student portal logic: anti-proxy camera, compact calendar, responsive heatmap, and 4 top summary cards
// All user text is inserted via textContent to prevent XSS.

requireRole('student');
initUserInfo();
initSidebar();

let scanner = null;
let busy    = false;
let currentCalDate = new Date();
let cachedMyRecords = [];
let cachedSummaryRecords = [];
let dayAttendanceMap = {}; // 'YYYY-MM-DD' -> [{ subject, time }]

// Helper to format local date key (YYYY-MM-DD) avoiding UTC shifts
function getLocalDateKey(dateInput) {
  const d = new Date(dateInput);
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Result feedback ────────────────────────────────────────────────────────
function showResult(text, type = 'bad') {
  const el = document.getElementById('result');
  if (!el) return;
  el.textContent = text || '';
  el.className   = text ? 'scan-result ' + type : 'scan-result';
}

// ── Camera controls ────────────────────────────────────────────────────────
async function startScan() {
  if (busy) return;
  showResult('');

  const frameEl       = document.getElementById('scannerFrame');
  const placeholderEl = document.getElementById('scannerPlaceholder');
  const loadingEl     = document.getElementById('scannerLoading');
  const startBtn      = document.getElementById('startBtn');
  const stopBtn       = document.getElementById('stopBtn');

  // Check for secure context
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showResult('Camera access requires HTTPS or localhost.', 'bad');
    return;
  }

  // Check MediaDevices support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showResult('Camera API is not supported in this browser.', 'bad');
    return;
  }

  // Check html5-qrcode
  if (!window.Html5Qrcode) {
    showResult('QR scanner library not loaded. Please refresh the page.', 'bad');
    return;
  }

  // Update UI to loading
  if (placeholderEl) placeholderEl.classList.add('hidden');
  if (loadingEl)     loadingEl.classList.remove('hidden');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = 'Accessing camera…';
  }

  // Cleanup stale scanner
  if (scanner) {
    try { if (scanner.isScanning) await scanner.stop(); } catch (_) {}
    try { scanner.clear(); } catch (_) {}
    scanner = null;
  }

  try {
    scanner = new Html5Qrcode('reader');

    const config = {
      fps: 10,
      qrbox: (w, h) => {
        const edge = Math.floor(Math.min(w, h) * 0.72);
        return { width: Math.max(180, edge), height: Math.max(180, edge) };
      },
      aspectRatio: 1.0
    };

    await scanner.start(
      { facingMode: 'environment' },
      config,
      onScan
    );

    // Live state
    if (loadingEl) loadingEl.classList.add('hidden');
    if (frameEl)   frameEl.classList.add('active');
    if (startBtn)  startBtn.classList.add('hidden');
    if (stopBtn) {
      stopBtn.classList.remove('hidden');
      stopBtn.disabled = false;
    }

    showResult('Camera active — align QR code within the viewfinder', 'info');

  } catch (err) {
    if (scanner) {
      try { scanner.clear(); } catch (_) {}
      scanner = null;
    }

    if (frameEl)       frameEl.classList.remove('active');
    if (loadingEl)     loadingEl.classList.add('hidden');
    if (placeholderEl) placeholderEl.classList.remove('hidden');

    if (startBtn) {
      startBtn.classList.remove('hidden');
      startBtn.disabled = false;
      startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="3"/><path d="M5 5s1.5 1 7 1 7-1 7-1M5 19s1.5-1 7-1 7 1 7 1M5 5v14M19 5v14"/></svg> Start Camera`;
    }
    if (stopBtn) stopBtn.classList.add('hidden');

    const errStr = (err ? err.toString() : '').toLowerCase();
    if (errStr.includes('denied') || errStr.includes('permission')) {
      showResult('Camera permission denied. Allow camera permissions in address bar.', 'bad');
    } else if (errStr.includes('notfound') || errStr.includes('no camera')) {
      showResult('No camera device detected on this system.', 'bad');
    } else {
      showResult('Could not initialize camera: ' + (err.message || errStr), 'bad');
    }
  }
}

async function stopScan() {
  const frameEl       = document.getElementById('scannerFrame');
  const placeholderEl = document.getElementById('scannerPlaceholder');
  const loadingEl     = document.getElementById('scannerLoading');
  const startBtn      = document.getElementById('startBtn');
  const stopBtn       = document.getElementById('stopBtn');

  if (scanner) {
    try { if (scanner.isScanning) await scanner.stop(); } catch (_) {}
    try { scanner.clear(); } catch (_) {}
    scanner = null;
  }

  if (frameEl)       frameEl.classList.remove('active');
  if (loadingEl)     loadingEl.classList.add('hidden');
  if (placeholderEl) placeholderEl.classList.remove('hidden');

  if (stopBtn) stopBtn.classList.add('hidden');
  if (startBtn) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="3"/><path d="M5 5s1.5 1 7 1 7-1 7-1M5 19s1.5-1 7-1 7 1 7 1M5 5v14M19 5v14"/></svg> Start Camera`;
  }
}

window.addEventListener('beforeunload', () => {
  if (scanner && scanner.isScanning) scanner.stop().catch(() => {});
});

// ── QR Scan Handler ────────────────────────────────────────────────────────
async function onScan(text) {
  if (busy) return;
  busy = true;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    showResult('Scanned QR code is not a valid ProxyGuard token.', 'bad');
    setTimeout(() => { busy = false; }, 3000);
    return;
  }

  showResult('Acquiring classroom location…', 'info');
  const loc = await getLocation();

  showResult('Verifying HMAC token & anti-proxy security…', 'info');
  const { ok, data } = await api('/api/attendance/mark', 'POST', { ...payload, ...(loc || {}) });

  if (ok) {
    showResult('✓ Attendance marked successfully!', 'ok');
    showToast('Attendance recorded successfully!', 'success');
    await stopScan();
    busy = false;
    loadAllStudentData();
  } else {
    showResult(data.message || 'Failed to mark attendance.', 'bad');
    showToast(data.message || 'Attendance scan rejected.', 'error');
    setTimeout(() => { busy = false; }, 3500);
  }
}

// ── Master Student Data Loader ─────────────────────────────────────────────
// Coordinates /api/attendance/my, /api/attendance/summary, and /api/attendance/alerts
async function loadAllStudentData() {
  const [myRes, sumRes, alertRes] = await Promise.all([
    api('/api/attendance/my'),
    api('/api/attendance/summary'),
    api('/api/attendance/alerts')
  ]);

  cachedMyRecords = myRes.ok ? (myRes.data || []) : [];
  cachedSummaryRecords = sumRes.ok ? (sumRes.data || []) : [];

  // Build day map from real attendance records
  dayAttendanceMap = {};
  cachedMyRecords.forEach(r => {
    if (!r.markedAt) return;
    const key = getLocalDateKey(r.markedAt);
    if (!dayAttendanceMap[key]) dayAttendanceMap[key] = [];
    dayAttendanceMap[key].push({
      subject: r.subject || 'Class Session',
      time: new Date(r.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 1. Update 4 Summary Stat Cards
  updateTopSummaryCards();

  // 2. Render Calendar & Heatmap
  renderCalendar(currentCalDate);
  renderHeatmap();

  // 3. Render Subject Progress Bars & History Table
  renderSubjectSummary(cachedSummaryRecords);
  renderHistoryTable(cachedMyRecords);

  // 4. Handle Low Attendance Alert Banner
  renderAlertBanner(alertRes);
}

// ── 1. Top Four Summary Cards ──────────────────────────────────────────────
function updateTopSummaryCards() {
  const statOverallPct  = document.getElementById('statOverallPct');
  const statLowCount    = document.getElementById('statLowCount');
  const statTotalScans  = document.getElementById('statTotalScans');
  const statLastScan    = document.getElementById('statLastScan');

  // Overall Attendance %
  let totalAttended = 0;
  let totalSessions = 0;
  cachedSummaryRecords.forEach(s => {
    totalAttended += (s.attended || 0);
    totalSessions += (s.total || 0);
  });
  const overallPct = totalSessions > 0 ? Math.round((totalAttended / totalSessions) * 100) : (cachedMyRecords.length > 0 ? 100 : 0);
  if (statOverallPct) statOverallPct.textContent = `${overallPct}%`;

  // Subjects below 75%
  const lowCount = cachedSummaryRecords.filter(s => s.percentage < 75 && s.total > 0).length;
  if (statLowCount) {
    statLowCount.textContent = lowCount;
    statLowCount.style.color = lowCount > 0 ? 'var(--danger)' : 'var(--success)';
  }

  // Total sessions attended
  if (statTotalScans) statTotalScans.textContent = cachedMyRecords.length;

  // Last scan time
  if (statLastScan) {
    if (cachedMyRecords.length > 0 && cachedMyRecords[0].markedAt) {
      const lastD = new Date(cachedMyRecords[0].markedAt);
      const todayKey = getLocalDateKey(new Date());
      const scanKey  = getLocalDateKey(lastD);

      const timeStr = lastD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (scanKey === todayKey) {
        statLastScan.textContent = `Today, ${timeStr}`;
      } else {
        const dateStr = lastD.toLocaleDateString([], { month: 'short', day: 'numeric' });
        statLastScan.textContent = `${dateStr}, ${timeStr}`;
      }
    } else {
      statLastScan.textContent = 'No scans yet';
    }
  }
}

// ── 2. Compact Attendance Calendar ─────────────────────────────────────────
function renderCalendar(refDate) {
  const calGrid    = document.getElementById('calendarGrid');
  const monthLabel = document.getElementById('calMonthLabel');
  if (!calGrid || !monthLabel) return;

  const year  = refDate.getFullYear();
  const month = refDate.getMonth();

  monthLabel.textContent = refDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
  calGrid.innerHTML = '';

  // Weekday Headers
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  dayNames.forEach(d => {
    const h = document.createElement('div');
    h.className   = 'cal-day-header';
    h.textContent = d;
    calGrid.appendChild(h);
  });

  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth   = new Date(year, month + 1, 0).getDate();
  const todayKey      = getLocalDateKey(new Date());

  // Leading empty cells
  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    calGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sessions = dayAttendanceMap[dateKey];
    const hasAttendance = Array.isArray(sessions) && sessions.length > 0;

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (dateKey === todayKey) cell.classList.add('today');
    if (hasAttendance) cell.classList.add('has-attendance');

    const numSpan = document.createElement('span');
    numSpan.className   = 'cal-day-num';
    numSpan.textContent = day;
    cell.appendChild(numSpan);

    if (hasAttendance) {
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      cell.appendChild(dot);

      cell.onclick = () => showDayDetails(dateKey, sessions);
    }

    calGrid.appendChild(cell);
  }
}

function showDayDetails(dateKey, sessions) {
  const detailsEl = document.getElementById('calDayDetails');
  if (!detailsEl) return;

  detailsEl.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'cal-details-header';
  const formattedDate = new Date(dateKey + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  header.textContent = `Attendance on ${formattedDate} (${sessions.length} class${sessions.length > 1 ? 'es' : ''}):`;
  detailsEl.appendChild(header);

  sessions.forEach(s => {
    const line = document.createElement('div');
    line.className = 'cal-details-line';

    const strong = document.createElement('strong');
    strong.textContent = s.subject;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = ` — marked at ${s.time}`;

    line.appendChild(strong);
    line.appendChild(timeSpan);
    detailsEl.appendChild(line);
  });

  detailsEl.classList.remove('hidden');
}

// ── 3. Full-Width Attendance Heatmap ───────────────────────────────────────
function renderHeatmap() {
  const container = document.getElementById('heatmapGrid');
  const badge     = document.getElementById('totalDaysBadge');
  if (!container) return;
  container.innerHTML = '';

  const activeDaysCount = Object.keys(dayAttendanceMap).length;
  if (badge) badge.textContent = `${activeDaysCount} Active Day${activeDaysCount !== 1 ? 's' : ''}`;

  // Render past 84 days (12 weeks)
  const today = new Date();
  const daysToShow = 84;
  const startDate = new Date();
  startDate.setDate(today.getDate() - (daysToShow - 1));

  for (let i = 0; i < daysToShow; i++) {
    const cur = new Date(startDate);
    cur.setDate(startDate.getDate() + i);
    const dateKey = getLocalDateKey(cur);

    const sessions = dayAttendanceMap[dateKey] || [];
    const count = sessions.length;
    const level = count === 0 ? 0 : Math.min(count, 4);

    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${level}`;

    const formattedDate = cur.toLocaleDateString([], { month: 'short', day: 'numeric' });
    cell.title = count > 0
      ? `${count} class${count > 1 ? 'es' : ''} attended on ${formattedDate}`
      : `No attendance on ${formattedDate}`;

    if (count > 0) {
      cell.style.cursor = 'pointer';
      cell.onclick = () => showDayDetails(dateKey, sessions);
    }

    container.appendChild(cell);
  }
}

// ── 4. Subject Attendance Summary Progress Bars ────────────────────────────
function renderSubjectSummary(data) {
  const body = document.getElementById('summaryBody');
  if (!body) return;
  body.innerHTML = '';

  if (!data || data.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:24px 16px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
      <div style="font-weight:600;font-size:14px;color:var(--text-main);">No courses registered yet</div>
      <div class="hint" style="font-size:12.5px;margin-top:3px;">Your subject-wise attendance percentages will be calculated here once classes begin.</div>
    </div>`;
    return;
  }

  data.forEach(r => {
    const isLow = r.percentage < 75;

    const row = document.createElement('div');
    row.className = 'subject-row';

    const header = document.createElement('div');
    header.className = 'subject-header';

    const nameEl = document.createElement('span');
    nameEl.className   = 'subject-name';
    nameEl.textContent = r.subject;

    const rightGroup = document.createElement('div');
    rightGroup.style.display    = 'flex';
    rightGroup.style.alignItems = 'center';
    rightGroup.style.gap        = '8px';

    const statusPill = document.createElement('span');
    statusPill.className   = 'pill ' + (isLow ? 'pill-danger' : 'pill-live');
    statusPill.textContent = isLow ? 'At Risk (<75%)' : 'Exam Eligible';

    const pctEl = document.createElement('span');
    pctEl.className = 'subject-pct ' + (isLow ? 'low' : 'ok');
    pctEl.textContent = r.percentage + '%';

    const countEl = document.createElement('span');
    countEl.className   = 'subject-count';
    countEl.textContent = `(${r.attended}/${r.total})`;
    pctEl.appendChild(countEl);

    rightGroup.appendChild(statusPill);
    rightGroup.appendChild(pctEl);

    header.appendChild(nameEl);
    header.appendChild(rightGroup);

    const barWrap = document.createElement('div');
    barWrap.className = 'progress-bar';

    const fill = document.createElement('div');
    fill.className    = 'progress-fill ' + (isLow ? 'low' : 'ok');
    fill.style.width  = `${Math.min(100, Math.max(0, r.percentage))}%`;

    barWrap.appendChild(fill);
    row.appendChild(header);
    row.appendChild(barWrap);

    // Shortfall recovery hint
    if (isLow && r.total > 0) {
      const needed = Math.max(1, 3 * r.total - 4 * r.attended);
      const hint = document.createElement('div');
      hint.className   = 'subject-recovery-hint';
      hint.textContent = `Shortfall: ${75 - r.percentage}%. Attend the next ${needed} consecutive class${needed > 1 ? 'es' : ''} to regain exam eligibility.`;
      row.appendChild(hint);
    }

    body.appendChild(row);
  });
}

// ── 5. Personal Attendance Log Table ───────────────────────────────────────
function renderHistoryTable(records) {
  const tbody = document.getElementById('historyRows');
  const countBadge = document.getElementById('count');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (countBadge) countBadge.textContent = records.length;

  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="padding:32px 16px;text-align:center;">
      <div class="empty-state" style="padding:10px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;opacity:0.4;margin-bottom:6px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style="font-weight:600;font-size:13.5px;color:var(--text-main);">No attendance scans yet</div>
        <div class="hint" style="font-size:12px;margin-top:2px;">Scan your teacher's classroom QR code to record attendance.</div>
      </div>
    </td></tr>`;
    return;
  }

  records.forEach(r => {
    const tr = document.createElement('tr');

    const subjectTd = document.createElement('td');
    subjectTd.className   = 'td-primary';
    subjectTd.textContent = r.subject || 'Class';

    const timeTd = document.createElement('td');
    timeTd.className   = 'td-muted';
    timeTd.textContent = new Date(r.markedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    const statusTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className   = 'pill pill-live';
    pill.textContent = 'Verified Present';
    statusTd.appendChild(pill);

    tr.appendChild(subjectTd);
    tr.appendChild(timeTd);
    tr.appendChild(statusTd);
    tbody.appendChild(tr);
  });
}

// ── 6. Low Attendance Alerts Banner ────────────────────────────────────────
function renderAlertBanner(alertRes) {
  const alertEl = document.getElementById('lowAttendanceAlert');
  if (!alertEl) return;

  if (!alertRes.ok || !alertRes.data || !alertRes.data.hasLowAttendance || !alertRes.data.alerts || alertRes.data.alerts.length === 0) {
    alertEl.classList.add('hidden');
    return;
  }

  const data = alertRes.data;
  const alertTitle = document.getElementById('alertTitle');
  const alertBadge = document.getElementById('alertBadge');
  const cardsList  = document.getElementById('alertCardsList');

  if (alertTitle) alertTitle.textContent = `Action Required: Low Attendance in ${data.alertCount} Course${data.alertCount > 1 ? 's' : ''}`;
  if (alertBadge) alertBadge.textContent = `${data.alertCount} Below 75%`;

  if (cardsList) {
    cardsList.innerHTML = '';
    data.alerts.forEach(a => {
      const card = document.createElement('div');
      card.className = 'alert-card';

      const header = document.createElement('div');
      header.className = 'alert-card-header';

      const subjectName = document.createElement('span');
      subjectName.className   = 'alert-card-subject';
      subjectName.textContent = a.subject;

      const pctBadge = document.createElement('span');
      pctBadge.className   = 'alert-card-pct';
      pctBadge.textContent = `${a.percentage}% Attendance`;

      header.appendChild(subjectName);
      header.appendChild(pctBadge);

      const meta = document.createElement('div');
      meta.className   = 'alert-card-meta';
      meta.textContent = `Attended ${a.attended} of ${a.total} session${a.total > 1 ? 's' : ''} • Examination Requirement: 75%`;

      const action = document.createElement('div');
      action.className   = 'alert-card-action';
      action.textContent = `⚠️ You must attend the next ${a.classesNeeded} consecutive class${a.classesNeeded > 1 ? 'es' : ''} to restore exam eligibility.`;

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(action);
      cardsList.appendChild(card);
    });
  }

  alertEl.classList.remove('hidden');
}

// ── Month Navigation Controls ──────────────────────────────────────────────
document.getElementById('calPrevBtn')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() - 1);
  renderCalendar(currentCalDate);
});

document.getElementById('calNextBtn')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() + 1);
  renderCalendar(currentCalDate);
});

// Initial boot
loadAllStudentData();