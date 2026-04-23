'use strict';
const {
  Client,
  GatewayIntentBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  EmbedBuilder
} = require('discord.js');
const http = require('http');
const fs   = require('fs');
const path = require('path');

/* ── Config ───────────────────────────────────────────────────────── */
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch {
  console.warn('⚠  config.json introuvable — utilisation des variables d\'environnement uniquement');
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN  || config.token         || '';
const GUILD_ID  = process.env.DISCORD_GUILD_ID   || config.guildId       || '';
const SECRET    = process.env.BOT_WEBHOOK_SECRET || config.webhookSecret || '';
const BOT_PORT  = parseInt(process.env.BOT_PORT  || config.port          || '3001', 10);
const CHANNELS  = config.channels || {};

if (!BOT_TOKEN || !GUILD_ID) {
  console.error('✗  DISCORD_BOT_TOKEN et DISCORD_GUILD_ID sont requis');
  process.exit(1);
}

/* ── Client Discord ───────────────────────────────────────────────── */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ── Utilitaires ──────────────────────────────────────────────────── */
function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) reject(new Error('Too large'));
    });
    req.on('end',   () => resolve(body));
    req.on('error', reject);
  });
}

async function fetchChannel(topic, sub = null) {
  let entry = CHANNELS[topic];
  if (!entry) return null;
  // Si c'est un objet catégorisé (ex: blog), on cherche par sous-clé puis default
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    entry = (sub && entry[sub]) || entry.default || null;
  }
  if (!entry) return null;
  try {
    const ch = await client.channels.fetch(entry);
    return ch?.isTextBased() ? ch : null;
  } catch { return null; }
}

const COLOR = 0xe8a020;

const NOTIFY_ICONS = {
  event_added:       '📅', event_modified:    '📅', event_deleted:     '🗑️',
  table_added:       '🪑', table_cancelled:   '❌', table_reactivated: '✅',
  game_added:        '🎲', game_modified:     '🎲', game_deleted:      '🗑️',
  blog_added:        '📝', blog_modified:     '📝', blog_deleted:      '🗑️',
};

const BLOG_CAT_ICONS = {
  'annonce':        '📢',
  'critique':       '🎮',
  'evenement':      '🎉',
  'conseil-mj':     '📜',
  'conseil-joueur': '🎲',
  'photos':         '📷',
  'vie-asso':       '🏠',
  'compte-rendu':   '📖',
  'bons-plans':     '💡',
};

/* ── Serveur HTTP interne ─────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    if (SECRET && req.headers['x-bot-secret'] !== SECRET) {
      return json(401, { ok: false, error: 'Unauthorized' });
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    const body     = JSON.parse(await readBody(req));
    const pathname = new URL(req.url, `http://localhost:${BOT_PORT}`).pathname;
    const guild    = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      return json(503, { ok: false, error: 'Guild introuvable — bot non connecté ou non membre du serveur' });
    }

    /* POST /bot/event — créer un événement planifié Discord ──────── */
    if (pathname === '/bot/event') {
      const { name, description, startIso, endIso, location } = body;
      if (!name || !startIso) return json(400, { ok: false, error: 'name et startIso requis' });

      const event = await guild.scheduledEvents.create({
        name:               String(name).slice(0, 100),
        description:        description ? String(description).slice(0, 1000) : undefined,
        scheduledStartTime: new Date(startIso),
        scheduledEndTime:   endIso ? new Date(endIso) : undefined,
        privacyLevel:       GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType:         GuildScheduledEventEntityType.External,
        entityMetadata:     { location: String(location || 'Lieu à confirmer').slice(0, 100) }
      });

      console.log(`[bot] Événement créé : "${event.name}" (${event.id})`);
      return json(200, {
        ok: true,
        eventId: event.id,
        url: `https://discord.com/events/${GUILD_ID}/${event.id}`
      });
    }

    /* POST /bot/blog — annoncer un article de blog (routage par catégorie) */
    if (pathname === '/bot/blog') {
      const { title, excerpt, author, imageUrl, siteUrl, category } = body;
      if (!title) return json(400, { ok: false, error: 'title requis' });

      const ch = await fetchChannel('blog', category || null);
      if (!ch) return json(400, { ok: false, error: `Salon blog "${category || 'default'}" non configuré dans config.json` });

      const embed = new EmbedBuilder()
        .setTitle(String(title).slice(0, 256))
        .setColor(COLOR)
        .setTimestamp();
      if (excerpt)  embed.setDescription(String(excerpt).slice(0, 4096));
      if (author)   embed.setAuthor({ name: String(author).slice(0, 256) });
      if (imageUrl) embed.setImage(imageUrl);
      if (siteUrl)  embed.setURL(siteUrl);

      const catIcon = BLOG_CAT_ICONS[category] || '📝';
      const msg = await ch.send({ content: `${catIcon} **Nouvel article de blog !**`, embeds: [embed] });
      console.log(`[bot] Article blog posté dans #${ch.name} (catégorie=${category || 'default'}, msg ${msg.id})`);
      return json(200, { ok: true, messageId: msg.id });
    }

    /* POST /bot/announce — notification générique dans un salon ──── */
    if (pathname === '/bot/announce') {
      const { topic, type, title, details, url } = body;
      if (!topic) return json(400, { ok: false, error: 'topic requis' });

      const ch = await fetchChannel(topic);
      if (!ch) return json(400, { ok: false, error: `Salon "${topic}" non configuré dans config.json` });

      const icon = NOTIFY_ICONS[type] || '🔔';
      const embed = new EmbedBuilder()
        .setTitle(`${icon} ${String(title || 'Notification').slice(0, 256)}`)
        .setColor(COLOR)
        .setTimestamp();
      if (url) embed.setURL(url);
      if (Array.isArray(details) && details.length) {
        embed.setDescription(details.map(d => `• ${d}`).join('\n').slice(0, 4096));
      }

      const msg = await ch.send({ embeds: [embed] });
      console.log(`[bot] Annonce postée dans #${ch.name} (topic=${topic}, type=${type})`);
      return json(200, { ok: true, messageId: msg.id });
    }

    res.writeHead(404); res.end();
  } catch (err) {
    console.error('[bot-http]', err.message);
    if (!res.headersSent) json(500, { ok: false, error: err.message });
  }
});

/* ── Démarrage ────────────────────────────────────────────────────── */
client.once('ready', () => {
  console.log(`✓  Bot Discord connecté : ${client.user.tag}`);
  server.listen(BOT_PORT, '127.0.0.1', () => {
    console.log(`✓  Serveur interne → http://127.0.0.1:${BOT_PORT}`);
    console.log(`   Endpoints : POST /bot/event  /bot/blog  /bot/announce`);
  });
});

client.on('error', err => console.error('[discord.js]', err.message));

client.login(BOT_TOKEN).catch(err => {
  console.error('✗  Connexion Discord échouée :', err.message);
  process.exit(1);
});
