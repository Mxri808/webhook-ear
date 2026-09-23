const testBtn = document.getElementById('test');
const clearBtn = document.getElementById('clear');
const eventsEl = document.getElementById('events');
const emptyEl = document.getElementById('empty');
const emptyTitleEl = document.getElementById('emptyTitle');
const emptySubEl = document.getElementById('emptySub');
const countEl = document.getElementById('count');
const topCountEl = document.getElementById('topCount');
const rateCountEl = document.getElementById('rateCount');
const lastTimeEl = document.getElementById('lastTime');
const statusEl = document.getElementById('status');
const connStateEl = document.getElementById('connState');
const tabAllBtn = document.getElementById('tabAll');
const tabTopBtn = document.getElementById('tabTop');
const tabCountAllEl = document.getElementById('tabCountAll');
const tabCountTopEl = document.getElementById('tabCountTop');
const subfiltersEl = document.getElementById('subfilters');
const subAllEl = document.getElementById('subAll');
const subOkEl = document.getElementById('subOk');
const subErrEl = document.getElementById('subErr');
const subBtns = Array.from(document.querySelectorAll('.subfilter'));

const hookUrl = new URL('/hook', window.location.origin).toString();

let activeTab = 'all';
let subFilter = 'all'; // 'all' | 'ok' | 'err' (nur Tab Übersicht)
const allEntries = []; // { entry, scope, error }
const seenIds = new Set();

function setStatus(state) {
  if (state === 'online') {
    statusEl.textContent = 'Live verbunden';
    connStateEl.textContent = 'Online';
    connStateEl.style.color = 'var(--green)';
  } else if (state === 'offline') {
    statusEl.textContent = 'Verbindung getrennt';
    connStateEl.textContent = 'Offline';
    connStateEl.style.color = 'var(--red)';
  } else {
    statusEl.textContent = 'Verbinde …';
    connStateEl.textContent = '…';
    connStateEl.style.color = '';
  }
  statusEl.className = 'status ' + state;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightJson(value) {
  const json = JSON.stringify(value, null, 2);
  return escapeHtml(json).replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:');
}

/* ---------- Pokémon-Go-Event-Erkennung ---------- */

function getEventName(o) {
  return String(o.event || o.Event || o._event || o.event_type || o.type || '').toLowerCase();
}

function getIv(o) {
  if (typeof o.iv === 'number') return o.iv;
  const iv = o.individual_values || o.ivs;
  if (iv && typeof iv === 'object') {
    const a = iv.attack ?? iv.atk ?? 0;
    const d = iv.defense ?? iv.def ?? 0;
    const s = iv.stamina ?? iv.sta ?? 0;
    if (a || d || s) return Math.round(((a + d + s) / 45) * 100);
  }
  if (o.individual_attacks != null && o.individual_defense != null) {
    const total = (o.individual_attacks || 0) + (o.individual_defense || 0) + (o.individual_stamina || 0);
    if (total) return Math.round((total / 45) * 100);
  }
  if (o.perfect_iv_percent != null) return o.perfect_iv_percent;
  if (o.iv_percent != null) return o.iv_percent;
  return null;
}

function getCoords(o) {
  const lat = o.latitude ?? o.lat ?? o.coords?.latitude ?? o.coords?.lat;
  const lng = o.longitude ?? o.lng ?? o.lon ?? o.coords?.longitude ?? o.coords?.lng;
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

function looksLikePokemonGo(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const ev = getEventName(o);
  if (/pokemon|spawn|raid|gym|pokestop|quest|lure|invasion|weather|egg|stop/.test(ev)) return true;
  return (
    o.pokemon_id != null || o.pokemonName != null || o.pokemon_name != null ||
    o.cp != null || o.individual_values != null || o.raid_boss != null ||
    o.move_1 != null || o.spawnpoint_id != null || (o.pokemon != null && o.pokemon.id != null)
  );
}

function classifyKind(ev) {
  if (/raid|egg|boss/.test(ev)) return 'raid';
  if (/gym/.test(ev)) return 'gym';
  if (/quest|pokestop|stop|invasion/.test(ev)) return 'quest';
  if (/pokemon|spawn|lure|wild/.test(ev)) return 'spawn';
  if (!ev) return 'spawn';
  return 'other';
}

/* ---------- Top-Fang-Erkennung (shiny / hundo / background) ---------- */

const TOP_RE = /\bhundo\b|\bperfect\b|\bshiny\b|\bbackground\b|\b100\s*%|✨|💯|🏞️/i;

// Statistik-Zeilen entfernen, z. B. "**Shiny Pokemon caught:** 0"
// (Zahlen ≠ Fang — sonst landen Reports fälschlich in Top-Fänge)
function stripStats(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      if (/pokemon caught\s*[::]/i.test(line)) return false;
      if (/\bcaught\s*[::]\s*\d/i.test(line)) return false;
      return true;
    })
    .join('\n');
}

