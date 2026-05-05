'use strict';
const http       = require('http');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }
const zlib = require('zlib');

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
/* Lire Bot_discord/config.json — ses valeurs ont la priorité pour le bot */
let _botCfg = {};
try {
  _botCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'Bot_discord', 'config.json'), 'utf8'));
} catch {}

function _botToken()    { return _botCfg.token    || process.env.DISCORD_BOT_TOKEN || _cfg.discordBotToken || ''; }
function _botGuildId()  { return _botCfg.guildId  || discordGuildId(); }
function discordChannels() {
  if (_botCfg.channels) return _botCfg.channels;
  if (_cfg.discordChannels) return _cfg.discordChannels;
  try { const e = process.env.DISCORD_CHANNELS; if (e) return JSON.parse(e); } catch {}
  return {};
}

/* ── Bot Discord intégré (discord.js optionnel) ──────────────────── */
let _discord      = null; // { client, REST, Routes, EmbedBuilder } après require
let _discordReady = false;

function _isBotReady() { return _discordReady && !!_discord; }

async function _fetchDiscordChannel(topic, sub = null) {
  if (!_discord) return null;
  const section = discordChannels()[topic];
  if (!section) return null;
  const ids = [];
  if (typeof section === 'object' && !Array.isArray(section)) {
    if (sub && section[sub]) ids.push(section[sub]);
    if (section.default && section.default !== section[sub]) ids.push(section.default);
  } else {
    ids.push(section);
  }
  for (const id of ids) {
    try {
      const ch = await _discord.client.channels.fetch(id);
      if (ch?.isTextBased() || ch?.type === 15) return ch;
      if (ch) console.warn(`[bot] Canal ${id} non textuel (type: ${ch.type})`);
    } catch (err) {
      console.warn(`[bot] Canal ${id} inaccessible : ${err.message}`);
    }
  }
  return null;
}

const _BOT_COLOR = 0xe8a020;
const _BOT_ICONS = {
  event_added:'📅', event_modified:'📅', event_deleted:'🗑️',
  table_added:'🪑', table_cancelled:'❌', table_reactivated:'✅',
  game_added:'🎲',  game_modified:'🎲',  game_deleted:'🗑️',
  blog_added:'📝',  blog_modified:'📝',  blog_deleted:'🗑️',
  agenda_added:'📆', agenda_modified:'📆', agenda_deleted:'🗑️',
};

async function botAnnounce(topic, type, title, details, url) {
  if (!_isBotReady()) throw new Error('Bot non connecté');
  const ch = await _fetchDiscordChannel(topic);
  if (!ch) throw new Error(`Salon "${topic}" non configuré dans discordChannels`);
  const embed = new _discord.EmbedBuilder()
    .setTitle(`${_BOT_ICONS[type] || '🔔'} ${String(title || 'Notification').slice(0, 256)}`)
    .setColor(_BOT_COLOR).setTimestamp();
  if (url) embed.setURL(url);
  if (Array.isArray(details) && details.length)
    embed.setDescription(details.map(d => `• ${d}`).join('\n').slice(0, 4096));
  if (ch.type === 15) {
    const thread = await ch.threads.create({ name: String(title || 'Notification').slice(0, 100), message: { embeds: [embed] } });
    console.log(`[bot] Annonce dans forum #${ch.name} (fil ${thread.id})`);
    return { messageId: thread.id };
  }
  const msg = await ch.send({ embeds: [embed] });
  console.log(`[bot] Annonce dans #${ch.name} (topic=${topic})`);
  return { messageId: msg.id };
}

async function botBlog(title, category, author, excerpt, imageUrls) {
  if (!_isBotReady()) throw new Error('Bot non connecté');
  const ch = await _fetchDiscordChannel('blog', category || null);
  if (!ch) throw new Error(`Salon blog "${category || 'default'}" non configuré`);
  const embed = new _discord.EmbedBuilder()
    .setTitle(String(title).slice(0, 256))
    .setColor(_BOT_COLOR);
  if (author)  embed.setAuthor({ name: ('Auteur : ' + String(author)).slice(0, 256) });
  if (excerpt) embed.setDescription(String(excerpt).slice(0, 4096));
  const imgs = (Array.isArray(imageUrls) ? imageUrls : []).filter(u => typeof u === 'string' && u.trim()).slice(0, 10);
  if (ch.type === 15) {
    const thread = await ch.threads.create({ name: String(title).slice(0, 100), message: { embeds: [embed] } });
    for (const url of imgs) { try { await thread.send({ files: [url] }); } catch { await thread.send(url); } }
    console.log(`[bot] Blog dans forum #${ch.name} (fil ${thread.id}, ${imgs.length} image(s))`);
    return { messageId: thread.id };
  }
  const msg = await ch.send({ embeds: [embed] });
  for (const url of imgs) { try { await ch.send({ files: [url] }); } catch { await ch.send(url); } }
  console.log(`[bot] Blog dans #${ch.name} (cat=${category || 'default'}, ${imgs.length} image(s))`);
  return { messageId: msg.id };
}

