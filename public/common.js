// common.js — Shared utilities, PWA installer, Toast Notifications, & In-App Notification Center
// Loaded before all page-specific scripts.
// User text is always inserted via textContent to prevent XSS.

const token = localStorage.getItem('token');
const role  = localStorage.getItem('role');

/** Redirect to login if token is missing or role doesn't match */
function requireRole(expected) {
  if (!token || role !== expected) {
    localStorage.clear();
    window.location.href = 'index.html';
  }
}

/**
 * Global Toast System
 * Non-intrusive floating feedback toasts
 */
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');

  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="width:18px;height:18px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" style="width:18px;height:18px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" style="width:18px;height:18px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" style="width:18px;height:18px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const iconWrap = document.createElement('span');
  iconWrap.innerHTML = icons[type] || icons.info;

  const msgSpan = document.createElement('span');
  msgSpan.style.flex = '1';
  msgSpan.textContent = message;

  toast.appendChild(iconWrap);
  toast.appendChild(msgSpan);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => { toast.remove(); }, 250);
  }, duration);
}

/**
 * Authenticated fetch wrapper.
 * Returns { ok: boolean, status: number, data: object }.
 * Auto-logouts on 401.
 */
async function api(url, method = 'GET', body) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      logout();
      return { ok: false, data: { message: 'Session expired. Please log in again.' } };
    }

    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      data = { message: 'Unexpected server response format' };
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, data: { message: 'Network error: could not connect to server.' } };
  }
}

/** Clear auth data and redirect to login */
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

/**
 * Geolocation helper — resolves to { lat, lng } or null.
 * Never throws; denial or unavailability returns null silently.
 */
function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

/**
 * Sidebar mobile toggle support.
 */
function initSidebar() {
  const toggle  = document.getElementById('sidebarToggle');
  const sidebar = document.querySelector('.sidebar');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('open');
  });

  document.addEventListener('click', e => {
    if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

/**
 * Populate sidebar user block and topbar user badge.
 */
function initUserInfo() {
  const name = localStorage.getItem('name') || '';
  const initial = name.charAt(0).toUpperCase() || '?';

  ['sidebarName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });

  ['sidebarAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initial;
  });

  const roleEl = document.getElementById('sidebarRole');
  if (roleEl) {
    const roleMap = { teacher: 'Faculty Member', student: 'Student', admin: 'Administrator' };
    roleEl.textContent = roleMap[role] || role;
  }
}

/**
 * Custom confirm modal dialog (replaces native window.confirm).
 */
function confirmDialog(title, message, confirmLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'dialog-box';

    const h3 = document.createElement('h3');
    h3.textContent = title;

    const p = document.createElement('p');
    p.textContent = message;

    const btns = document.createElement('div');
    btns.className = 'dialog-btns';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline btn-sm';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`;
    confirmBtn.textContent = confirmLabel;

    btns.appendChild(cancelBtn);
    btns.appendChild(confirmBtn);
    box.appendChild(h3);
    box.appendChild(p);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    confirmBtn.focus();

    const cleanup = ok => {
      overlay.remove();
      resolve(ok);
    };

    cancelBtn.onclick  = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(false); });
  });
}

/**
 * Relative time formatter (e.g., "5m ago", "2h ago", "Yesterday")
 */