function isTopCatch(entry) {
  if (entry.type !== 'json' || entry.body == null) return false;
  const b = entry.body;

  if (typeof b === 'object' && !Array.isArray(b)) {
    // 1) Strukturierte Flags — zuverlässigste Quelle
    const iv = getIv(b);
    if (iv != null && Number(iv) >= 100) return true;
    if (b.shiny === true || b.is_shiny === true || b.shiny === 1) return true;
    if (b.background === true || b.has_background === true || b.is_background === true) return true;
    if (typeof b.background === 'string' && b.background) return true;
    if (b.pokemon_background || b.location_background) return true;

    // 2) Discord-Embeds: Titel/Beschreibung/Felder prüfen (ohne Statistik-Zeilen)
    if (looksLikeDiscord(b)) {
      if (b.content && TOP_RE.test(stripStats(b.content))) return true;
      const embeds = Array.isArray(b.embeds) ? b.embeds : [];
      for (const emb of embeds) {
        if (!emb) continue;
        if (TOP_RE.test(stripStats(emb.title))) return true;
        if (TOP_RE.test(stripStats(emb.description))) return true;
        for (const f of Array.isArray(emb.fields) ? emb.fields : []) {
          const name = String((f && f.name) || '');
          const value = String((f && f.value) || '');
          // Zähler (z. B. "Shiny Pokemon caught: 5") nicht als Fang werten
          if (/caught|count|collected|visited|encounters/i.test(name) && /^\s*\d/.test(value)) continue;
          if (TOP_RE.test(stripStats(name + ' ' + value))) return true;
        }
      }
      return false;
    }

    // 3) Sonstige JSON-Texte: falsche Flags (shiny:false etc.) vorher entfernen
    let s;
    try { s = JSON.stringify(b); } catch { s = String(b); }
    s = s.replace(/"(shiny|is_shiny|has_background|is_background|background)"\s*[::]\s*(false|null|0(?!\d)|"[^"]*")/gi, ' ');
    return TOP_RE.test(stripStats(s));
  }

  // Text-/Form-Body
  let s;
  try { s = JSON.stringify(b); } catch { s = String(b); }
  return TOP_RE.test(stripStats(s));
}

/* ---------- Fehler-Erkennung ---------- */

function isErrorEvent(entry) {
  if (entry.type !== 'json' || entry.body == null) return false;
  const b = entry.body;

  if (typeof b === 'object' && !Array.isArray(b)) {
    if (b.success === false || b.ok === false) return true;
    if (b.status === 'error' || b.status === 'failed' || b.status === 'fail') return true;
    if (b.error != null && b.error !== false && b.error !== '' ) return true;
    const ev = getEventName(b);
    if (/error|fail|exception|ban|crash|timeout|reject/.test(ev)) return true;
  }

  let s;
  try { s = JSON.stringify(b); } catch { s = String(b); }
  s = s.replace(/"(error|Error)"\s*:\s*(null|false|"")/g, '');

  if (/"success"\s*:\s*false|"ok"\s*:\s*false|"status"\s*:\s*"(error|failed|fail)"/i.test(s)) return true;
  if (/\berror\b|\bfailed\b|\bexception\b|\bbanned?\b|account (banned|disabled)/i.test(s)) return true;
  return false;
}

function chip(html, cls) {
  return '<span class="chip' + (cls ? ' ' + cls : '') + '">' + html + '</span>';
}

function prettyPokemon(o) {
  const ev = getEventName(o);
  const kind = classifyKind(ev);

  const name = o.pokemon_name || o.pokemonName || o.name ||
    (o.pokemon && (o.pokemon.name || o.pokemon.pokemon_name)) || null;
  const dex = o.pokemon_id ?? o.pokemonId ?? o.species_id ?? (o.pokemon && o.pokemon.id) ?? null;
  const form = o.form || (o.pokemon && o.pokemon.form) || null;

  const chips = [];

  const iv = getIv(o);
  if (iv != null) {
    const cls = iv >= 100 ? 'perfect' : iv >= 95 ? 'iv-great' : iv >= 80 ? 'iv-good' : '';
    chips.push(chip('<span class="lbl">IV</span> <b>' + escapeHtml(iv) + '%</b>', cls));
  }

  if (o.cp != null) chips.push(chip('<span class="lbl">CP</span> <b>' + escapeHtml(o.cp) + '</b>'));
  if (o.level != null || o.pokemon_level != null) {
    chips.push(chip('<span class="lbl">Lv.</span> <b>' + escapeHtml(o.level ?? o.pokemon_level) + '</b>'));
  }

  const move1 = o.move_1_name || o.move1 || o.move_1 || (o.moves && o.moves[0]) || null;
  const move2 = o.move_2_name || o.move2 || o.move_2 || (o.moves && o.moves[1]) || null;
  if (move1) chips.push(chip('<span class="lbl">Attacke</span> <b>' + escapeHtml(move1) + '</b>'));
  if (move2) chips.push(chip('<span class="lbl">Attacke</span> <b>' + escapeHtml(move2) + '</b>'));

  const shiny = o.shiny === true || o.is_shiny === true || o.shiny === 1;
  if (shiny) chips.push(chip('✨ Shiny', 'shiny'));

  const legendary = o.legendary === true || o.mythical === true || o.rarity === 'legendary' || o.rarity === 'mythical';
  if (legendary) chips.push(chip(o.mythical ? '🌟 Mythisch' : '👑 Legendär', 'legendary'));

  const bg = o.background || o.pokemon_background || o.location_background;
  if (bg) chips.push(chip('🏞️ Background', 'perfect'));

  if (o.gender) chips.push(chip(escapeHtml(o.gender)));

  const weather = o.weather || o.weather_boost;
  if (weather) chips.push(chip('☁️ ' + escapeHtml(weather)));

  const coords = getCoords(o);
  if (coords && !Number.isNaN(coords.lat)) {
    const href = 'https://www.google.com/maps?q=' + coords.lat + ',' + coords.lng;
    chips.push(chip('📍 <a href="' + href + '" target="_blank" rel="noopener">' + coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5) + '</a>'));
  }

  if (o.gym_name || o.gym || o.raid_boss) {
    const gym = o.gym_name || o.gym;
    if (gym) chips.push(chip('🏟️ <b>' + escapeHtml(gym) + '</b>'));
  }
  if (o.raid_level != null || o.raid_level_raw != null || (o.level && kind === 'raid')) {
    chips.push(chip('<span class="lbl">Raid-Lv.</span> <b>' + escapeHtml(o.raid_level ?? o.raid_level_raw ?? o.level) + '</b>'));
  }
  if (o.team) chips.push(chip('🛡️ Team: <b>' + escapeHtml(o.team) + '</b>'));
  if (o.quest || o.reward || o.field_research) {
    const q = typeof o.quest === 'object' ? JSON.stringify(o.quest) : (o.quest || o.reward || o.field_research);
    chips.push(chip('📜 <b>' + escapeHtml(q) + '</b>'));
  }

  const kindLabel = { spawn: 'Spawn', raid: 'Raid', gym: 'Gym', quest: 'Quest', other: 'Event' }[kind];
  const evBadge = '<span class="badge ' + kind + '">' + escapeHtml(kindLabel) + '</span>';

  let title = '';
  if (name || dex != null) {
    const displayName = name || ('#' + dex);
    title =
      '<div class="poke-title">' +
        '<span class="poke-name">' + escapeHtml(displayName) + '</span>' +
        (dex != null && name ? '<span class="poke-sub dex">#' + escapeHtml(dex) + '</span>' : '') +
        (form && String(form).toLowerCase() !== 'normal' && String(form) !== '0' ? '<span class="poke-sub">· ' + escapeHtml(form) + '</span>' : '') +
        (ev ? '<span class="poke-sub">· ' + escapeHtml(ev) + '</span>' : '') +
      '</div>';
  }

  if (chips.length === 0 && !title) return null;

  return { kind, html: title + '<div class="chips">' + chips.join('') + '</div>', evBadge };
}

