// ── Auth utilities shared across all pages ────────────────────────────────────

async function apiFetch(url, options = {}) {
  try {
    const res  = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
      ...options,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Network error. Is the server running?' } };
  }
}

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const icons = { error: '✕', success: '✓', info: 'ℹ', warn: '⚠' };
  el.innerHTML = `<div class="alert alert-${type}"><span>${icons[type] || ''}</span> ${message}</div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

function setLoading(btn, loading, loadingText) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${loadingText || 'Loading...'}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.original || btn.innerHTML;
  }
}

function setupPasswordToggle(inputId, toggleId) {
  const input  = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;
  toggle.addEventListener('click', () => {
    const isText = input.type === 'text';
    input.type   = isText ? 'password' : 'text';
    toggle.textContent = isText ? 'Show' : 'Hide';
  });
}

function checkStrength(password) {
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

function setupStrengthMeter(inputId, meterId) {
  const input = document.getElementById(inputId);
  const meter = document.getElementById(meterId);
  if (!input || !meter) return;

  const fill  = meter.querySelector('.strength-fill');
  const label = document.getElementById('strengthLabel') || meter.nextElementSibling;

  const levels = [
    { cls: '',                label: '',       width: '0%'   },
    { cls: 'strength-weak',  label: 'Weak',   width: '20%'  },
    { cls: 'strength-weak',  label: 'Weak',   width: '35%'  },
    { cls: 'strength-fair',  label: 'Fair',   width: '55%'  },
    { cls: 'strength-good',  label: 'Good',   width: '75%'  },
    { cls: 'strength-strong',label: 'Strong', width: '100%' },
  ];

  input.addEventListener('input', () => {
    const score = checkStrength(input.value);
    const level = levels[Math.min(score, levels.length - 1)];
    meter.className = 'strength-bar ' + level.cls;
    if (fill) fill.style.width = level.width;
    if (label) label.textContent = input.value ? level.label : '';
  });
}

async function requireAuth(redirectTo = '/login') {
  const { ok, data } = await apiFetch('/api/me');
  if (!ok) { window.location.href = redirectTo; return null; }
  return data;
}

async function requireGuest(redirectTo = '/dashboard') {
  const { ok } = await apiFetch('/api/me');
  if (ok) window.location.href = redirectTo;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncateJwt(token) {
  if (!token || token.length < 20) return token;
  return token.slice(0, 20) + '...' + token.slice(-10);
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
  } catch { return null; }
}

function renderJwtInspector(containerId, token) {
  const el = document.getElementById(containerId);
  if (!el || !token) return;
  const parts = token.split('.');
  if (parts.length !== 3) { el.textContent = 'Invalid token'; return; }
  el.innerHTML =
    `<span class="token-part-header">${parts[0]}</span>` +
    `<span class="token-dot">.</span>` +
    `<span class="token-part-payload">${parts[1]}</span>` +
    `<span class="token-dot">.</span>` +
    `<span class="token-part-sig">${parts[2]}</span>`;
}