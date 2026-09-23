import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = process.env.PORT || 8080;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const CLEARED_FILE = path.join(__dirname, '.cleared.json');

const MAX_MESSAGES = 5000;
const MAX_BODY = 1024 * 1024;
const BACKFILL_CHANNELS = ['summerie', 'catch-info'];

const messages = [];
const clients = new Set();
let messageId = 0;
let backfillPromise = null;

function readClearedAt() {
  try {
    const d = JSON.parse(readFileSync(CLEARED_FILE, 'utf8'));
    return d.clearedAt ? new Date(d.clearedAt) : null;
  } catch {
    return null;
  }
}

function writeClearedAt(date) {
  try {
    writeFileSync(CLEARED_FILE, JSON.stringify({ clearedAt: date.toISOString() }));
  } catch (err) {
    console.error('clearedAt speichern fehlgeschlagen:', err.message);
  }
}

function addMessage(entry) {
  entry.id = ++messageId;
  if (!entry.time) entry.time = new Date().toISOString();
  messages.push(entry);
  while (messages.length > MAX_MESSAGES) messages.shift();
  broadcast(entry);
}

function broadcast(entry) {
  const payload = `id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      /* client wegwerfen */
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body zu gross (max. 1 MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function classify(raw, contentType) {
  const text = raw.toString('utf8').trim();
  if (!text) return { type: 'leer', body: null };

  const ct = (contentType || '').toLowerCase();
  if (ct.includes('json')) {
    try {
      return { type: 'json', body: JSON.parse(text) };
    } catch {
      return { type: 'text', body: text };
    }
  }
  if (ct.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return { type: 'form', body: obj };
  }
  try {
    return { type: 'json', body: JSON.parse(text) };
  } catch {
    return { type: 'text', body: text };
  }
}

async function serveStatic(req, res, urlPath) {
  const file = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const safe = path.basename(file);
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) return send404(res);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nicht gefunden.');
}

/* ---------- Discord-Brücke ---------- */

function discordToEntry(msg) {
  const embeds = msg.embeds.map((e) => ({
    title: e.title,
    description: e.description,
    color: e.color,
    url: e.url,
    author: e.author ? e.author.name : undefined,
    fields: (e.fields || []).map((f) => ({
      name: f.name, value: f.value, inline: f.inline,
    })),
    footer: e.footer ? e.footer.text : undefined,
    timestamp: e.timestamp,
    image: e.image ? e.image.url : undefined,
    thumbnail: e.thumbnail ? e.thumbnail.url : undefined,
  }));

  const body = {
    source: 'discord',
    channel: msg.channel.name || msg.channel.id,
    author: msg.webhookName || 'webhook',
    content: msg.content || undefined,
    embeds,
    discord_time: msg.createdAt.toISOString(),
  };

  return {
    method: 'DISCORD',
    url: '/discord/' + (msg.channel.name || msg.channel.id),
    headers: { 'content-type': 'application/json' },
    type: 'json',
    body,
    time: msg.createdAt.toISOString(),
  };
}

async function backfillFromDiscord(client, channelId) {
  const clearedAt = readClearedAt();
  const channels = [];

  if (channelId) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch) channels.push(ch);
  } else {
    client.channels.cache.forEach((ch) => {
      if (ch.isTextBased && ch.isTextBased() && BACKFILL_CHANNELS.includes(ch.name)) {
        channels.push(ch);
      }
    });
  }

  let imported = 0;
  for (const ch of channels) {
    try {
      const fetched = await ch.messages.fetch({ limit: 200 });
      const list = [...fetched.values()]
        .filter((m) => m.webhookId)
        .filter((m) => !clearedAt || m.createdAt > clearedAt)
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const m of list) {
        addMessage(discordToEntry(m));
        imported += 1;
      }
    } catch (err) {
      console.error('Backfill fehlgeschlagen für', ch.name || ch.id, err.message);
    }
  }
  console.log('Backfill fertig:', imported, 'Nachrichten aus Discord geladen,', messages.length, 'gesamt gespeichert.');
}

function startDiscordBridge() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.log('DISCORD_TOKEN nicht gesetzt – Discord-Brücke deaktiviert.');
    return;
  }

  import('discord.js').then(({ Client, GatewayIntentBits }) => {
    const channelId = process.env.DISCORD_CHANNEL_ID || null;
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.once('ready', () => {
      console.log('Discord-Brücke online als', client.user.tag,
        channelId ? '(Kanal-Filter: ' + channelId + ')' : '(alle Kanäle)');
      backfillPromise = backfillFromDiscord(client, channelId).catch((err) => {
        console.error('Backfill Fehler:', err.message);
      });
    });

    client.on('messageCreate', (msg) => {
      try {
        if (channelId && msg.channel.id !== channelId) return;
        if (!msg.webhookId) return; // nur Webhook-Nachrichten (vom Pokémon-Go-Bot)

        const clearedAt = readClearedAt();
        if (clearedAt && msg.createdAt <= clearedAt) return;

        addMessage(discordToEntry(msg));
      } catch (err) {
        console.error('Discord-Brücke Fehler:', err);
      }
    });

    client.login(token).catch((err) => {
      console.error('Discord-Login fehlgeschlagen:', err.message);
    });
  }).catch((err) => {
    console.error('discord.js konnte nicht geladen werden:', err.message);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/events' && req.method === 'GET') {
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }

  if (p === '/api/messages' && req.method === 'GET') {
    if (backfillPromise) {
      try { await backfillPromise; } catch { /* Fehler egal, Rest zeigen */ }
    }
    json(res, 200, { messages });
    return;
  }

  if (p === '/api/messages' && req.method === 'DELETE') {
    messages.length = 0;
    writeClearedAt(new Date());
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/hook') {
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const entry = {
          method: 'POST',
          url: url.pathname,
          headers: req.headers,
          ...classify(raw, req.headers['content-type']),
        };
        addMessage(entry);
        json(res, 200, { ok: true, id: entry.id, received: entry.time });
      } catch (err) {
        json(res, 413, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'GET') {
      json(res, 200, { ok: true, hint: 'Diese URL erwartet POST-Anfragen von deinem Webhook-Dienst.' });
      return;
    }
  }

  if (req.method === 'GET') {
    const served = await serveStatic(req, res, p);
    if (served) return;
  }

  send404(res);
});

server.listen(PORT, () => {
  console.log(`Webhook-Ear laeuft auf http://localhost:${PORT}`);
  console.log(`Webhook-URL: http://localhost:${PORT}/hook`);
  startDiscordBridge();
});