/* ---------- Discord-Embed-Erkennung ---------- */

function looksLikeDiscord(o) {
  if (!o || typeof o !== 'object') return false;
  return o.source === 'discord' || Array.isArray(o.embeds);
}

function renderMd(text) {
  let s = escapeHtml(String(text));
  s = s.replace(/```([\s\S]*?)```/g, '<code>$1</code>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler">$1</span>');
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}

function ivClassFor(name, value) {
  if (!/iv/i.test(name)) return '';
  const m = String(value).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!m) return '';
  const n = Number(m[1]);
  const pct = n <= 1.5 ? n * 100 : n;
  if (pct >= 100) return 'perfect';
  if (pct >= 95) return 'iv-great';
  if (pct >= 80) return 'iv-good';
  return '';
}

function prettyDiscord(o) {
  const parts = [];

  if (o.author || o.channel) {
    const bits = [];
    if (o.author) bits.push('<span class="author-name">🤖 ' + escapeHtml(o.author) + '</span>');
    if (o.channel) bits.push('<span class="channel-pill">#' + escapeHtml(o.channel) + '</span>');
    parts.push('<div class="author-line">' + bits.join('') + '</div>');
  }

  if (o.content) {
    parts.push('<div class="embed-content">' + renderMd(o.content) + '</div>');
  }

  const embeds = o.embeds || [];
  let embedColor = null;

  for (const e of embeds) {
    if (e.color != null && embedColor == null) embedColor = e.color;
    const ec = e.color != null ? '#' + Number(e.color).toString(16).padStart(6, '0') : null;

    if (e.thumbnail) {
      parts.push('<img class="embed-thumb" src="' + escapeHtml(e.thumbnail) + '" alt="" loading="lazy">');
    }

    if (e.title) {
      const t = e.url
        ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="poke-name">' + renderMd(e.title) + '</span></a>'
        : '<span class="poke-name">' + renderMd(e.title) + '</span>';
      parts.push('<div class="poke-title">' + t + '</div>');
    }

    if (e.description) {
      parts.push('<div class="embed-desc"' + (ec ? ' style="border-left-color:' + ec + '"' : '') + '>' + renderMd(e.description) + '</div>');
    }

    const chips = [];

    for (const f of e.fields || []) {
      const cls = ivClassFor(f.name, f.value);
      chips.push(chip('<span class="lbl">' + renderMd(f.name) + '</span> <b>' + renderMd(f.value) + '</b>', cls));
    }

    if (e.footer) chips.push(chip(renderMd(e.footer)));
    if (e.timestamp) chips.push(chip('🕐 ' + new Date(e.timestamp).toLocaleString('de-DE')));

    if (chips.length) parts.push('<div class="chips">' + chips.join('') + '</div>');

    if (e.image) {
      parts.push('<img class="embed-img" src="' + escapeHtml(e.image) + '" alt="" loading="lazy">');
    }
  }

  if (parts.length === 0) return null;

  return { kind: 'spawn', html: parts.join(''), evBadge: '<span class="badge discord">Discord</span>', embedColor };
}

