// admin.js — Admin command center logic with security audit trail & at-risk tracking
// All user-provided data is inserted via textContent to prevent XSS.

requireRole('admin');
initUserInfo();
initSidebar();

const msgEl = document.getElementById('msg');
let allUsers = []; // client-side search cache
let currentTab = 'users';

function showMsg(text, ok = false) {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className   = 'msg-bar ' + (text ? (ok ? 'ok' : 'err') : '');
  if (text && ok) setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'msg-bar'; }, 4000);
}

function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

// ── Tab Management ─────────────────────────────────────────────────────────
function switchAdminTab(tabName) {
  currentTab = tabName;

  ['tabUsers', 'tabAudit', 'tabAtRisk'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  ['panelUsers', 'panelAudit', 'panelAtRisk'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  if (tabName === 'users') {
    document.getElementById('tabUsers')?.classList.add('active');
    document.getElementById('panelUsers')?.classList.remove('hidden');
  } else if (tabName === 'audit') {
    document.getElementById('tabAudit')?.classList.add('active');
    document.getElementById('panelAudit')?.classList.remove('hidden');
    loadAuditLogs();
  } else if (tabName === 'atRisk') {
    document.getElementById('tabAtRisk')?.classList.add('active');
    document.getElementById('panelAtRisk')?.classList.remove('hidden');
    loadAtRisk();
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  const { ok, data } = await api('/api/admin/stats');
  if (!ok) return;

  const statStudents   = document.getElementById('statStudents');
  const statTeachers   = document.getElementById('statTeachers');
  const statSubjects   = document.getElementById('statSubjects');
  const statSessions   = document.getElementById('statSessions');
  const statAttendance = document.getElementById('statAttendance');
  const statAlerts     = document.getElementById('statAlerts');

  if (statStudents)   statStudents.textContent   = data.students;
  if (statTeachers)   statTeachers.textContent   = data.teachers;
  if (statSubjects)   statSubjects.textContent   = data.subjects;
  if (statSessions)   statSessions.textContent   = data.sessions;
  if (statAttendance) statAttendance.textContent = data.attendance;
  if (statAlerts)     statAlerts.textContent     = data.securityAlerts || 0;
}

// ── Users Directory ────────────────────────────────────────────────────────
async function loadUsers() {
  const { ok, data } = await api('/api/admin/users');
  if (!ok) { showMsg(data.message || 'Failed to load user directory'); return; }
  allUsers = data;
  const countEl = document.getElementById('userCount');
  if (countEl) countEl.textContent = data.length;
  renderUsers(allUsers);
}

function renderUsers(users) {
  const tbody = document.getElementById('userRows');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:32px 16px;text-align:center;">
      <div class="empty-state" style="padding:10px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        <div style="font-weight:600;font-size:14px;color:var(--text-main);">No matching users found</div>
        <div class="hint" style="font-size:12px;">Try adjusting your search query.</div>
      </div>
    </td></tr>`;
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');

    tr.appendChild(cell(u.name, 'td-primary'));
    tr.appendChild(cell(u.email, 'td-muted'));

    // Role pill
    const roleTd = document.createElement('td');
    const pill   = document.createElement('span');
    const roleClass = { teacher: 'pill-teacher', student: 'pill-student', admin: 'pill-admin' }[u.role] || 'pill-idle';
    pill.className   = 'pill ' + roleClass;
    pill.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    roleTd.appendChild(pill);
    tr.appendChild(roleTd);

    // Joined date
    tr.appendChild(cell(u.createdAt ? new Date(u.createdAt).toLocaleDateString([], { dateStyle: 'medium' }) : '—', 'td-muted'));

    // Action button
    const actionTd = document.createElement('td');
    if (u.role !== 'admin') {
      const btn = document.createElement('button');
      btn.className   = 'btn btn-danger btn-xs';
      btn.textContent = 'Delete Account';
      btn.setAttribute('aria-label', 'Delete user ' + u.name);
      btn.onclick = () => deleteUser(u._id, u.name, u.role);
      actionTd.appendChild(btn);
    } else {
      const span = document.createElement('span');
      span.className   = 'text-muted text-sm';
      span.textContent = '— Protected Administrator';
      actionTd.appendChild(span);
    }
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

function filterUsers() {
  const q = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  if (!q) { renderUsers(allUsers); return; }
  renderUsers(allUsers.filter(u =>
    u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  ));
}

async function deleteUser(id, name, userRole) {
  const roleLabel = userRole === 'teacher'
    ? 'Deleting a teacher account will also remove all their subjects, sessions, and attendance records.'
    : 'All attendance records for this student will also be permanently removed.';

  const confirmed = await confirmDialog(
    'Delete User Account?',
    `Are you sure you want to permanently delete "${name}"? ${roleLabel} This action cannot be undone.`,
    'Delete User',
    true
  );
  if (!confirmed) return;

  const { ok, data } = await api('/api/admin/users/' + id, 'DELETE');
  if (!ok) {
    showMsg(data.message || 'Delete failed');
    showToast(data.message || 'Account deletion failed', 'error');
    return;
  }

  showMsg(`User "${name}" deleted successfully`, true);
  showToast(`Account "${name}" deleted`, 'success');
  await loadStats();
  await loadUsers();
}

// ── Security Audit Logs ────────────────────────────────────────────────────
async function loadAuditLogs() {
  const severity = document.getElementById('auditSeverityFilter')?.value || 'all';
  const event    = document.getElementById('auditEventFilter')?.value || 'all';
  const search   = document.getElementById('auditSearchInput')?.value || '';

  const params = new URLSearchParams({ severity, event, search });
  const { ok, data } = await api(`/api/admin/audit-logs?${params.toString()}`);
  const tbody = document.getElementById('auditRows');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="6" class="hint" style="text-align:center;padding:24px;">Failed to load security audit logs.</td></tr>';
    return;
  }

  const countEl = document.getElementById('auditCount');
  if (countEl) countEl.textContent = `${data.total} Events`;

  if (data.logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px 16px;text-align:center;">
      <div class="empty-state" style="padding:10px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;opacity:0.4;margin-bottom:6px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <div style="font-weight:600;font-size:14px;color:var(--text-main);">No matching security events found</div>
        <div class="hint" style="font-size:12px;">Try selecting a different filter or clearing search keywords.</div>
      </div>
    </td></tr>`;
    return;
  }

  data.logs.forEach(l => {
    const tr = document.createElement('tr');

    // Severity pill
    const sevTd = document.createElement('td');
    const sevPill = document.createElement('span');
    const sevMap = {
      critical: 'pill-danger',
      warning:  'pill-yellow',
      info:     'pill-idle'
    };
    sevPill.className = `pill ${sevMap[l.severity] || 'pill-idle'}`;
    sevPill.textContent = l.severity.toUpperCase();
    sevTd.appendChild(sevPill);
    tr.appendChild(sevTd);

    // Event name
    const evTd = document.createElement('td');
    evTd.className = 'td-primary';
    evTd.textContent = l.event;
    tr.appendChild(evTd);

    // User / Email
    tr.appendChild(cell(l.userEmail || l.userName || 'Guest/Anonymous', 'td-muted'));

    // IP Address
    tr.appendChild(cell(l.ip || '—', 'td-muted'));

    // Details summary
    const detTd = document.createElement('td');
    const msg = l.details?.message || JSON.stringify(l.details);
    detTd.textContent = msg;
    detTd.className = 'text-sm';
    detTd.style.maxWidth = '260px';
    detTd.style.wordBreak = 'break-word';
    tr.appendChild(detTd);

    // Timestamp
    tr.appendChild(cell(new Date(l.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }), 'td-muted'));

    tbody.appendChild(tr);
  });
}

// ── At-Risk Students ───────────────────────────────────────────────────────
async function loadAtRisk() {
  const { ok, data } = await api('/api/admin/at-risk');
  const tbody = document.getElementById('adminAtRiskRows');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="6" class="hint" style="text-align:center;padding:24px;">Failed to load at-risk student records.</td></tr>';
    return;
  }

  const countBadge = document.getElementById('adminAtRiskCount');
  if (countBadge) countBadge.textContent = `${data.atRiskCount} Students`;

  if (data.students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px 16px;text-align:center;">
      <div class="empty-state" style="padding:10px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" style="width:36px;height:36px;margin-bottom:6px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <div style="font-weight:700;font-size:14px;color:var(--success-dark);">Institution-Wide Attendance Healthy</div>
        <div class="hint" style="font-size:12px;">Zero students are currently below the 75% examination threshold.</div>
      </div>
    </td></tr>`;
    return;
  }

  data.students.forEach(s => {
    const tr = document.createElement('tr');

    tr.appendChild(cell(s.studentName, 'td-primary'));
    tr.appendChild(cell(s.studentEmail, 'td-muted'));
    tr.appendChild(cell(s.subjectName));

    // Attendance %
    const pctTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'pill pill-danger';
    pill.textContent = `${s.percentage}% (${s.attended}/${s.total})`;
    pctTd.appendChild(pill);
    tr.appendChild(pctTd);

    // Classes needed
    tr.appendChild(cell(`${s.classesNeeded} consecutive class${s.classesNeeded > 1 ? 'es' : ''}`));

    // Status pill
    const statusTd = document.createElement('td');
    const statusPill = document.createElement('span');
    statusPill.className = s.isCritical ? 'pill pill-danger' : 'pill pill-yellow';
    statusPill.textContent = s.isCritical ? 'Critical (<60%)' : 'At Risk (<75%)';
    statusTd.appendChild(statusPill);
    tr.appendChild(statusTd);

    tbody.appendChild(tr);
  });
}

// ── Global Init ────────────────────────────────────────────────────────────
async function init() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  await loadStats();
  if (currentTab === 'users') await loadUsers();
  else if (currentTab === 'audit') await loadAuditLogs();
  else if (currentTab === 'atRisk') await loadAtRisk();
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Refresh`;
  }
}

init();
