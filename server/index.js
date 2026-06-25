const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path         = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET        = process.env.JWT_SECRET || 'superSecretKey_change_in_production_2024';
const JWT_EXPIRES_IN    = '7d';
const COOKIE_MAX_AGE    = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const BCRYPT_ROUNDS     = 12;
const PORT              = process.env.PORT || 3000;

// ── In-memory stores (replace with a real DB in production) ───────────────────
const users       = new Map(); // email -> user object
const resetTokens = new Map(); // token -> { email, expiresAt }
const sessions    = new Map(); // jti -> { userId, createdAt, userAgent }

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
function createToken(user, req) {
  const jti = uuidv4();
  sessions.set(jti, {
    userId:    user.id,
    createdAt: new Date().toISOString(),
    userAgent: req.headers['user-agent'] || 'Unknown',
    ip:        req.ip || '127.0.0.1',
  });
  return jwt.sign(
    { sub: user.id, email: user.email, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Check session is still active
    if (!sessions.has(decoded.jti)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Auth middleware — protects API routes
function requireAuth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  req.user = users.get(decoded.email);
  req.jti  = decoded.jti;
  next();
}

function sanitize(str) {
  return String(str || '').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(pw) {
  return pw.length >= 8;
}

// ── HTML page helper ──────────────────────────────────────────────────────────
function sendPage(res, page) {
  res.sendFile(path.join(__dirname, `../public/pages/${page}.html`));
}

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/',          (req, res) => sendPage(res, 'login'));
app.get('/login',     (req, res) => sendPage(res, 'login'));
app.get('/register',  (req, res) => sendPage(res, 'register'));
app.get('/forgot',    (req, res) => sendPage(res, 'forgot'));
app.get('/reset',     (req, res) => sendPage(res, 'reset'));
app.get('/dashboard', (req, res) => sendPage(res, 'dashboard'));
app.get('/profile',   (req, res) => sendPage(res, 'profile'));

// ── API: Register ─────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const name     = sanitize(req.body.name);
    const email    = sanitize(req.body.email).toLowerCase();
    const password = sanitize(req.body.password);
    const role     = 'user';

    if (!name || name.length < 2)
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    if (!isValidEmail(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!isStrongPassword(password))
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (users.has(email))
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = {
      id:        uuidv4(),
      name,
      email,
      password:  hash,
      role,
      avatar:    name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
      createdAt: new Date().toISOString(),
      lastLogin: null,
    };
    users.set(email, user);

    const token = createToken(user, req);
    res.cookie('token', token, { httpOnly: true, maxAge: COOKIE_MAX_AGE, sameSite: 'lax' });
    res.status(201).json({ message: 'Account created successfully.', redirect: '/dashboard' });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── API: Login ────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const email    = sanitize(req.body.email).toLowerCase();
    const password = sanitize(req.body.password);

    if (!isValidEmail(email))
      return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!password)
      return res.status(400).json({ error: 'Password is required.' });

    const user = users.get(email);
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Incorrect password. Please try again.' });

    user.lastLogin = new Date().toISOString();
    const token = createToken(user, req);
    res.cookie('token', token, { httpOnly: true, maxAge: COOKIE_MAX_AGE, sameSite: 'lax' });
    res.json({ message: 'Login successful.', redirect: '/dashboard' });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── API: Logout ───────────────────────────────────────────────────────────────
app.post('/api/logout', requireAuth, (req, res) => {
  sessions.delete(req.jti);
  res.clearCookie('token');
  res.json({ message: 'Logged out.', redirect: '/login' });
});

// ── API: Forgot Password ──────────────────────────────────────────────────────
app.post('/api/forgot-password', (req, res) => {
  const email = sanitize(req.body.email).toLowerCase();
  if (!isValidEmail(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });

  const user = users.get(email);
  // Always respond the same to prevent user enumeration
  if (!user) {
    return res.json({ message: 'If that email exists, a reset link has been sent.' });
  }

  const token     = uuidv4();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
  resetTokens.set(token, { email, expiresAt });

  // In production this would send an email. We return the token for demo purposes.
  console.log(`[RESET LINK] http://localhost:${PORT}/reset?token=${token}`);
  res.json({
    message:    'Reset link generated. Check the server console for the link (demo mode).',
    resetToken: token,   // Only for demo — never expose this in production
    resetUrl:   `http://localhost:${PORT}/reset?token=${token}`,
  });
});

// ── API: Reset Password ───────────────────────────────────────────────────────
app.post('/api/reset-password', async (req, res) => {
  try {
    const token    = sanitize(req.body.token);
    const password = sanitize(req.body.password);
    const confirm  = sanitize(req.body.confirm);

    if (!token)  return res.status(400).json({ error: 'Reset token is missing.' });
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
    if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const entry = resetTokens.get(token);
    if (!entry || Date.now() > entry.expiresAt)
      return res.status(400).json({ error: 'Reset link has expired or is invalid.' });

    const user = users.get(entry.email);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    resetTokens.delete(token);

    // Invalidate all existing sessions for this user
    for (const [jti, session] of sessions.entries()) {
      if (session.userId === user.id) sessions.delete(jti);
    }

    res.json({ message: 'Password reset successfully. You may now log in.', redirect: '/login' });
  } catch (err) {
    console.error('[reset]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── API: Get current user (protected) ─────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const { password: _, ...safeUser } = req.user;

  // Attach active session info
  const sessionInfo = sessions.get(req.jti);
  const allSessions = [...sessions.entries()]
    .filter(([, s]) => s.userId === req.user.id)
    .map(([jti, s]) => ({ jti, ...s, current: jti === req.jti }));

  res.json({ user: safeUser, sessions: allSessions });
});

// ── API: Update profile (protected) ──────────────────────────────────────────
app.put('/api/profile', requireAuth, async (req, res) => {
  try {
    const name    = sanitize(req.body.name);
    const bio     = sanitize(req.body.bio).slice(0, 200);
    const company = sanitize(req.body.company).slice(0, 80);
    const website = sanitize(req.body.website).slice(0, 100);

    if (!name || name.length < 2)
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });

    req.user.name    = name;
    req.user.bio     = bio;
    req.user.company = company;
    req.user.website = website;
    req.user.avatar  = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

    const { password: _, ...safeUser } = req.user;
    res.json({ message: 'Profile updated.', user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── API: Change password (protected) ─────────────────────────────────────────
app.put('/api/change-password', requireAuth, async (req, res) => {
  try {
    const current = sanitize(req.body.current);
    const next    = sanitize(req.body.next);
    const confirm = sanitize(req.body.confirm);

    if (!current || !next || !confirm)
      return res.status(400).json({ error: 'All fields are required.' });
    if (next !== confirm)
      return res.status(400).json({ error: 'New passwords do not match.' });
    if (!isStrongPassword(next))
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const match = await bcrypt.compare(current, req.user.password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    req.user.password = await bcrypt.hash(next, BCRYPT_ROUNDS);

    // Revoke other sessions, keep current
    for (const [jti, session] of sessions.entries()) {
      if (session.userId === req.user.id && jti !== req.jti) sessions.delete(jti);
    }

    res.json({ message: 'Password changed. Other sessions have been revoked.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── API: Revoke a specific session ────────────────────────────────────────────
app.delete('/api/sessions/:jti', requireAuth, (req, res) => {
  const jti = req.params.jti;
  const session = sessions.get(jti);
  if (!session || session.userId !== req.user.id)
    return res.status(403).json({ error: 'Not authorized.' });
  sessions.delete(jti);
  res.json({ message: 'Session revoked.' });
});

// ── API: Admin — list all users (protected, role check) ──────────────────────
app.get('/api/admin/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });
  const list = [...users.values()].map(({ password: _, ...u }) => u);
  res.json({ users: list });
});

// ── Seed a demo admin account ─────────────────────────────────────────────────
(async () => {
  const hash = await bcrypt.hash('Admin@1234', BCRYPT_ROUNDS);
  users.set('admin@demo.com', {
    id:        uuidv4(),
    name:      'Admin User',
    email:     'admin@demo.com',
    password:  hash,
    role:      'admin',
    avatar:    'AU',
    createdAt: new Date().toISOString(),
    lastLogin: null,
    bio:       'Platform administrator.',
    company:   'Demo Corp',
    website:   'https://demo.com',
  });
  console.log('\n  Demo credentials seeded:');
  console.log('  Email:    admin@demo.com');
  console.log('  Password: Admin@1234\n');
})();

app.listen(PORT, () => {
  console.log(`  Auth System running at http://localhost:${PORT}`);
});