/* ---------- Anzeige ---------- */

function bodyHtml(entry) {
  const meta = entry.body;

  if (entry.type === 'json' && meta && typeof meta === 'object' && !Array.isArray(meta)) {
    if (looksLikeDiscord(meta)) {
      const d = prettyDiscord(meta);
      if (d) return d;
    }
    const pretty = looksLikePokemonGo(meta) ? prettyPokemon(meta) : null;
    if (pretty) return pretty;
    return { kind: classifyKind(getEventName(meta)), html: '<pre>' + highlightJson(meta) + '</pre>', evBadge: '' };
  }

  if (entry.type === 'json' && Array.isArray(meta)) {
    return { kind: 'other', html: '<pre>' + highlightJson(meta) + '</pre>', evBadge: '' };
  }

  if (entry.type === 'form') {
    const rows = Object.entries(meta).map(([k, v]) => '"' + k + '": "' + String(v) + '"').join(',\n');
    return { kind: 'other', html: '<pre>' + escapeHtml(rows) + '</pre>', evBadge: '' };
  }

  if (entry.type === 'text') {
    return { kind: 'other', html: '<pre>' + escapeHtml(String(meta)) + '</pre>', evBadge: '' };
  }

  return { kind: 'other', html: '<pre><i>Leerer Body</i></pre>', evBadge: '' };
}