function timeAgo(dateInput) {
  const date = new Date(dateInput);
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-APP NOTIFICATION CENTER
// ─────────────────────────────────────────────────────────────────────────────
let notifDropdownOpen = false;

async function fetchNotifications() {
  if (!token) return;
  const { ok, data } = await api('/api/notifications');
  if (!ok) return;

  const countEl = document.getElementById('notifBadge');
  const listEl  = document.getElementById('notifList');
  if (!countEl || !listEl) return;

  // Red badge: MUST disappear when unreadCount is 0
  if (data.unreadCount && data.unreadCount > 0) {
    countEl.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
    countEl.classList.remove('hidden');
    countEl.style.display = 'inline-block';
  } else {
    countEl.classList.add('hidden');
    countEl.style.display = 'none';
  }

  listEl.innerHTML = '';
  if (!data.notifications || data.notifications.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:28px 16px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;opacity:0.4;margin-bottom:6px"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
      <div style="font-size:13px;font-weight:600;color:var(--text-main);">No notifications yet</div>
      <div style="font-size:11.5px;color:var(--text-muted);">You will receive updates here for attendance and alerts.</div>
    </div>`;
    return;
  }

  const iconByType = {
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" style="width:16px;height:16px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    security: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="width:16px;height:16px"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  data.notifications.forEach(n => {
    const item = document.createElement('div');
    item.className = 'notif-item ' + (n.read ? 'read' : 'unread');

    const iconDiv = document.createElement('div');
    iconDiv.className = 'notif-icon notif-' + (n.type || 'info');
    iconDiv.innerHTML = iconByType[n.type] || iconByType.info;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'notif-content';
    contentDiv.style.flex = '1';

    const titleRow = document.createElement('div');
    titleRow.className = 'notif-title-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'notif-title';
    titleSpan.textContent = n.title;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'notif-time';
    timeSpan.textContent = timeAgo(n.createdAt);

    titleRow.appendChild(titleSpan);
    titleRow.appendChild(timeSpan);

    const msgP = document.createElement('p');
    msgP.className = 'notif-msg';
    msgP.textContent = n.message;

    contentDiv.appendChild(titleRow);
    contentDiv.appendChild(msgP);

    item.appendChild(iconDiv);
    item.appendChild(contentDiv);

    item.onclick = async () => {
      if (!n.read) {
        await api(`/api/notifications/${n.id}/read`, 'PATCH');
        item.classList.remove('unread');
        item.classList.add('read');
        fetchNotifications();
      }
      notifDropdownOpen = false;
      document.getElementById('notifDropdown')?.classList.add('hidden');
      if (n.link) {
        window.location.href = n.link;
      }
    };

    listEl.appendChild(item);
  });
}

function initNotifications() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  let rightGroup = topbar.querySelector('.topbar-right');
  if (!rightGroup) {
    rightGroup = document.createElement('div');
    rightGroup.className = 'topbar-right';
    topbar.appendChild(rightGroup);
  }

  // Check if bell already exists
  if (document.getElementById('notifBellBtn')) return;

  const notifWrapper = document.createElement('div');
  notifWrapper.className = 'notif-wrapper';
  notifWrapper.innerHTML = `
    <button class="notif-bell-btn" id="notifBellBtn" aria-label="Notifications" title="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
      <span class="notif-badge hidden" id="notifBadge">0</span>
    </button>
    <div class="notif-dropdown hidden" id="notifDropdown">
      <div class="notif-header">
        <div class="notif-header-title">Notifications</div>
        <button class="notif-action-btn" id="notifMarkAllBtn">Mark all as read</button>
      </div>
      <div class="notif-list" id="notifList">
        <div style="padding:28px 16px;text-align:center;color:var(--text-muted);font-size:13px;">Loading notifications…</div>
      </div>
    </div>`;

  rightGroup.prepend(notifWrapper);

  const bellBtn  = document.getElementById('notifBellBtn');
  const dropdown = document.getElementById('notifDropdown');
  const markAll  = document.getElementById('notifMarkAllBtn');

  bellBtn.onclick = e => {
    e.stopPropagation();
    notifDropdownOpen = !notifDropdownOpen;
    dropdown.classList.toggle('hidden', !notifDropdownOpen);
    if (notifDropdownOpen) fetchNotifications();
  };

  markAll.onclick = async e => {
    e.stopPropagation();
    const origText = markAll.textContent;
    markAll.disabled = true;
    markAll.textContent = 'Updating…';
    await api('/api/notifications/mark-all-read', 'POST');
    await fetchNotifications();
    markAll.disabled = false;
    markAll.textContent = origText;
    showToast('All notifications marked as read', 'success');
  };

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (notifDropdownOpen && !notifWrapper.contains(e.target)) {
      notifDropdownOpen = false;
      dropdown.classList.add('hidden');
    }
  });

  // Close on Escape key press
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && notifDropdownOpen) {
      notifDropdownOpen = false;
      dropdown.classList.add('hidden');
    }
  });

  fetchNotifications();
  setInterval(fetchNotifications, 45000);
}

// ─────────────────────────────────────────────────────────────────────────────
// PWA INSTALLATION & SERVICE WORKER
// ─────────────────────────────────────────────────────────────────────────────
let deferredPrompt = null;

function initPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration skipped:', err.message);
    });
  }

  // Only show install button if beforeinstallprompt actually fired and prompt is usable
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showPwaInstallPrompt();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.remove();
    showToast('ProxyGuard app installed successfully!', 'success');
  });
}

function showPwaInstallPrompt() {
  if (!deferredPrompt || document.getElementById('pwaInstallBtn')) return;

  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return;

  const installBtn = document.createElement('button');
  installBtn.id = 'pwaInstallBtn';
  installBtn.className = 'btn btn-outline btn-sm pwa-install-btn';
  installBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    <span>Install App</span>`;

  installBtn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.remove();
    }
    deferredPrompt = null;
  };

  topbarRight.appendChild(installBtn);
}

// Auto-run common dashboard helpers
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    initNotifications();
    initPwa();
  }
});