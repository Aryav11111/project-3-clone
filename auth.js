const crypto = require('node:crypto');

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');

module.exports = function installAuth(app, pool) {
  const origin = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const secure = new URL(origin).protocol === 'https:';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const allowed = () => (process.env.MANAGER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && allowed().length);
  const cookie = (req, name) => (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1);
  const callback = `${origin}/auth/google/callback`;
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS manager_accounts (
      google_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      last_login TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Keep Google login separate from the existing sid/sess/expire session store.
    CREATE TABLE IF NOT EXISTS manager_google_sessions (
      token_hash TEXT PRIMARY KEY,
      google_id TEXT NOT NULL REFERENCES manager_accounts(google_id),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manager_oauth_states (
      state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
    );
    -- CREATE TABLE IF NOT EXISTS does not upgrade older tables.
    -- Treat records with no known expiry as expired rather than extending access.
    ALTER TABLE manager_google_sessions
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity';
    ALTER TABLE manager_oauth_states
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity';
  `);
  // Handle initialization failures without an unhandled rejection; routes fail closed.
  ready.catch((err) => console.error('Authentication database initialization failed:', err.message));
  const wrap = (fn) => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await ready; await fn(req, res, next); }
    catch (err) {
      console.error('Authentication request failed:', err.message);
      res.status(503).json({ error: 'Authentication is unavailable. Please try again later.' });
    }
  };
  async function currentUser(req) {
    const token = cookie(req, 'manager_session');
    if (!token) return null;
    const { rows } = await pool.query(`SELECT a.google_id AS id, a.email, a.name
      FROM manager_google_sessions s JOIN manager_accounts a USING (google_id)
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [hash(token)]);
    return rows[0] && allowed().includes(rows[0].email.toLowerCase()) ? rows[0] : null;
  }
  app.get('/api/auth/me', wrap(async (req, res) => {
    res.json({ user: await currentUser(req), configured: configured() });
  }));
  app.get('/auth/google', wrap(async (req, res) => {
    if (!configured()) return res.redirect('/manager.html?auth_error=configuration');
    const state = random();
    const verifier = random();
    await pool.query('DELETE FROM manager_oauth_states WHERE expires_at <= NOW()');
    await pool.query("INSERT INTO manager_oauth_states (state_hash, verifier, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')", [hash(state), verifier]);
    res.cookie('manager_oauth', state, { ...cookieOptions, maxAge: 600000 });
    const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callback, response_type: 'code', scope: 'openid email profile', state,
      code_challenge: hashBase64(verifier), code_challenge_method: 'S256', prompt: 'select_account' });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));
  app.get('/auth/google/callback', wrap(async (req, res) => {
    const state = cookie(req, 'manager_oauth');
    res.clearCookie('manager_oauth', cookieOptions);
    const failure = (reason) => res.redirect(`/manager.html?auth_error=${reason}`);
    if (!configured() || !state || typeof req.query.state !== 'string' || req.query.state !== state) return failure('invalid');
    const { rows } = await pool.query('DELETE FROM manager_oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING verifier', [hash(state)]);
    if (!rows.length) return failure('invalid');
    if (req.query.error || typeof req.query.code !== 'string') return failure('cancelled');
    let stage = 'token exchange';
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: callback,
          grant_type: 'authorization_code', code_verifier: rows[0].verifier }),
      });
      const tokens = await response.json();
      if (!response.ok || !tokens.access_token) {
        const knownErrors = ['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope'];
        const code = knownErrors.includes(tokens.error) ? tokens.error : 'unexpected_response';
        console.error(`Google login failed: token exchange; HTTP ${response.status}; ${code}`);
        return failure('failed');
      }
      stage = 'profile lookup';
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
        console.error(`Google login failed: profile lookup; HTTP ${profileResponse.status}; verified identity unavailable`);
        return failure('failed');
      }
      if (!allowed().includes(profile.email.toLowerCase())) return failure('denied');
      stage = 'saving account';
      await pool.query(`INSERT INTO manager_accounts (google_id, email, name) VALUES ($1, $2, $3)
        ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login = NOW()`,
      [profile.sub, profile.email, profile.name || profile.email]);
      stage = 'saving session';
      await pool.query('DELETE FROM manager_google_sessions WHERE expires_at <= NOW() OR token_hash = $1', [hash(cookie(req, 'manager_session') || '')]);
      const token = random();
      await pool.query("INSERT INTO manager_google_sessions (token_hash, google_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [hash(token), profile.sub]);
      res.cookie('manager_session', token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 });
      res.redirect('/manager.html');
    } catch (err) {
      // Report only stage and standardized codes, never tokens, profiles, or credentials.
      const code = typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code) ? err.code : 'request_failed';
      console.error(`Google login failed: ${stage}; ${code}`);
      failure('failed');
    }
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    if (req.get('origin') !== origin) return res.status(403).json({ error: 'Invalid request origin.' });
    const token = cookie(req, 'manager_session');
    if (token) await pool.query('DELETE FROM manager_google_sessions WHERE token_hash = $1', [hash(token)]);
    res.clearCookie('manager_session', cookieOptions);
    res.json({ ok: true });
  }));
  app.use('/api/manage', wrap(async (req, res, next) => {
    if (!await currentUser(req)) return res.status(401).json({ error: 'Please sign in with an authorized manager account.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Invalid request origin.' });
    next();
  }));
};

function hashBase64(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}
