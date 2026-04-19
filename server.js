'use strict';
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT = 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');

/* ── Super-admin (config.json — never served) ────────────────────── */
let _super = { adminUser: '', adminPass: '' };
try {
  _super = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  console.log('✓  config.json chargé');
} catch {
  console.warn('⚠  config.json introuvable — super-admin désactivé');
}

/* ── Sessions (in-memory, lost on server restart) ────────────────── */
const _sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 h

function genToken() { return crypto.randomBytes(32).toString('hex'); }

function createSession(login, permissions) {
  const token = genToken();
  _sessions.set(token, { login, permissions, expires: Date.now() + SESSION_TTL });
  return token;
}

function getSession(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const s = _sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { _sessions.delete(token); return null; }
  return s;
}

/* ── Password hashing (scrypt) ───────────────────────────────────── */
function hashPw(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPw(password, storedHash, salt) {
  try {
    const { hash } = hashPw(password, salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch { return false; }
}

/* ── Accounts helpers ────────────────────────────────────────────── */
const ACCOUNTS_FILE = path.join(DATA, 'accounts.json');
const ALL_PERMS = ['evenements', 'jeux', 'equipe', 'blog', 'site'];

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch { return []; }
}

function saveAccounts(arr) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

/* ── Body reader ─────────────────────────────────────────────────── */
function readBody(req, limit = 10240) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) reject(Object.assign(new Error('Too large'), { code: 'TOO_LARGE' }));
    });
    req.on('end',   () => resolve(body));
    req.on('error', reject);
  });
}

/* ── MIME types ──────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

/* ── Request handler ─────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  try {
    const u        = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(u.pathname);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── Block sensitive files ──────────────────────────────────────
    const BLOCKED = ['config.json', 'config.sample.json', '.gitignore', '.env', 'accounts.json'];
    if (BLOCKED.includes(path.basename(pathname))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // ── POST /auth/login ───────────────────────────────────────────
    if (pathname === '/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const { user, pass } = JSON.parse(body);
      if (typeof user !== 'string' || typeof pass !== 'string') throw new SyntaxError();

      // Super-admin check
      if (user === _super.adminUser && _super.adminUser && pass === _super.adminPass) {
        const token = createSession(user, ALL_PERMS);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, permissions: ALL_PERMS, fullName: 'Super Admin', isSuperAdmin: true }));
        return;
      }

      // Regular account check
      const account = loadAccounts().find(a => a.login === user);
      if (account && verifyPw(pass, account.passwordHash, account.salt)) {
        const token = createSession(user, account.permissions);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, permissions: account.permissions, fullName: account.fullName, isSuperAdmin: false }));
        return;
      }

      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    // ── GET /api/accounts ──────────────────────────────────────────
    if (pathname === '/api/accounts' && req.method === 'GET') {
      const session = getSession(req);
      if (!session || !session.permissions.includes('site')) { res.writeHead(403); res.end('Forbidden'); return; }
      const accounts = loadAccounts().map(a => ({ id: a.id, login: a.login, fullName: a.fullName, permissions: a.permissions }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(accounts));
      return;
    }

    // ── POST /api/accounts (create / update) ───────────────────────
    if (pathname === '/api/accounts' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !session.permissions.includes('site')) { res.writeHead(403); res.end('Forbidden'); return; }

      const data     = JSON.parse(await readBody(req));
      const accounts = loadAccounts();

      if (data.id) {
        // Update
        const idx = accounts.findIndex(a => a.id === data.id);
        if (idx === -1) { res.writeHead(404); res.end('Not found'); return; }
        accounts[idx].fullName    = data.fullName    || accounts[idx].fullName;
        accounts[idx].permissions = Array.isArray(data.permissions) ? data.permissions : accounts[idx].permissions;
        if (data.password) {
          const { hash, salt } = hashPw(data.password);
          accounts[idx].passwordHash = hash;
          accounts[idx].salt         = salt;
        }
      } else {
        // Create
        if (!data.login || !data.password) { res.writeHead(400); res.end('Missing fields'); return; }
        if (accounts.find(a => a.login === data.login)) { res.writeHead(409); res.end(JSON.stringify({ error: 'login_exists' })); return; }
        const { hash, salt } = hashPw(data.password);
        accounts.push({
          id:           'acc_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
          login:        data.login,
          passwordHash: hash,
          salt,
          fullName:     data.fullName || '',
          permissions:  Array.isArray(data.permissions) ? data.permissions : [],
        });
      }

      saveAccounts(accounts);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    // ── DELETE /api/accounts/:id ───────────────────────────────────
    const delMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
    if (delMatch && req.method === 'DELETE') {
      const session = getSession(req);
      if (!session || !session.permissions.includes('site')) { res.writeHead(403); res.end('Forbidden'); return; }
      saveAccounts(loadAccounts().filter(a => a.id !== delMatch[1]));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    // ── Data API : GET|POST /data/<name>.json ──────────────────────
    if (/^\/data\/[\w-]+\.json$/.test(pathname)) {
      const file = path.join(DATA, path.basename(pathname));

      if (req.method === 'GET') {
        try {
          const data = await fs.promises.readFile(file, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(data);
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('[]');
        }
        return;
      }

      if (req.method === 'POST') {
        const body = await readBody(req, 10e6);
        JSON.parse(body); // validate JSON
        await fs.promises.writeFile(file, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }

      res.writeHead(405); res.end(); return;
    }

    // ── Static files ───────────────────────────────────────────────
    let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
      const data = await fs.promises.readFile(filePath);
      const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not found');
    }

  } catch (err) {
    if (!res.headersSent) {
      if (err.code === 'TOO_LARGE') { res.writeHead(413); res.end('Too large'); }
      else { res.writeHead(400); res.end('Bad request'); }
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓  Ried & Rôle  →  http://localhost:${PORT}`);
  console.log('   Ctrl+C pour arrêter');
});