function makeEventEl(item) {
  const entry = item.entry;
  const el = document.createElement('div');
  el.className = 'event';
  el.dataset.id = entry.id;
  if (item.scope !== 'all') el.classList.add('e-top');
  if (item.error) el.classList.add('e-error');

  const body = bodyHtml(entry);
  if (body && body.kind) el.classList.add('e-' + body.kind);
  if (body && body.embedColor != null) {
    try { el.style.borderLeftColor = '#' + Number(body.embedColor).toString(16).padStart(6, '0'); } catch {}
  }

  const statusBadge = item.error
    ? '<span class="badge error">❌ Fehler</span>'
    : '<span class="badge ok">✅ OK</span>';

  const head = document.createElement('div');
  head.className = 'event-head';
  const time = new Date(entry.time).toLocaleTimeString('de-DE');
  const typeBadge = '<span class="badge ' + escapeHtml(entry.type) + '">' + escapeHtml(entry.type) + '</span>';
  const evBadge = (entry.method === 'DISCORD' && body.evBadge) ? '' : (body.evBadge || typeBadge);

  head.innerHTML =
    '<span class="badge ' + escapeHtml((entry.method || '').toLowerCase()) + '">' + escapeHtml(entry.method || '') + '</span>' +
    statusBadge +
    evBadge +
    '<span class="event-meta"><span class="time">' + time + '</span>' +
    '<span class="id">#' + entry.id + '</span></span>';

  const contentType = entry.headers && entry.headers['content-type'];
  if (contentType) {
    const ct = document.createElement('span');
    ct.className = 'id';
    ct.textContent = contentType;
    const metaEl = head.querySelector('.event-meta');
    if (metaEl) metaEl.appendChild(ct);
    else head.appendChild(ct);
  }

  el.appendChild(head);
  el.appendChild(document.createRange().createContextualFragment(body.html));
  return el;
}

function getChannel(entry) {
  const b = entry.body;
  if (b && typeof b === 'object' && b.channel) return String(b.channel).toLowerCase().trim();
  return '';
}

function scopeOf(entry) {
  // Ein Webhook für alles: Top-Fänge landen in BEIDEN Tabs, Rest nur in der Übersicht
  return isTopCatch(entry) ? 'both' : 'all';
}

function showsInTab(scope, error) {
  if (activeTab === 'top') return scope === 'top' || scope === 'both';
  if (scope === 'top') return false;
  if (subFilter === 'ok') return !error;
  if (subFilter === 'err') return error;
  return true;
}

function updateCounters() {
  const overview = allEntries.filter((e) => e.scope === 'all' || e.scope === 'both');
  const top = allEntries.filter((e) => e.scope === 'top' || e.scope === 'both').length;
  const ok = overview.filter((e) => !e.error).length;
  const err = overview.filter((e) => e.error).length;

  countEl.textContent = String(overview.length);
  topCountEl.textContent = String(top);
  tabCountAllEl.textContent = String(overview.length);
  tabCountTopEl.textContent = String(top);
  subAllEl.textContent = String(overview.length);
  subOkEl.textContent = String(ok);
  subErrEl.textContent = String(err);
}

