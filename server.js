'use strict';
const http       = require('http');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

/* ── Ensure data directory exists ────────────────────────────────── */
fs.mkdirSync(DATA, { recursive: true });

/* ── config.json → super-admin + SMTP ───────────────────────────── */
let _super = { adminUser: '', adminPass: '' };
let _cfg   = {};
try {
  _cfg   = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  _super = _cfg;
  console.log('✓  config.json chargé');
} catch {
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    _super = { adminUser: process.env.ADMIN_USER, adminPass: process.env.ADMIN_PASS };
    console.log('✓  Credentials chargés depuis les variables d\'environnement');
  } else {
    console.warn('⚠  Aucun credential configuré — super-admin désactivé');
  }
}

/* Les env vars restent prioritaires sur config.json */
function smtpHost()   { return process.env.SMTP_HOST   || _cfg.smtpHost   || ''; }
function smtpPort()   { return parseInt(process.env.SMTP_PORT   || _cfg.smtpPort   || '587', 10); }
function smtpSecure() { return (process.env.SMTP_SECURE || String(_cfg.smtpSecure || 'false')) === 'true'; }
function smtpUser()   { return process.env.SMTP_USER   || _cfg.smtpUser   || ''; }
function smtpPass()   { return process.env.SMTP_PASS   || _cfg.smtpPass   || ''; }
function smtpFrom()   { return process.env.SMTP_FROM   || _cfg.smtpFrom   || (smtpUser() ? `"Ried & Rôle" <${smtpUser()}>` : '"Ried & Rôle" <ried.and.role@gmail.com>'); }
function sgKey()           { return process.env.SENDGRID_API_KEY  || _cfg.sendgridApiKey  || ''; }
function discordBotToken() { return process.env.DISCORD_BOT_TOKEN || _cfg.discordBotToken || ''; }
function discordGuildId()  { return process.env.DISCORD_GUILD_ID  || _cfg.discordGuildId  || ''; }

function isEmailConfigured()   { return !!(sgKey() || (nodemailer && smtpHost())); }
function isDiscordConfigured() { return !!(discordBotToken() && discordGuildId()); }

function botWebhookUrl()    { return process.env.BOT_WEBHOOK_URL    || _cfg.botWebhookUrl    || ''; }
function botWebhookSecret() { return process.env.BOT_WEBHOOK_SECRET || _cfg.botWebhookSecret || ''; }
function isBotConfigured()  { return !!(botWebhookUrl() && botWebhookSecret()); }

