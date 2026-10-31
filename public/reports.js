// reports.js — Faculty reports & advanced analytics
// All user text inserted via textContent to prevent XSS.

requireRole('teacher');
initUserInfo();
initSidebar();

const msgEl = document.getElementById('msg');

function showMsg(text, ok = false) {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className   = 'msg-bar ' + (text ? (ok ? 'ok' : 'err') : '');
}

function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

// ── Advanced Analytics Loader ──────────────────────────────────────────────
async function loadAnalytics() {
  const { ok, data } = await api('/api/analytics/teacher');
  if (!ok) return;

  // Stat numbers
  const turnoutEl   = document.getElementById('statTurnout');
  const sessionsEl  = document.getElementById('statSessions');
  const attsEl      = document.getElementById('statAttendances');
  const atRiskEl    = document.getElementById('statAtRisk');
  const atRiskBadge = document.getElementById('atRiskBadge');

  if (turnoutEl)  turnoutEl.textContent  = `${data.summary.overallTurnout}%`;
  if (sessionsEl) sessionsEl.textContent = data.summary.totalSessions;
  if (attsEl)     attsEl.textContent     = data.summary.totalAttendances;
  if (atRiskEl)   atRiskEl.textContent   = data.summary.atRiskCount;
  if (atRiskBadge) atRiskBadge.textContent = `${data.summary.atRiskCount} Flagged`;

  // 1. Subject Analytics Bars
  const subContainer = document.getElementById('subjectAnalyticsBody');
  if (subContainer) {
    subContainer.innerHTML = '';
    if (!data.subjectStats || data.subjectStats.length === 0) {
      subContainer.innerHTML = `<div class="empty-state" style="padding:24px 16px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
        <div style="font-weight:600;font-size:13.5px;color:var(--text-main);">No course subjects yet</div>
        <div class="hint" style="font-size:12px;">Add subjects in the Course Management tab.</div>
      </div>`;
    } else {
      data.subjectStats.forEach(s => {
        const item = document.createElement('div');
        item.className = 'subject-analytics-item';
        item.innerHTML = `
          <div class="subject-header">
            <span class="subject-name"></span>
            <span class="subject-pct">${s.avgTurnout}% Turnout (${s.totalPresent} scans across ${s.totalSessions} classes)</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${s.avgTurnout < 75 ? 'low' : 'ok'}" style="width: ${s.avgTurnout}%"></div>
          </div>`;
        item.querySelector('.subject-name').textContent = s.name;
        subContainer.appendChild(item);
      });
    }
  }

  // 2. Day Trends
  const dayContainer = document.getElementById('dayTrendsBody');
  if (dayContainer) {
    dayContainer.innerHTML = '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const activeDays = days.filter(d => data.dayStats[d] && data.dayStats[d].sessions > 0);

    if (activeDays.length === 0) {
      dayContainer.innerHTML = `<div class="empty-state" style="padding:24px 16px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div style="font-weight:600;font-size:13.5px;color:var(--text-main);">No session day data recorded yet</div>
        <div class="hint" style="font-size:12px;">Weekly distribution will populate as classes are held.</div>
      </div>`;
    } else {
      activeDays.forEach(day => {
        const d = data.dayStats[day];
        const item = document.createElement('div');
        item.className = 'day-trend-item';
        item.innerHTML = `
          <div class="day-trend-label">
            <strong>${day}</strong>
            <span class="text-sm text-muted">${d.sessions} session${d.sessions > 1 ? 's' : ''} • ${d.attendance} total scans</span>
          </div>`;
        dayContainer.appendChild(item);
      });
    }
  }

  // 3. At-Risk Students Table (<75%)
  const atRiskTbody = document.getElementById('atRiskRows');
  if (atRiskTbody) {
    atRiskTbody.innerHTML = '';
    if (!data.atRiskStudents || data.atRiskStudents.length === 0) {
      atRiskTbody.innerHTML = `<tr><td colspan="6" style="padding:32px 16px;text-align:center;">
        <div class="empty-state" style="padding:10px 0;">
          <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" style="width:36px;height:36px;margin-bottom:6px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <div style="font-weight:700;font-size:14px;color:var(--success-dark);">Healthy Attendance Across All Courses</div>
          <div class="hint" style="font-size:12px;">All enrolled students currently have attendance &ge; 75%.</div>
        </div>
      </td></tr>`;
    } else {
      data.atRiskStudents.forEach(stu => {
        const tr = document.createElement('tr');

        tr.appendChild(cell(stu.studentName, 'td-primary'));
        tr.appendChild(cell(stu.studentEmail, 'td-muted'));
        tr.appendChild(cell(stu.subjectName));

        // Percentage pill
        const pctTd = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = 'pill pill-danger';
        pill.textContent = `${stu.percentage}% (${stu.attended}/${stu.total})`;
        pctTd.appendChild(pill);
        tr.appendChild(pctTd);

        // Consecutive Needed
        const needTd = document.createElement('td');
        needTd.textContent = `${stu.classesNeeded} class${stu.classesNeeded > 1 ? 'es' : ''}`;
        tr.appendChild(needTd);

        // Action button
        const actTd = document.createElement('td');
        const alertBtn = document.createElement('button');
        alertBtn.className = 'btn btn-outline btn-xs';
        alertBtn.textContent = 'Dispatch Alert';
        alertBtn.onclick = () => sendStudentWarning(stu, alertBtn);
        actTd.appendChild(alertBtn);
        tr.appendChild(actTd);

        atRiskTbody.appendChild(tr);
      });
    }
  }
}