function updateEmptyState() {
  const visible = allEntries.filter((e) => showsInTab(e.scope, e.error)).length;
  if (visible > 0) {
    emptyEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.remove('hidden');
  if (activeTab === 'top') {
    emptyTitleEl.textContent = 'Noch keine Top-Fänge.';
    emptySubEl.textContent = '✨ Shiny, 💯 Hundos und 🏞️ Background landen automatisch hier.';
  } else if (subFilter === 'err') {
    emptyTitleEl.textContent = 'Keine Fehler — alles läuft! 🎉';
    emptySubEl.textContent = 'Fehlerhafte Events würden hier rot erscheinen.';
  } else if (subFilter === 'ok') {
    emptyTitleEl.textContent = 'Noch keine erfolgreichen Events.';
    emptySubEl.textContent = 'Nicht-Fehler erscheinen hier.';
  } else {
    emptyTitleEl.textContent = 'Noch keine Events vom Bot empfangen.';
    emptySubEl.textContent = 'Alles, was der Bot schickt, erscheint in dieser Übersicht.';
  }
}

function updateRate() {
  const now = Date.now();
  const times = allEntries
    .filter((e) => getChannel(e.entry) !== '') // nur echte Bot-/Discord-Nachrichten, keine Tests
    .map((e) => new Date(e.entry.time).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  if (times.length === 0) {
    rateCountEl.textContent = '0';
    return;
  }
  if (times.length < 2) {
    rateCountEl.textContent = '–';
    return;
  }

  const spanMs = now - times[0];
  const recent = times.filter((t) => now - t <= 3600e3).length;

  let rate;
  if (spanMs <= 3600e3) {
    // Noch keine vollen Stunde Daten vorhanden: hochrechnen
    const spanMin = Math.max(spanMs / 60000, 0.5);
    if (spanMin < 2 && times.length < 3) {
      rateCountEl.textContent = '…';
      return;
    }
    rate = Math.round(times.length * (60 / spanMin));
  } else {
    // Volle Stunde vorhanden: echte Nachrichten der letzten 60 Min.
    rate = recent;
  }
  rateCountEl.textContent = String(rate);
}

function rebuildList() {
  eventsEl.innerHTML = '';
  for (const item of allEntries) {
    if (showsInTab(item.scope, item.error)) {
      const el = makeEventEl(item);
      eventsEl.prepend(el);
    }
  }
  updateEmptyState();
}

function addEntry(entry) {
  if (entry == null || entry.id == null || seenIds.has(entry.id)) return;
  seenIds.add(entry.id);

  const item = {
    entry,
    scope: scopeOf(entry),
    error: isErrorEvent(entry),
  };
  allEntries.push(item);

  if (showsInTab(item.scope, item.error)) {
    eventsEl.prepend(makeEventEl(item));
  }

  updateCounters();
  updateRate();
  lastTimeEl.textContent = new Date(entry.time).toLocaleTimeString('de-DE');
  updateEmptyState();
}

function switchTab(tab) {
  if (activeTab === tab) return;
  activeTab = tab;
  tabAllBtn.classList.toggle('active', tab === 'all');
  tabTopBtn.classList.toggle('active', tab === 'top');
  subfiltersEl.style.display = tab === 'all' ? '' : 'none';
  rebuildList();
}

tabAllBtn.addEventListener('click', () => switchTab('all'));
tabTopBtn.addEventListener('click', () => switchTab('top'));

function setSubFilter(sub) {
  subFilter = sub;
  subBtns.forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  rebuildList();
}

subBtns.forEach((b) => b.addEventListener('click', () => setSubFilter(b.dataset.sub)));

function clearList() {
  allEntries.length = 0;
  seenIds.clear();
  eventsEl.innerHTML = '';
  updateCounters();
  updateRate();
  updateEmptyState();
  fetch('/api/messages', { method: 'DELETE' }).catch(() => {});
}

testBtn.addEventListener('click', async () => {
  await fetch(hookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'pokemon',
      pokemon_id: 149,
      pokemon_name: 'Dragoran',
      form: 'Normal',
      cp: 3120,
      level: 34,
      iv: 100,
      individual_values: { attack: 15, defense: 15, stamina: 15 },
      move_1_name: 'Drachenklaue',
      move_2_name: 'Drachenpuls',
      shiny: true,
      background: true,
      legendary: false,
      latitude: 48.13743,
      longitude: 11.57549,
      timestamp: Date.now(),
    }),
  });
});

clearBtn.addEventListener('click', clearList);

function loadHistory() {
  fetch('/api/messages')
    .then((r) => r.json())
    .then((d) => {
      (d.messages || []).forEach((m) => addEntry(m));
    })
    .catch(() => {});
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => {
    setStatus('online');
    loadHistory(); // bei (Re)Verbindung Verlauf nachziehen
  };
  es.onerror = () => { setStatus('offline'); es.close(); setTimeout(connect, 2000); };
  es.onmessage = (e) => {
    try { addEntry(JSON.parse(e.data)); } catch {}
  };
}

loadHistory();
connect();
setInterval(updateRate, 30000);
setInterval(loadHistory, 20000); // Sicherheitsnetz: Verlauf regelmäßig abgleichen