async function callBot(endpoint, data) {
  const url     = new URL(endpoint, botWebhookUrl());
  const payload = JSON.stringify(data);
  const mod     = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'x-bot-secret':   botWebhookSecret(),
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function _parsedFrom() {
  const raw = smtpFrom();
  const m   = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { email: raw.trim() };
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (sgKey()) {
    const from = _parsedFrom();
    if (!from.email) throw new Error('Adresse expéditeur manquante (SMTP_FROM non configuré)');
    console.log(`[email] SendGrid → ${to} | from: ${from.email} | sujet: ${subject.slice(0, 60)}`);
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [{ type: 'text/html', value: html }],
      ...(replyTo ? { reply_to: { email: replyTo } } : {})
    });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.sendgrid.com',
        path:     '/v3/mail/send',
        method:   'POST',
        headers:  {
          'Authorization':  `Bearer ${sgKey()}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`SendGrid ${res.statusCode}: ${d}`));
          } else {
            console.log(`[email] SendGrid OK (${res.statusCode}) → ${to}`);
            resolve();
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  if (nodemailer && smtpHost()) {
    const t = nodemailer.createTransport({
      host: smtpHost(), port: smtpPort(), secure: smtpSecure(),
      auth: { user: smtpUser(), pass: smtpPass() }
    });
    return t.sendMail({ from: smtpFrom(), to, subject, html, ...(replyTo ? { replyTo } : {}) });
  }

  throw new Error('Aucun service email configuré');
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

/* ── Event date helpers ──────────────────────────────────────────── */
const FR_MON = { Jan:0,'Fév':1,Mar:2,Avr:3,Mai:4,Jun:5,Jul:6,'Aoû':7,Sep:8,Oct:9,Nov:10,'Déc':11 };

function parseEventMs(e) {
  const day = parseInt(e.startDay || e.day,   10);
  const mon = FR_MON[e.startMonth || e.month];
  const yr  = parseInt(e.startYear  || e.year, 10);
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  let h = 0, m = 0;
  const t = (e.startTimeFrom || '').match(/^(\d{1,2})h(\d{2})$/);
  if (t) { h = +t[1]; m = +t[2]; }
  return new Date(yr, mon, day, h, m, 0, 0).getTime();
}

function fmtHours(h) {
  if (h >= 48) return `${Math.round(h / 24)} jours`;
  if (h >= 2)  return `${h} heures`;
  return 'moins d\'une heure';
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

    // ── POST /api/analytics ───────────────────────────────────────
    if (pathname === '/api/analytics' && req.method === 'POST') {
      try {
        const raw  = await readBody(req, 2048);
        const body = JSON.parse(raw);
        const type  = String(body.type  || '').slice(0, 20);
        const page  = String(body.page  || '').slice(0, 30);
        const label = String(body.label || '').slice(0, 60);
        if (!type || !page) { res.writeHead(400); res.end(); return; }

        const today  = new Date().toISOString().slice(0, 10);
        const rawIp  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const ipHash = crypto.createHash('sha256').update(rawIp + today).digest('hex').slice(0, 16);

        const aFile = path.join(DATA, 'analytics.json');
        let aData = {};
        try { aData = JSON.parse(fs.readFileSync(aFile, 'utf8')); } catch {}

        if (!aData[today]) aData[today] = { v: [], p: {}, c: {} };
        const day = aData[today];

        if (!day.v.includes(ipHash)) day.v.push(ipHash);
        if (type === 'pageview') day.p[page] = (day.p[page] || 0) + 1;
        if (type === 'click')    day.c[`${page}/${label}`] = (day.c[`${page}/${label}`] || 0) + 1;

        // Keep only last 90 days
        const dayKeys = Object.keys(aData).sort().slice(-90);
        const trimmed = {};
        dayKeys.forEach(k => { trimmed[k] = aData[k]; });

        fs.writeFileSync(aFile, JSON.stringify(trimmed), 'utf8');
      } catch (err) {
        console.error('[analytics]', err.message);
      }
      res.writeHead(204); res.end();
      return;
    }

    // ── POST /api/notify ──────────────────────────────────────────
    if (pathname === '/api/notify' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) { res.writeHead(403); res.end('Forbidden'); return; }

      const { type, message, details, anchor, eventId, category } = JSON.parse(await readBody(req));

      const siteUrl  = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${PORT}`;

      const icons = {
        game_added:'🎲',  game_modified:'🎲',  game_deleted:'🗑️',
        event_added:'📅', event_modified:'📅', event_deleted:'🗑️',
        table_added:'🪑', table_deleted:'🗑️', table_cancelled:'❌', table_reactivated:'✅',
        blog_added:'📝',  blog_modified:'📝',  blog_deleted:'🗑️',
      };
      const icon = icons[type] || '🔔';

      const pageUrl  = `${siteUrl}${anchor || ''}`;
      const btnLabel = anchor === '#evenements' ? 'Voir les événements'
                     : anchor === '#jeux'       ? 'Voir les jeux'
                     : anchor === '#blog'       ? 'Voir le blog'
                     : 'Visiter le site';

      const detailsHtml = Array.isArray(details) && details.length
        ? `<ul style="margin:0 0 1.5rem;padding-left:1.2rem;color:#444;font-size:.92rem;line-height:1.8;">${
            details.map(d => `<li>${d.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</li>`).join('')
          }</ul>`
        : '';

      const buildHtml = (unsubUrl, unsubLabel) => `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#f0f0f0;margin:0;padding:2rem;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#0e0c1a;padding:1.5rem 2rem;">
    <p style="color:#e8a020;margin:0;font-size:1.3rem;font-weight:700;">&#9670; Ried &amp; R&ocirc;le</p>
    <p style="color:#aaa;margin:.3rem 0 0;font-size:.82rem;">Notification du site</p>
  </div>
  <div style="padding:2rem;">
    <p style="font-size:1.1rem;color:#1a1a2e;margin:0 0 ${detailsHtml ? '1rem' : '1.5rem'};">${icon} ${message}</p>
    ${detailsHtml}
    <a href="${pageUrl}" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.65rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.9rem;">${btnLabel}</a>
    <hr style="border:none;border-top:1px solid #eee;margin:2rem 0 1rem;">
    <p style="font-size:.75rem;color:#999;margin:0;line-height:1.6;">
      Vous recevez cet e-mail car vous êtes abonné aux notifications de
      <a href="${siteUrl}" style="color:#e8a020;text-decoration:none;">Ried &amp; Rôle</a>.<br>
      <a href="${unsubUrl}" style="color:#999;">${unsubLabel}</a>
    </p>
  </div>
</div></body></html>`;

      let sent = 0;

      // ── Abonnés généraux ──────────────────────────────────────────
      const TOPIC_MAP = {
        game_added:    'games',  game_modified:    'games',       game_deleted:     'games',
        event_added:   'events', event_modified:   'events',      event_deleted:    'events',
        table_added:   'events', table_deleted:    'events',      table_cancelled:  'events', table_reactivated: 'events',
        blog_added:    'blog',   blog_modified:    'blog',        blog_deleted:     'blog',
      };
      const notifTopic = TOPIC_MAP[type];

      const subsFile = path.join(DATA, 'subscriptions.json');
      let subs = [];
      try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch {}
      if (subs.length) {
        const relevant = subs.filter(s => {
          const topics = Array.isArray(s.topics) ? s.topics : ['tout'];
          return topics.includes('tout') || (notifTopic && topics.includes(notifTopic));
        });
        for (const sub of relevant) sub.notifCount = (sub.notifCount || 0) + 1;
        fs.writeFileSync(subsFile, JSON.stringify(subs), 'utf8');
        if (isEmailConfigured()) {
          for (const sub of relevant) {
            const html = buildHtml(
              `${siteUrl}/unsubscribe?token=${encodeURIComponent(sub.token || sub.id)}`,
              'Se désabonner'
            );
            try { await sendEmail({ to: sub.email, subject: `[Ried & Rôle] ${message}`, html }); sent++; }
            catch (err) { console.error(`Email non envoyé à ${sub.email}:`, err.message); }
          }
        }
      }

      // ── Abonnés spécifiques à l'événement ─────────────────────────
      if (eventId) {
        const evtSubsFile = path.join(DATA, 'event_notif_subs.json');
        let evtSubs = [];
        try { evtSubs = JSON.parse(fs.readFileSync(evtSubsFile, 'utf8')); } catch {}

        if (type === 'event_deleted') {
          // Notifier + supprimer tous les abonnés de cet événement
          const relevant = evtSubs.filter(s => s.eventId === eventId);
          if (isEmailConfigured()) {
            for (const sub of relevant) {
              await sendEvtSubClosingEmail(sub, siteUrl, 'deleted');
              sent++;
            }
          }
          if (relevant.length) fs.writeFileSync(evtSubsFile, JSON.stringify(evtSubs.filter(s => s.eventId !== eventId)), 'utf8');

        } else if (['event_added', 'event_modified'].includes(type)) {
          const relevant = evtSubs.filter(s => s.eventId === eventId && s.eventMs > Date.now());
          if (relevant.length) {
            for (const sub of relevant) sub.notifCount = (sub.notifCount || 0) + 1;
            fs.writeFileSync(evtSubsFile, JSON.stringify(evtSubs), 'utf8');
            if (isEmailConfigured()) {
              for (const sub of relevant) {
                const html = buildHtml(
                  `${siteUrl}/event-notif-unsubscribe?token=${encodeURIComponent(sub.token)}`,
                  'Se désabonner des rappels de cet événement'
                );
                try { await sendEmail({ to: sub.email, subject: `[Ried & Rôle] ${message}`, html }); sent++; }
                catch (err) { console.error(`Email non envoyé à ${sub.email}:`, err.message); }
              }
            }
          }
        }
      }

      // Poster sur Discord via le bot si configuré
      if (isBotConfigured()) {
        // Blog → /bot/blog avec routage par catégorie
        if (type === 'blog_added' || type === 'blog_modified') {
          callBot('/bot/blog', {
            title: message, category: category || null,
            siteUrl: `${siteUrl}${anchor || ''}`
          }).catch(err => console.error('[bot-blog]', err.message));
        }
        // Jeux → /bot/announce salon games
        else if (type === 'game_added' || type === 'game_modified' || type === 'game_deleted') {
          callBot('/bot/announce', {
            topic: 'games', type, title: message, details,
            url:   `${siteUrl}${anchor || ''}`
          }).catch(err => console.error('[bot-announce]', err.message));
        }
        // Les événements passent par /api/discord-event → /bot/event (Server Events Discord)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sent }));
      return;
    }

    // ── GET /unsubscribe?token=xxx ─────────────────────────────────
    if (pathname === '/unsubscribe' && req.method === 'GET') {
      const token    = u.searchParams.get('token');
      const subsFile = path.join(DATA, 'subscriptions.json');
      let subs = [], found = false;
      try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch {}

      if (token) {
        const before = subs.length;
        subs  = subs.filter(s => (s.token || s.id) !== token);
        found = subs.length < before;
        if (found) fs.writeFileSync(subsFile, JSON.stringify(subs), 'utf8');
      }

      const msg   = found ? 'Vous avez bien été désabonné.' : 'Lien invalide ou déjà utilisé.';
      const color = found ? '#4ade80' : '#fca5a5';
      const html  = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Désabonnement — Ried &amp; Rôle</title></head>
<body style="font-family:sans-serif;background:#0e0c1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="background:#1a1530;border:1px solid #2a2545;border-radius:8px;padding:2.5rem 3rem;max-width:420px;text-align:center;">
  <p style="color:#e8a020;font-size:1.4rem;font-weight:700;margin:0 0 1rem;">&#9670; Ried &amp; R&ocirc;le</p>
  <p style="color:${color};font-size:1rem;margin:0 0 1.5rem;">${msg}</p>
  <a href="/" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.6rem 1.3rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.88rem;">Retour au site</a>
</div></body></html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ── POST /api/discord-event ───────────────────────────────────
    if (pathname === '/api/discord-event' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) { res.writeHead(403); res.end('Forbidden'); return; }

      if (!isBotConfigured() && !isDiscordConfigured()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Discord non configuré. Ajoutez les paramètres Discord dans config.json ou les variables d\'environnement.' }));
        return;
      }

      try {
        const { name, startIso, endIso, description, location } = JSON.parse(await readBody(req));

        // Déléguer au bot si disponible
        if (isBotConfigured()) {
          let dateStr;
          try {
            dateStr = new Date(startIso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
          } catch {
            dateStr = startIso;
          }
          const details = [`📅 ${dateStr}`, `📍 ${location || 'À définir'}`];
          if (description) details.push(description.slice(0, 200));

          // Action principale : annoncer dans le salon events
          let announceOk = false;
          let announceErr = 'Bot indisponible';
          let announceId;
          try {
            const r = await callBot('/bot/announce', { topic: 'events', type: 'event_added', title: name, details });
            let b; try { b = JSON.parse(r.body); } catch { b = { ok: false }; }
            if (b.ok) { announceOk = true; announceId = b.messageId; }
            else announceErr = b.error || 'Erreur bot';
          } catch (err) {
            announceErr = err.message;
          }

          if (announceOk) {
            // Bonus silencieux : créer l'événement planifié Discord
            callBot('/bot/event', { name, startIso, endIso, description, location })
              .then(r => { try { const b = JSON.parse(r.body); if (!b.ok) console.warn('[bot-event]', b.error); } catch {} })
              .catch(err => console.warn('[bot-event]', err.message));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, messageId: announceId }));
            return;
          }

          // Annonce échouée → erreur directe sans passer par le fallback Discord
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Erreur bot : ' + announceErr }));
          return;
        }

        // Fallback : appel direct à l'API Discord
        if (!isDiscordConfigured()) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Bot indisponible et Discord non configuré en direct.' }));
          return;
        }

        const payload = JSON.stringify({
          name:                   String(name).slice(0, 100),
          privacy_level:          2,
          scheduled_start_time:   startIso,
          scheduled_end_time:     endIso,
          entity_type:            3,
          entity_metadata:        { location: String(location || 'Lieu à confirmer').slice(0, 100) },
          ...(description ? { description: String(description).slice(0, 1000) } : {})
        });

        const guildId = discordGuildId();
        const result  = await new Promise((resolve, reject) => {
          const dreq = https.request({
            hostname: 'discord.com',
            path:     `/api/v10/guilds/${guildId}/scheduled-events`,
            method:   'POST',
            headers:  {
              'Authorization':  `Bot ${discordBotToken()}`,
              'Content-Type':   'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          }, dres => {
            let d = '';
            dres.on('data', c => d += c);
            dres.on('end', () => resolve({ status: dres.statusCode, body: d }));
          });
          dreq.on('error', reject);
          dreq.write(payload);
          dreq.end();
        });

        if (result.status >= 400) {
          let errMsg = `Erreur Discord ${result.status}`;
          try { errMsg = JSON.parse(result.body).message || errMsg; } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        } else {
          let created;
          try { created = JSON.parse(result.body); } catch { created = {}; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, url: created.id ? `https://discord.com/events/${guildId}/${created.id}` : null }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Erreur serveur : ' + err.message }));
      }
      return;
    }

    // ── POST /api/discord-blog ────────────────────────────────────
    if (pathname === '/api/discord-blog' && req.method === 'POST') {
      const session = getSession(req);
      if (!session) { res.writeHead(403); res.end('Forbidden'); return; }

      if (!isBotConfigured()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bot Discord non configuré (botWebhookUrl / botWebhookSecret manquants).' }));
        return;
      }

      try {
        const { title, category, author, siteUrl: articleUrl } = JSON.parse(await readBody(req));
        if (!title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'title requis' })); return; }

        const _siteUrl = process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : `http://localhost:${PORT}`;

        const result = await callBot('/bot/blog', {
          title, category: category || null, author: author || null,
          siteUrl: articleUrl || `${_siteUrl}#blog`
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Erreur bot : ' + err.message }));
      }
      return;
    }

    // ── POST /api/subscribe ───────────────────────────────────────
    if (pathname === '/api/subscribe' && req.method === 'POST') {
      try {
        const body   = JSON.parse(await readBody(req));
        const email  = String(body.email  || '').trim().slice(0, 200);
        const topics = Array.isArray(body.topics) ? body.topics.filter(t => ['tout','games','events','blog'].includes(t)) : [];

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Adresse e-mail invalide.' }));
          return;
        }
        if (!topics.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Choisissez au moins un sujet.' }));
          return;
        }

        const subsFile = path.join(DATA, 'subscriptions.json');
        let subs = [];
        try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch {}

        if (subs.find(s => s.email === email)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Cette adresse est déjà abonnée.' }));
          return;
        }

        const token = crypto.randomBytes(32).toString('hex');
        const id    = 'sub_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        const entry = { id, token, email, topics, createdAt: new Date().toISOString() };
        subs.push(entry);
        fs.writeFileSync(subsFile, JSON.stringify(subs), 'utf8');

        const siteUrl = process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : `http://localhost:${PORT}`;

        const topicLabels = { tout: 'Toutes les notifications', games: 'Jeux de rôles', events: 'Événements', blog: 'Articles de blog' };
        const topicsList  = topics.map(t => `<li style="margin-bottom:.4rem;">${topicLabels[t] || t}</li>`).join('');
        const unsubUrl    = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#f0f0f0;margin:0;padding:2rem;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#0e0c1a;padding:1.5rem 2rem;">
    <p style="color:#e8a020;margin:0;font-size:1.3rem;font-weight:700;">&#9670; Ried &amp; R&ocirc;le</p>
    <p style="color:#aaa;margin:.3rem 0 0;font-size:.82rem;">Confirmation d'abonnement</p>
  </div>
  <div style="padding:2rem;">
    <p style="font-size:1.05rem;color:#1a1a2e;margin:0 0 1rem;">🔔 Vous êtes maintenant abonné aux notifications de <strong>Ried &amp; Rôle</strong> !</p>
    <p style="font-size:.92rem;color:#444;margin:0 0 .6rem;">Vous serez notifié pour :</p>
    <ul style="margin:0 0 1.5rem;padding-left:1.2rem;color:#444;font-size:.92rem;line-height:1.8;">${topicsList}</ul>
    <a href="${siteUrl}" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.65rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.9rem;">Visiter le site</a>
    <hr style="border:none;border-top:1px solid #eee;margin:2rem 0 1rem;">
    <p style="font-size:.75rem;color:#999;margin:0;line-height:1.6;">
      Vous recevez cet e-mail car vous avez souscrit aux notifications de
      <a href="${siteUrl}" style="color:#e8a020;text-decoration:none;">Ried &amp; Rôle</a>.<br>
      <a href="${unsubUrl}" style="color:#999;">Se désabonner</a>
    </p>
  </div>
</div></body></html>`;

        if (isEmailConfigured()) {
          try { await sendEmail({ to: email, subject: '[Ried & Rôle] Abonnement confirmé', html }); }
          catch (err) { console.error('Email de confirmation non envoyé :', err.message); }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Erreur serveur.' }));
      }
      return;
    }

    // ── POST /api/event-subscribe ─────────────────────────────────
    if (pathname === '/api/event-subscribe' && req.method === 'POST') {
      try {
        const body    = JSON.parse(await readBody(req));
        const email   = String(body.email   || '').trim().slice(0, 200);
        const eventId = String(body.eventId || '').slice(0, 50);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Adresse e-mail invalide.' }));
          return;
        }

        let events = [];
        try { events = JSON.parse(fs.readFileSync(path.join(DATA, 'events.json'), 'utf8')); } catch {}
        const ev = events.find(e => e.id === eventId);
        if (!ev) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Événement introuvable.' }));
          return;
        }

        const eventMs = parseEventMs(ev);
        if (!eventMs || eventMs < Date.now()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Cet événement est déjà passé.' }));
          return;
        }

        const subsFile = path.join(DATA, 'event_notif_subs.json');
        let subs = [];
        try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch {}

        if (!subs.find(s => s.email === email && s.eventId === eventId)) {
          subs.push({
            id:         'evtsub_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
            token:      crypto.randomBytes(20).toString('hex'),
            email, eventId,
            eventTitle: ev.title,
            eventMs,
            sent1: false, sent2: false,
            createdAt: new Date().toISOString()
          });
          fs.writeFileSync(subsFile, JSON.stringify(subs), 'utf8');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (err) {
        console.error('[event-subscribe]', err.message);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
      return;
    }

    // ── GET /event-notif-unsubscribe?token=xxx ─────────────────────
    if (pathname === '/event-notif-unsubscribe' && req.method === 'GET') {
      const token    = u.searchParams.get('token');
      const subsFile = path.join(DATA, 'event_notif_subs.json');
      let subs = [], found = false;
      try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch {}
      if (token) {
        const before = subs.length;
        subs  = subs.filter(s => s.token !== token);
        found = subs.length < before;
        if (found) fs.writeFileSync(subsFile, JSON.stringify(subs), 'utf8');
      }
      const msg   = found ? 'Vous avez bien été désabonné des rappels pour cet événement.' : 'Lien invalide ou déjà utilisé.';
      const color = found ? '#4ade80' : '#fca5a5';
      const html  = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Désabonnement — Ried &amp; Rôle</title></head>
<body style="font-family:sans-serif;background:#0e0c1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="background:#1a1530;border:1px solid #2a2545;border-radius:8px;padding:2.5rem 3rem;max-width:420px;text-align:center;">
  <p style="color:#e8a020;font-size:1.4rem;font-weight:700;margin:0 0 1rem;">&#9670; Ried &amp; R&ocirc;le</p>
  <p style="color:${color};font-size:1rem;margin:0 0 1.5rem;">${msg}</p>
  <a href="/" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.6rem 1.3rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.88rem;">Retour au site</a>
</div></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ── POST /api/contact ─────────────────────────────────────────
    if (pathname === '/api/contact' && req.method === 'POST') {
      try {
        const body    = JSON.parse(await readBody(req));
        const fname   = String(body.fname   || '').trim().slice(0, 100);
        const lname   = String(body.lname   || '').trim().slice(0, 100);
        const email   = String(body.email   || '').trim().slice(0, 200);
        const subject = String(body.subject || '').trim().slice(0, 200);
        const message = String(body.message || '').trim().slice(0, 5000);

        if (!fname || !email || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Champs requis manquants.' }));
          return;
        }

        const CONTACT_TO    = 'ried.and.role@gmail.com';
        const subjectLine   = subject ? `[Contact] ${subject}` : '[Contact] Nouveau message depuis le site';
        const contactHtml   = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#f0f0f0;margin:0;padding:2rem;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#0e0c1a;padding:1.5rem 2rem;">
    <p style="color:#e8a020;margin:0;font-size:1.3rem;font-weight:700;">&#9670; Ried &amp; R&ocirc;le</p>
    <p style="color:#aaa;margin:.3rem 0 0;font-size:.82rem;">Message depuis le formulaire de contact</p>
  </div>
  <div style="padding:2rem;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
      <tr><td style="color:#888;padding:.3rem 0;width:90px;">De</td><td style="color:#1a1a2e;font-weight:600;">${fname} ${lname}</td></tr>
      <tr><td style="color:#888;padding:.3rem 0;">Email</td><td><a href="mailto:${email}" style="color:#e8a020;">${email}</a></td></tr>
      ${subject ? `<tr><td style="color:#888;padding:.3rem 0;">Sujet</td><td style="color:#1a1a2e;">${subject}</td></tr>` : ''}
    </table>
    <div style="background:#f8f8f8;border-left:3px solid #e8a020;padding:1rem 1.2rem;border-radius:0 4px 4px 0;white-space:pre-wrap;color:#333;">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>
</div></body></html>`;

        if (isEmailConfigured()) {
          await sendEmail({ to: CONTACT_TO, subject: subjectLine, html: contactHtml, replyTo: email });
        } else {
          console.log(`[contact] Message de ${fname} ${lname} <${email}> : ${message.slice(0, 80)}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (err) {
        console.error('[contact]', err.message);
        if (!res.headersSent) { res.writeHead(500); res.end('{"ok":false}'); }
      }
      return;
    }

    // ── Data API : GET|POST /data/<name>.json ──────────────────────
    if (/^\/data\/[\w-]+\.json$/.test(pathname)) {
      const file = path.join(DATA, path.basename(pathname));

      if (req.method === 'GET') {
        const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        try {
          const data = await fs.promises.readFile(file, 'utf8');
          res.writeHead(200, headers);
          res.end(data);
        } catch {
          res.writeHead(200, headers);
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
      const ext  = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const hdrs = { 'Content-Type': mime };
      if (ext === '.js' || ext === '.css' || ext === '.html') hdrs['Cache-Control'] = 'no-cache';
      res.writeHead(200, hdrs);
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

/* ── Email simple pour abonnés événement (annulation / passé) ───── */
async function sendEvtSubClosingEmail(sub, siteUrl, reason) {
  const isDeleted = reason === 'deleted';
  const icon    = isDeleted ? '🗑️' : '✅';
  const heading = isDeleted
    ? `L'événement « ${sub.eventTitle} » a été annulé`
    : `L'événement « ${sub.eventTitle} » a eu lieu`;
  const body    = isDeleted
    ? `L'événement auquel vous souhaitiez assister a malheureusement été annulé. Votre abonnement aux rappels a été retiré automatiquement.`
    : `Merci pour votre intérêt ! L'événement s'est déroulé et votre abonnement aux rappels a été retiré automatiquement.`;
  const subject = `[Ried & Rôle] ${heading}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#f0f0f0;margin:0;padding:2rem;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#0e0c1a;padding:1.5rem 2rem;">
    <p style="color:#e8a020;margin:0;font-size:1.3rem;font-weight:700;">&#9670; Ried &amp; R&ocirc;le</p>
    <p style="color:#aaa;margin:.3rem 0 0;font-size:.82rem;">Notification événement</p>
  </div>
  <div style="padding:2rem;">
    <p style="font-size:1.1rem;color:#1a1a2e;margin:0 0 .75rem;">${icon} <strong>${sub.eventTitle}</strong></p>
    <p style="color:#555;margin:0 0 1.5rem;">${body}</p>
    <a href="${siteUrl}/#evenements" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.65rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.9rem;">Voir les événements</a>
  </div>
</div></body></html>`;
  try {
    await sendEmail({ to: sub.email, subject, html });
    console.log(`[event-notif] ${reason} → ${sub.email} pour "${sub.eventTitle}"`);
  } catch (err) {
    console.error(`[event-notif] Erreur email ${sub.email}:`, err.message);
  }
}

/* ── Event notification email ────────────────────────────────────── */
async function sendEventNotifEmail(sub, siteUrl, milestoneNum, hoursLeft) {
  const unsubUrl = `${siteUrl}/event-notif-unsubscribe?token=${encodeURIComponent(sub.token)}`;
  const timeStr  = fmtHours(hoursLeft);
  const icon     = milestoneNum === 1 ? '📅' : '⏰';
  const subject  = `[Ried & Rôle] Rappel ${milestoneNum}/2 : « ${sub.eventTitle} » dans ${timeStr}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#f0f0f0;margin:0;padding:2rem;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#0e0c1a;padding:1.5rem 2rem;">
    <p style="color:#e8a020;margin:0;font-size:1.3rem;font-weight:700;">&#9670; Ried &amp; R&ocirc;le</p>
    <p style="color:#aaa;margin:.3rem 0 0;font-size:.82rem;">Rappel événement — ${milestoneNum}/2</p>
  </div>
  <div style="padding:2rem;">
    <p style="font-size:1.1rem;color:#1a1a2e;margin:0 0 .75rem;">${icon} <strong>${sub.eventTitle}</strong></p>
    <p style="color:#555;margin:0 0 1.5rem;">L'événement aura lieu <strong>dans ${timeStr}</strong>. Ne l'oubliez pas !</p>
    <a href="${siteUrl}/#evenements" style="display:inline-block;background:#e8a020;color:#0a0a0a;padding:.65rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:.9rem;">Voir les événements</a>
    <hr style="border:none;border-top:1px solid #eee;margin:2rem 0 1rem;">
    <p style="font-size:.75rem;color:#999;margin:0;line-height:1.6;">
      Vous recevez cet e-mail car vous avez demandé à être notifié pour cet événement sur
      <a href="${siteUrl}" style="color:#e8a020;text-decoration:none;">Ried &amp; Rôle</a>.<br>
      <a href="${unsubUrl}" style="color:#999;">Se désabonner de ces rappels</a>
    </p>
  </div>
</div></body></html>`;
  try {
    await sendEmail({ to: sub.email, subject, html });
    console.log(`[event-notif] Jalon ${milestoneNum} → ${sub.email} pour "${sub.eventTitle}"`);
  } catch (err) {
    console.error(`[event-notif] Erreur email ${sub.email}:`, err.message);
  }
}

/* ── Milestone scheduler (every 15 min) ──────────────────────────── */
async function checkEventNotifMilestones() {
  try {
    if (!isEmailConfigured()) return;

    const subsFile = path.join(DATA, 'event_notif_subs.json');
    let subs = [];
    try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch { return; }
    if (!subs.length) return;

    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'site.json'), 'utf8')); } catch {}
    const m1h = Math.max(1, parseInt(cfg.milestone1Hours, 10) || 168);
    const m2h = Math.max(1, parseInt(cfg.milestone2Hours, 10) || 24);

    const siteUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${PORT}`;

    const now = Date.now();
    let changed = false;

    for (const sub of subs) {
      if (!sub.eventMs) continue;
      const msUntil = sub.eventMs - now;
      if (msUntil <= 0) continue;

      if (!sub.sent1 && msUntil <= m1h * 3600000) {
        await sendEventNotifEmail(sub, siteUrl, 1, Math.round(msUntil / 3600000));
        sub.sent1 = true; changed = true;
      }
      if (!sub.sent2 && msUntil <= m2h * 3600000) {
        await sendEventNotifEmail(sub, siteUrl, 2, Math.round(msUntil / 3600000));
        sub.sent2 = true; changed = true;
      }
    }

    // Notifier + purger les abonnés dont l'événement est passé (> 1h après le début)
    const expired = subs.filter(s => s.eventMs && s.eventMs < now - 3600000 && !s.closingEmailSent);
    for (const sub of expired) {
      await sendEvtSubClosingEmail(sub, siteUrl, 'past');
      sub.closingEmailSent = true;
      changed = true;
    }
    const active = subs.filter(s => !s.eventMs || s.eventMs > now - 86400000);
    if (changed || active.length !== subs.length) {
      fs.writeFileSync(subsFile, JSON.stringify(active), 'utf8');
    }
  } catch (err) {
    console.error('[event-notif] scheduler:', err.message);
  }
}

setInterval(checkEventNotifMilestones, 15 * 60 * 1000);
setTimeout(checkEventNotifMilestones, 60000); // first check 1 min after startup

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓  Ried & Rôle  →  http://localhost:${PORT}`);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`✓  Public URL  →  https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
  console.log('   Ctrl+C pour arrêter');
});