async function botEventPost(name, dateStr, location, description) {
  if (!_isBotReady()) throw new Error('Bot non connecté');
  const ch = await _fetchDiscordChannel('events');
  if (!ch) throw new Error('Salon "events" non configuré dans discordChannels');
  const descParts = [`📅 ${dateStr}`, `📍 ${location || 'À définir'}`];
  if (description) descParts.push('', description);
  const embed = new _discord.EmbedBuilder()
    .setTitle(String(name).slice(0, 256))
    .setColor(_BOT_COLOR)
    .setDescription(descParts.join('\n').slice(0, 4096));
  if (ch.type === 15) {
    const thread = await ch.threads.create({ name: String(name).slice(0, 100), message: { embeds: [embed] } });
    console.log(`[bot] Événement dans forum #${ch.name} (fil ${thread.id})`);
    return { messageId: thread.id };
  }
  const msg = await ch.send({ embeds: [embed] });
  console.log(`[bot] Événement dans #${ch.name}`);
  return { messageId: msg.id };
}

async function botEvent(name, startIso, endIso, description, location) {
  if (!_discord) throw new Error('Bot non initialisé');
  if (new Date(startIso) <= new Date()) throw new Error('Date dans le passé');
  const rest = new _discord.REST().setToken(_botToken());
  const payload = {
    name:                 String(name).slice(0, 100),
    privacy_level:        2,
    scheduled_start_time: startIso,
    scheduled_end_time:   endIso,
    entity_type:          3,
    entity_metadata:      { location: String(location || 'Lieu à confirmer').slice(0, 100) },
  };
  if (description) payload.description = String(description).slice(0, 1000);
  const event = await rest.post(_discord.Routes.guildScheduledEvents(_botGuildId()), { body: payload });
  console.log(`[bot] Événement Discord planifié : "${event.name}" (${event.id})`);
  return { eventId: event.id, url: `https://discord.com/events/${_botGuildId()}/${event.id}` };
}

function _initDiscordBot() {
  const token   = _botToken();
  const guildId = _botGuildId();
  if (!token || !guildId) return;
  let djs;
  try { djs = require('discord.js'); }
  catch { console.warn('⚠  discord.js non installé — bot Discord désactivé'); return; }
  const { Client, REST, Routes, GatewayIntentBits, EmbedBuilder } = djs;
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  _discord = { client, REST, Routes, EmbedBuilder };
  client.once('clientReady', () => {
    _discordReady = true;
    console.log(`✓  Bot Discord connecté : ${client.user.tag}`);
  });
  client.on('error', err => console.error('[discord.js]', err.message));
  client.login(token).catch(err => console.error('✗  Connexion Discord échouée :', err.message));
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
const ALL_PERMS = ['evenements', 'agenda', 'jeux', 'equipe', 'blog', 'bibliotheque', 'site'];

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

/* ── Binary body reader ──────────────────────────────────────────── */
function readBodyBinary(req, limit = 10240) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) reject(Object.assign(new Error('Too large'), { code: 'TOO_LARGE' }));
      else chunks.push(chunk);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ── ZIP helpers ─────────────────────────────────────────────────── */
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function _crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ _crc32Table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralEntries = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const dataBuf   = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc       = _crc32(dataBuf);
    const size      = dataBuf.length;

    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBytes.copy(lh, 30);

    const ch = Buffer.alloc(46 + nameBytes.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    nameBytes.copy(ch, 46);

    localParts.push(lh, dataBuf);
    centralEntries.push(ch);
    offset += lh.length + size;
  }

  const cdSize = centralEntries.reduce((s, h) => s + h.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralEntries, eocd]);
}

