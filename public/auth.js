// auth.js — login/register page logic
// User text is always inserted via textContent to prevent XSS.

const msg = document.getElementById('msg');

function setMsg(text, ok) {
  if (!msg) return;
  msg.textContent = text || '';
  msg.className = text ? (ok ? 'msg-ok' : 'msg-err') : '';
}

function showTab(tab) {
  const isLogin = tab === 'login';
  const loginBox = document.getElementById('loginBox');
  const registerBox = document.getElementById('registerBox');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const formTitle = document.getElementById('authFormTitle');
  const formDesc = document.getElementById('authFormDesc');

  if (loginBox) loginBox.classList.toggle('hidden', !isLogin);
  if (registerBox) registerBox.classList.toggle('hidden', isLogin);
  if (tabLogin) {
    tabLogin.classList.toggle('active', isLogin);
    tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  }
  if (tabRegister) {
    tabRegister.classList.toggle('active', !isLogin);
    tabRegister.setAttribute('aria-selected', isLogin ? 'false' : 'true');
  }

  if (formTitle) {
    formTitle.textContent = isLogin ? 'Sign in to your portal' : 'Create an account';
  }
  if (formDesc) {
    formDesc.textContent = isLogin
      ? 'Enter your institutional credentials to access your dashboard'
      : 'Register as a student or teacher to begin tracking attendance';
  }

  setMsg('');
}

// Toggle password visibility with eye icon
function togglePasswordVisibility(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  const eyeOpen = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');
  if (eyeOpen && eyeClosed) {
    eyeOpen.classList.toggle('hidden', isPassword);
    eyeClosed.classList.toggle('hidden', !isPassword);
  }
  btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
}

// Legacy toggle() kept for compatibility
function toggle() {
  const isHidden = document.getElementById('registerBox')?.classList.contains('hidden');
  showTab(isHidden ? 'register' : 'login');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = '';

  if (loading) {
    const spinner = document.createElement('span');
    spinner.className = 'btn-spinner';
    btn.appendChild(spinner);
    const label = document.createTextNode(' Please wait…');
    btn.appendChild(label);
  } else {
    btn.textContent = btnId === 'loginBtn' ? 'Sign In' : 'Create Account';
  }
}

async function login() {
  const emailInput = document.getElementById('loginEmail');
  const pwdInput = document.getElementById('loginPassword');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = pwdInput ? pwdInput.value : '';

  if (!email || !password) {
    setMsg('Please enter both your email and password.');
    return;
  }

  setLoading('loginBtn', true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      setMsg(data.message || 'Login failed. Please check your credentials.');
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('role',  data.role);
    localStorage.setItem('name',  data.name);

    if (data.role === 'admin')        window.location.href = 'admin.html';
    else if (data.role === 'teacher') window.location.href = 'teacher.html';
    else                              window.location.href = 'student.html';
  } catch (err) {
    setMsg('Network error. Unable to reach server. Please check your connection.');
  } finally {
    setLoading('loginBtn', false);
  }
}

async function register() {
  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const pwdInput = document.getElementById('regPassword');
  const roleSelect = document.getElementById('regRole');

  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = pwdInput ? pwdInput.value : '';
  const role = roleSelect ? roleSelect.value : 'student';

  if (!name) { setMsg('Please enter your full name.'); return; }
  if (!email) { setMsg('Please enter your institutional email address.'); return; }
  if (!password || password.length < 6) {
    setMsg('Password must be at least 6 characters long.');
    return;
  }

  setLoading('registerBtn', true);
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();

    if (!res.ok) {
      setMsg(data.message || 'Registration failed.');
      return;
    }

    showTab('login');
    setMsg('Account created successfully! Please sign in.', true);
  } catch (err) {
    setMsg('Network error. Unable to reach server. Please try again.');
  } finally {
    setLoading('registerBtn', false);
  }
}

// Allow Enter key to submit forms
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const loginBox = document.getElementById('loginBox');
  const isLogin = loginBox && !loginBox.classList.contains('hidden');
  if (isLogin) login();
  else register();
});

// Redirect if already logged in
(function () {
  const token = localStorage.getItem('token');
  const role  = localStorage.getItem('role');
  if (!token || !role) return;
  if (role === 'admin')        window.location.href = 'admin.html';
  else if (role === 'teacher') window.location.href = 'teacher.html';
  else                         window.location.href = 'student.html';
})();

// Register Service Worker for offline PWA capabilities on landing page
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration skipped:', err.message);
    });
  });
}