// ── Send Warning to At-Risk Student ────────────────────────────────────────
async function sendStudentWarning(student, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Dispatching…';

  const { ok, data } = await api('/api/analytics/teacher/notify-at-risk', 'POST', {
    studentId: student.studentId,
    subjectName: student.subjectName,
    percentage: student.percentage,
    classesNeeded: student.classesNeeded
  });

  if (ok) {
    btn.textContent = '✓ Dispatched';
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-primary');
    showMsg(`Warning notification dispatched to ${student.studentName}`, true);
    showToast(`Warning sent to ${student.studentName}`, 'success');
  } else {
    btn.disabled = false;
    btn.textContent = origText;
    showMsg(data.message || 'Failed to dispatch warning');
    showToast(data.message || 'Warning dispatch failed', 'error');
  }
}

// ── Session History Table ──────────────────────────────────────────────────
async function loadSessions() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  const { ok, data } = await api('/api/sessions');
  const rows = document.getElementById('rows');
  if (!rows) return;
  rows.innerHTML = '';

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Refresh`;
  }

  if (!ok) {
    showMsg(data.message || 'Failed to load sessions');
    rows.innerHTML = '<tr><td colspan="6" class="hint" style="text-align:center;padding:32px;">Could not load session history.</td></tr>';
    return;
  }

  const countEl = document.getElementById('sessionCount');
  if (countEl) countEl.textContent = data.length;

  if (data.length === 0) {
    rows.innerHTML = `<tr><td colspan="6" style="padding:32px 16px;text-align:center;">
      <div class="empty-state" style="padding:10px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
        <div style="font-weight:600;font-size:14px;color:var(--text-main);">No session history yet</div>
        <div class="hint" style="font-size:12px;">Start an attendance session from the Course Management tab.</div>
      </div>
    </td></tr>`;
    return;
  }

  data.forEach(s => {
    const tr = document.createElement('tr');

    tr.appendChild(cell(s.subject, 'td-primary'));
    tr.appendChild(cell(new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), 'td-muted'));
    tr.appendChild(cell(s.endedAt ? new Date(s.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'In Progress', 'td-muted'));

    const presentTd = document.createElement('td');
    const presentBadge = document.createElement('span');
    presentBadge.className   = 'badge';
    presentBadge.textContent = s.present;
    presentTd.appendChild(presentBadge);
    tr.appendChild(presentTd);

    const statusTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className   = s.active ? 'pill pill-live' : 'pill pill-idle';
    pill.textContent = s.active ? 'Live Now' : 'Completed';
    statusTd.appendChild(pill);
    tr.appendChild(statusTd);

    const btnTd = document.createElement('td');
    const dBtn = document.createElement('button');
    dBtn.className = 'btn btn-outline btn-xs';
    dBtn.setAttribute('aria-label', 'Download CSV for ' + s.subject);
    dBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      CSV`;
    dBtn.onclick = () => downloadCsv(s.id, s.subject, dBtn);
    btnTd.appendChild(dBtn);
    tr.appendChild(btnTd);

    rows.appendChild(tr);
  });
}

async function downloadCsv(id, subject, btn) {
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Exporting…';

  try {
    const res = await fetch('/api/sessions/' + id + '/export', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (res.status === 401) { logout(); return; }

    if (!res.ok) {
      let errMsg = 'Could not export file';
      try { const d = await res.json(); errMsg = d.message || errMsg; } catch (_) {}
      showMsg(errMsg);
      showToast(errMsg, 'error');
      return;
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const filename = 'attendance-' + subject.replace(/[^a-z0-9]/gi, '_') + '.csv';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showMsg('Downloaded: ' + filename, true);
    showToast('Downloaded ' + filename, 'success');
  } catch (err) {
    showMsg('Export failed: ' + err.message);
    showToast('Export failed', 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = origHTML;
  }
}

function initReports() {
  loadAnalytics();
  loadSessions();
}

initReports();