function parseZip(buffer) {
  const files = [];
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) { pos++; continue; }
    const compression = buffer.readUInt16LE(pos + 8);
    const compSize    = buffer.readUInt32LE(pos + 18);
    const fnLen       = buffer.readUInt16LE(pos + 26);
    const extraLen    = buffer.readUInt16LE(pos + 28);
    const filename    = buffer.slice(pos + 30, pos + 30 + fnLen).toString('utf8');
    const dataStart   = pos + 30 + fnLen + extraLen;
    const compData    = buffer.slice(dataStart, dataStart + compSize);
    let data;
    if (compression === 0)      data = compData;
    else if (compression === 8) { try { data = zlib.inflateRawSync(compData); } catch { /* skip */ } }
    if (data !== undefined) files.push({ name: filename, data });
    pos = dataStart + compSize;
  }
  return files;
}

/* ── External HTTP helpers ───────────────────────────────────────── */
function fetchExternal(url, extraHeaders = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const reqExt = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 RiedRole/1.0', 'Accept': '*/*', ...extraHeaders }
    }, resExt => {
      let data = '';
      resExt.on('data', chunk => data += chunk);
      resExt.on('end', () => resolve({ status: resExt.statusCode, headers: resExt.headers, body: data }));
    });
    reqExt.on('error', reject);
    reqExt.setTimeout(timeoutMs, () => { reqExt.destroy(new Error('timeout')); });
  });
}

function fetchExternalPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, 'utf8');
    const urlObj  = new URL(url);
    const reqExt  = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  { 'User-Agent': 'RiedRole/1.0', ...headers, 'Content-Length': bodyBuf.length }
    }, resExt => {
      let data = '';
      resExt.on('data', chunk => data += chunk);
      resExt.on('end', () => resolve({ status: resExt.statusCode, body: data }));
    });
    reqExt.on('error', reject);
    reqExt.setTimeout(10000, () => { reqExt.destroy(new Error('timeout')); });
    reqExt.write(bodyBuf);
    reqExt.end();
  });
}

/* ── BnF SRU (Bibliothèque nationale de France) ──────────────────── */
async function searchBnF(q) {
  const sruQ = `bib.title all "${q.replace(/"/g, '')}"`;
  const url  = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve`
             + `&query=${encodeURIComponent(sruQ)}&maximumRecords=4&recordSchema=dublincore`;
  const { body } = await fetchExternal(url);

  const results = [];
  const recordRe = /<srw:recordData>([\s\S]*?)<\/srw:recordData>/g;
  let m;
  while ((m = recordRe.exec(body)) !== null) {
    const rec = m[1];
    const getOne = tag => { const r = rec.match(new RegExp(`<dc:${tag}[^>]*>([^<]+)<\/dc:${tag}>`, 'i')); return r ? r[1].trim() : ''; };
    const getAll = tag => { const r = new RegExp(`<dc:${tag}[^>]*>([^<]+)<\/dc:${tag}>`, 'gi'); const v = []; let mm; while ((mm = r.exec(rec)) !== null) v.push(mm[1].trim()); return v; };

    const title = getOne('title');
    if (!title) continue;

    const identifiers = getAll('identifier');
    const isbnRaw     = identifiers.find(id => /978|979/.test(id) || /isbn/i.test(id)) || '';
    const isbn        = isbnRaw.replace(/[^0-9X]/gi, '').slice(0, 13);
    const cover       = isbn.length >= 10 ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : null;
    const arkRaw      = identifiers.find(id => /ark:\/12148/.test(id)) || '';
    const bnfUrl      = arkRaw
      ? (arkRaw.startsWith('http') ? arkRaw : 'https://catalogue.bnf.fr/' + arkRaw)
      : null;

    results.push({
      title,
      author:      getAll('creator').slice(0, 2).join(', '),
      publisher:   getOne('publisher'),
      year:        (getOne('date') || '').slice(0, 4),
      cover,
      description: getOne('description'),
      url:         bnfUrl,
      source:      'BnF'
    });
  }
  return results;
}

/* ── IGDB / Twitch ───────────────────────────────────────────────── */
const _igdbClientId     = () => _cfg.igdbClientId     || process.env.IGDB_CLIENT_ID     || '';
const _igdbClientSecret = () => _cfg.igdbClientSecret || process.env.IGDB_CLIENT_SECRET || '';
let _igdbToken = '', _igdbTokenExpiry = 0;

async function getIGDBToken() {
  if (_igdbToken && Date.now() < _igdbTokenExpiry - 60_000) return _igdbToken;
  const cid = _igdbClientId(), sec = _igdbClientSecret();
  if (!cid || !sec) return null;
  const { body } = await fetchExternalPost(
    'https://id.twitch.tv/oauth2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    `client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(sec)}&grant_type=client_credentials`
  );
  const data = JSON.parse(body);
  if (!data.access_token) throw new Error('IGDB token KO');
  _igdbToken       = data.access_token;
  _igdbTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _igdbToken;
}

async function searchIGDB(q) {
  const token = await getIGDBToken();
  const cid   = _igdbClientId();
  if (!token || !cid) return [];
  // Genre 12 = RPG  |  country 250 = France (ISO 3166-1 numérique)
  const query = `search "${q.replace(/"/g, '\\"')}";\nfields name,cover.url,first_release_date,involved_companies.company.name,involved_companies.company.country,summary,url;\nwhere genres = (12) & involved_companies.company.country = 250;\nlimit 5;`;
  const { body } = await fetchExternalPost(
    'https://api.igdb.com/v4/games',
    { 'Client-ID': cid, 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
    query
  );
  const games = JSON.parse(body);
  if (!Array.isArray(games)) return [];
  return games.map(g => {
    const cover = g.cover?.url ? 'https:' + g.cover.url.replace('t_thumb', 't_cover_big') : null;
    const publisher = (g.involved_companies || []).map(ic => ic.company?.name).filter(Boolean).slice(0, 2).join(', ');
    return {
      title:       g.name || '',
      author:      publisher,
      publisher,
      year:        g.first_release_date ? String(new Date(g.first_release_date * 1000).getFullYear()) : '',
      cover,
      description: g.summary || '',
      url:         g.url || null,
      source:      'IGDB'
    };
  });
}

/* ── Black Book Éditions — GraphQL via minus.black-book-editions.fr ─ */
async function searchBBE(q) {
  const BBE_BASE     = 'https://shop.black-book-editions.fr';
  const GQL_ENDPOINT = 'https://minus.black-book-editions.fr/graphql';
  const gqlQuery = `query($nameLike: String, $limit: Int, $offset: Int) {
    store {
      products(nameLike: $nameLike, limit: $limit, offset: $offset) {
        total
        hits {
          id
          name
          nameSlug
          images { sizeS default }
          shortDescription
          description
          rangeId
          rangeSlug
        }
      }
    }
  }`;

  let gqlBody, gqlStatus;
  try {
    ({ body: gqlBody, status: gqlStatus } = await fetchExternalPost(
      GQL_ENDPOINT,
      { 'Content-Type': 'application/json', 'Origin': BBE_BASE, 'Referer': BBE_BASE + '/' },
      JSON.stringify({ query: gqlQuery, variables: { nameLike: q, limit: 9, offset: 0 } })
    ));
  } catch(e) { console.error('[BBE] erreur réseau:', e.message); return []; }

  if (gqlStatus !== 200) return [];

  let hits;
  try {
    const data = JSON.parse(gqlBody);
    hits = data?.data?.store?.products?.hits;
  } catch { return []; }

  if (!Array.isArray(hits)) return [];

  return hits.map(p => ({
    title:       p.name || '',
    author:      '',
    publisher:   'Black Book Éditions',
    year:        '',
    cover:       p.images?.[0]?.sizeS || p.images?.[0]?.default || null,
    description: (p.description || p.shortDescription || '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,500),
    url:         p.id && p.nameSlug ? `${BBE_BASE}/produit/${p.id}/0/${p.rangeSlug || 'gamme'}/${p.nameSlug}` : null,
    source:      'BBE'
  })).filter(p => p.title);
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
        agenda_added:'📆', agenda_modified:'📆', agenda_deleted:'🗑️',
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
        agenda_added:  'agenda', agenda_modified:  'agenda',      agenda_deleted:   'agenda',
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

      // Poster sur Discord via le bot intégré si connecté
      if (_isBotReady()) {
        if (type === 'game_added' || type === 'game_modified' || type === 'game_deleted') {
          botAnnounce('games', type, message, details, `${siteUrl}${anchor || ''}`)
            .catch(err => console.error('[bot-announce]', err.message));
        }
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

      if (!_isBotReady() && !isDiscordConfigured()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Discord non configuré. Ajoutez les paramètres Discord dans config.json ou les variables d\'environnement.' }));
        return;
      }

      try {
        const { name, startIso, endIso, description, location } = JSON.parse(await readBody(req));

        // Utiliser le bot intégré si connecté
        if (_isBotReady()) {
          let dateStr;
          try {
            dateStr = new Date(startIso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
          } catch {
            dateStr = startIso;
          }

          // Créer l'événement serveur Discord (nécessite permission "Gérer les événements")
          try {
            const r = await botEvent(name, startIso, endIso, description, location);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, url: r.url }));
          } catch (err) {
            console.warn('[bot-event]', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
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
      if (!session) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Session expirée, veuillez vous reconnecter.' })); return; }

      if (!_isBotReady()) {
        const missing = [];
        if (!_botToken())   missing.push('DISCORD_BOT_TOKEN');
        if (!_botGuildId()) missing.push('DISCORD_GUILD_ID');
        const detail = missing.length ? ` (variables manquantes : ${missing.join(', ')})` : ' (connexion en cours ou token invalide)';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bot Discord non connecté' + detail }));
        return;
      }

      try {
        const { title, category, author, excerpt, imageUrls } = JSON.parse(await readBody(req, 65536));
        if (!title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'title requis' })); return; }

        const r = await botBlog(title, category || null, author || null, excerpt || null, Array.isArray(imageUrls) ? imageUrls : []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, messageId: r.messageId }));
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
        const topics = Array.isArray(body.topics) ? body.topics.filter(t => ['tout','games','events','blog','agenda'].includes(t)) : [];

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

        const topicLabels = { tout: 'Toutes les notifications', games: 'Jeux de rôles', events: 'Événements', blog: 'Articles de blog', agenda: 'Agenda' };
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

    // ── GET /api/library-lookup ───────────────────────────────────
    // Paramètre `source` : recherche une seule source et retourne JSON.
    // Le client lance N requêtes parallèles (une par source) et affiche
    // chaque résultat dès réception, sans attendre les autres.
    if (pathname === '/api/library-lookup' && req.method === 'GET') {
      const session = getSession(req);
      const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
      if (!session) {
        res.writeHead(401, JSON_HDR);
        res.end(JSON.stringify({ ok: false, error: 'Session expirée — veuillez vous reconnecter.' }));
        return;
      }

      const q      = (u.searchParams.get('q')      || '').trim();
      const genre  = (u.searchParams.get('genre')  || '').trim();
      const source = (u.searchParams.get('source') || '').trim();

      if (!q || !source) {
        res.writeHead(200, JSON_HDR);
        res.end(JSON.stringify({ ok: true, source, results: [] }));
        return;
      }

      async function searchOL() {
        const { body } = await fetchExternal(
          `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}&limit=6`
        );
        return (JSON.parse(body).docs || []).slice(0, 6).map(doc => ({
          title:       doc.title || '',
          author:      (doc.author_name || []).slice(0, 2).join(', '),
          publisher:   (doc.publisher || []).slice(-1)[0] || '',
          year:        String(doc.first_publish_year || ''),
          cover:       doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
          description: '',
          url:         doc.key ? 'https://openlibrary.org' + doc.key : null,
          source:      'OpenLibrary'
        }));
      }

      async function searchBGG() {
        const bggType = genre === 'jdr' ? 'rpgitem,boardgame' : 'boardgame,rpgitem';
        const { body: searchXml } = await fetchExternal(
          `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(q)}&type=${bggType}`
        );
        const ids = [];
        for (const chunk of searchXml.split('<item ').slice(1, 6)) {
          const m = chunk.match(/id="(\d+)"/);
          if (m) ids.push(m[1]);
        }
        if (!ids.length) return [];
        const { body: detailXml } = await fetchExternal(
          `https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=0`
        );
        const out = [];
        for (const chunk of detailXml.split('<item ').slice(1)) {
          const nameM = chunk.match(/name type="primary"[^>]+value="([^"]*)"/);
          if (!nameM) continue;
          const yearM = chunk.match(/yearpublished value="(\d+)"/);
          const imgM  = chunk.match(/<image>\s*([\s\S]*?)\s*<\/image>/);
          const descM = chunk.match(/<description>([\s\S]*?)<\/description>/);
          const pubM  = chunk.match(/type="boardgamepublisher"[^>]+value="([^"]*)"/);
          const authM = chunk.match(/type="(?:boardgamedesigner|rpgdesigner)"[^>]+value="([^"]*)"/g);
          let desc = descM ? descM[1] : '';
          desc = desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
                     .replace(/&quot;/g,'"').replace(/&#10;/g,' ').replace(/<[^>]+>/g,'').trim().slice(0,600);
          const authors = authM
            ? authM.slice(0,2).map(s => { const mm = s.match(/value="([^"]*)"/); return mm ? mm[1] : ''; }).join(', ')
            : '';
          let cover = imgM ? imgM[1].trim() : null;
          if (cover && !cover.startsWith('http')) cover = 'https:' + cover;
          const bggIdM   = chunk.match(/\bid="(\d+)"/);
          const bggTypeM = chunk.match(/\btype="([^"]+)"/);
          const bggId    = bggIdM?.[1];
          const bggType  = bggTypeM?.[1] || 'boardgame';
          out.push({ title: nameM[1], author: authors, publisher: pubM ? pubM[1] : '',
                     year: yearM ? yearM[1] : '', cover: cover || null, description: desc,
                     url: bggId ? `https://boardgamegeek.com/${bggType}/${bggId}` : null,
                     source: 'BoardGameGeek' });
        }
        return out;
      }

      const sourceMap = {
        'OpenLibrary':  () => searchOL(),
        'BoardGameGeek':() => searchBGG(),
        'BnF':          () => searchBnF(q),
        'IGDB':         () => searchIGDB(q),
        'BBE':          () => searchBBE(q)
      };

      console.log(`[lookup] source="${source}" q="${q}"`);
      const fn = sourceMap[source];
      const results = fn
        ? await fn().catch(e => { console.error(`[lookup/${source}]`, e.message); return []; })
        : [];

      res.writeHead(200, JSON_HDR);
      res.end(JSON.stringify({ ok: true, source, results }));
      return;
    }

    // ── GET /api/blog-svgs ────────────────────────────────────────
    if (pathname === '/api/blog-svgs' && req.method === 'GET') {
      const svgDir = path.join(ROOT, 'assets', 'blog', 'svg');
      try {
        const files = await fs.promises.readdir(svgDir);
        const svgs = files.filter(f => f.toLowerCase().endsWith('.svg'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(svgs));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
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

    // ── GET /api/backup-data ──────────────────────────────────────
    if (pathname === '/api/backup-data' && req.method === 'GET') {
      const session = getSession(req);
      if (!session || !session.permissions.includes('site')) { res.writeHead(403); res.end('Forbidden'); return; }
      try {
        const entries = await fs.promises.readdir(DATA);
        const files = [];
        for (const entry of entries) {
          if (!entry.endsWith('.json')) continue;
          try {
            const content = await fs.promises.readFile(path.join(DATA, entry));
            files.push({ name: entry, data: content });
          } catch { /* skip unreadable */ }
        }
        const zip = createZip(files);
        const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.writeHead(200, {
          'Content-Type':        'application/zip',
          'Content-Disposition': `attachment; filename="riedrolle-backup-${ts}.zip"`,
          'Content-Length':      zip.length
        });
        res.end(zip);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // ── POST /api/restore-data ────────────────────────────────────
    if (pathname === '/api/restore-data' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !session.permissions.includes('site')) { res.writeHead(403); res.end('Forbidden'); return; }
      try {
        const buf   = await readBodyBinary(req, 50 * 1024 * 1024);
        const files = parseZip(buf);
        if (!files.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Aucun fichier JSON trouvé dans l\'archive.' }));
          return;
        }
        let restored = 0;
        for (const { name, data } of files) {
          const basename = path.basename(name);
          if (!basename.endsWith('.json')) continue;
          try { JSON.parse(data.toString('utf8')); } catch { continue; } // skip invalid JSON
          await fs.promises.writeFile(path.join(DATA, basename), data);
          restored++;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, restored }));
      } catch (err) {
        console.error('[restore]', err.message);
        if (!res.headersSent) {
          if (err.code === 'TOO_LARGE') { res.writeHead(413); res.end('Archive trop volumineuse (max 50 Mo)'); }
          else { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })); }
        }
      }
      return;
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

_initDiscordBot();
