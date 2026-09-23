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
const subStoppedEl = document.getElementById('subStopped');
const searchEl = document.getElementById('search');
const searchClearEl = document.getElementById('searchClear');
const searchInfoEl = document.getElementById('searchInfo');
const showMoreWrap = document.getElementById('showMoreWrap');
const showMoreBtn = document.getElementById('showMore');
const exportJsonBtn = document.getElementById('exportJson');
const exportCsvBtn = document.getElementById('exportCsv');
const modalEl = document.getElementById('modal');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalCloseBtn = document.getElementById('modalClose');
const modalBadgesEl = document.getElementById('modalBadges');
const modalContentEl = document.getElementById('modalContent');
const modalStarsEl = document.getElementById('modalStars');
const modalJsonEl = document.getElementById('modalJson');
const soundToggleEl = document.getElementById('soundToggle');
const notifToggleEl = document.getElementById('notifToggle');
const themeBtnEl = document.getElementById('themeBtn');
const accentBtnEl = document.getElementById('accentBtn');
const uptimeEl = document.getElementById('uptimeCount');
const rateSparkEl = document.getElementById('rateSpark');
const toastsEl = document.getElementById('toasts');
const subBtns = Array.from(document.querySelectorAll('.subfilter'));

const hookUrl = new URL('/hook', window.location.origin).toString();

let activeTab = 'all';
let subFilter = 'all'; // 'all' | 'ok' | 'err' | 'stopped' (nur Tab Übersicht)
let searchQuery = '';
let renderLimit = 100; // Performance: nur die letzten N Karten im DOM
let booted = false; // erst true, wenn der erste Verlauf geladen ist
const allEntries = []; // { entry, scope, error, stopped, _hay }
const seenIds = new Set();

/* ---------- Persistenz: Sterne & Favoriten ---------- */
const keyCache = new WeakMap();

function entryKey(entry) {
  if (!entry || typeof entry !== 'object') return 'x';
  if (keyCache.has(entry)) return keyCache.get(entry);
  let body = '';
  try { body = JSON.stringify(entry.body ?? null); } catch { body = String(entry.body ?? ''); }
  const s = (entry.time || '') + '|' + (entry.method || '') + '|' + body;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const key = (entry.time || '') + '-' + (h >>> 0).toString(36);
  keyCache.set(entry, key);
  return key;
}

let starsCache = null;
function starsMap() {
  if (!starsCache) {
    try { starsCache = JSON.parse(localStorage.getItem('pe_stars') || '{}'); }
    catch { starsCache = {}; }
    if (!starsCache || typeof starsCache !== 'object') starsCache = {};
  }
  return starsCache;
}
function getStars(entry) {
  return Number(starsMap()[entryKey(entry)] || 0);
}
function setStars(entry, n) {
  const m = starsMap();
  const k = entryKey(entry);
  if (!n || n <= 0) delete m[k];
  else m[k] = Math.max(1, Math.min(5, n));
  try { localStorage.setItem('pe_stars', JSON.stringify(m)); } catch {}
}

let pinsCache = null;
function pinsList() {
  if (!pinsCache) {
    try { const a = JSON.parse(localStorage.getItem('pe_pins') || '[]'); pinsCache = Array.isArray(a) ? a : []; }
    catch { pinsCache = []; }
  }
  return pinsCache;
}
function savePinsList(arr) {
  pinsCache = arr.slice(0, 50);
  try { localStorage.setItem('pe_pins', JSON.stringify(pinsCache)); } catch {}
}
function isPinned(entry) {
  const k = entryKey(entry);
  return pinsList().some((p) => entryKey(p) === k);
}
function togglePin(entry) {
  const k = entryKey(entry);
  let pins = pinsList();
  if (pins.some((p) => entryKey(p) === k)) {
    pins = pins.filter((p) => entryKey(p) !== k);
  } else {
    pins = [entry, ...pins];
  }
  savePinsList(pins);
  rebuildList();
}
function pinnedItems() {
  return pinsList().map((entry) => ({
    entry,
    scope: 'both',
    error: isErrorEvent(entry),
    stopped: isStoppedEvent(entry),
    _hay: haystack(entry),
    pinned: true,
  }));
}

/* ---------- Theme & Akzentfarbe ---------- */
const ACCENTS = ['red', 'green', 'blue', 'purple', 'amber'];

function applyAccent(name) {
  document.documentElement.dataset.accent = name;
  try { localStorage.setItem('pe_accent', name); } catch {}
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtnEl.textContent = theme === 'light' ? '☀️' : '🌗';
  try { localStorage.setItem('pe_theme', theme); } catch {}
}

themeBtnEl.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

accentBtnEl.addEventListener('click', () => {
  const cur = document.documentElement.dataset.accent || 'red';
  const idx = Math.max(0, ACCENTS.indexOf(cur));
  const next = ACCENTS[(idx + 1) % ACCENTS.length];
  applyAccent(next);
  showToast('stopped', 'Akzentfarbe', { red: '🔴 Pokéball-Rot', green: '🟢 Grün', blue: '🔵 Blau', purple: '🟣 Violett', amber: '🟡 Bernstein' }[next] || next);
});

// Theme-Icon initial setzen (Attribut kommt schon aus dem head-Script)
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
if (document.documentElement.dataset.accent) {
  document.documentElement.dataset.accent = document.documentElement.dataset.accent;
}

/* ---------- Server-Status / Uptime ---------- */
let serverStartedAt = null;

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60 ? (m % 60) + 'm' : '');
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

function updateUptime() {
  if (!uptimeEl) return;
  if (!serverStartedAt) { uptimeEl.textContent = '…'; return; }
  uptimeEl.textContent = fmtDur(Date.now() - serverStartedAt);
}

function fetchStatus() {
  fetch('/api/status')
    .then((r) => r.json())
    .then((d) => {
      if (d && d.startedAt) serverStartedAt = new Date(d.startedAt).getTime();
      updateUptime();
    })
    .catch(() => {});
}

/* ---------- Typen-Farben ---------- */
const TYPES = {
  normal: ['Normal', '⚪', '#a8a878'],
  fire: ['Feuer', '🔥', '#f08030'], feuer: ['Feuer', '🔥', '#f08030'],
  water: ['Wasser', '💧', '#6890f0'], wasser: ['Wasser', '💧', '#6890f0'],
  electric: ['Elektro', '⚡', '#f8d030'], elektro: ['Elektro', '⚡', '#f8d030'],
  grass: ['Pflanze', '🌿', '#78c850'], gras: ['Pflanze', '🌿', '#78c850'], pflanze: ['Pflanze', '🌿', '#78c850'],
  ice: ['Eis', '🧊', '#98d8d8'], eis: ['Eis', '🧊', '#98d8d8'],
  fighting: ['Kampf', '🥊', '#c03028'], kampf: ['Kampf', '🥊', '#c03028'],
  poison: ['Gift', '☠️', '#a040a0'], gift: ['Gift', '☠️', '#a040a0'],
  ground: ['Boden', '🟫', '#e0c068'], boden: ['Boden', '🟫', '#e0c068'], erde: ['Boden', '🟫', '#e0c068'],
  flying: ['Flug', '🕊️', '#a890f0'], flug: ['Flug', '🕊️', '#a890f0'],
  psychic: ['Psy', '🔮', '#f85888'],
  bug: ['Käfer', '🐛', '#a8b820'], kaefer: ['Käfer', '🐛', '#a8b820'],
  rock: ['Gestein', '🪨', '#b8a038'], stein: ['Gestein', '🪨', '#b8a038'], gestein: ['Gestein', '🪨', '#b8a038'],
  ghost: ['Geist', '👻', '#705898'],
  dragon: ['Drache', '🐉', '#7038f8'],
  dark: ['Unlicht', '🌑', '#705848'], unlicht: ['Unlicht', '🌑', '#705848'],
  steel: ['Stahl', '⚙️', '#b8b8d0'], stahl: ['Stahl', '⚙️', '#b8b8d0'],
  fairy: ['Fee', '🧚', '#ee99ac'], faerie: ['Fee', '🧚', '#ee99ac'],
};

function typeNameKey(v) {
  return String(v).toLowerCase().replace(/[^a-z]/g, '');
}

function getTypes(o) {
  let t = o.type ?? o.types ?? o.pokemon_type ?? o.type_1 ?? (o.pokemon && o.pokemon.type) ?? null;
  if (t == null) return [];
  if (Array.isArray(t)) return t.map(typeNameKey).filter(Boolean);
  if (typeof t === 'object') {
    const inner = t.name
      || (t.type && t.type.name)
      || (Object.values(t)[0] && (Object.values(t)[0].name || (Object.values(t)[0].type && Object.values(t)[0].type.name)));
    return inner ? [typeNameKey(inner)] : [];
  }
  // z. B. "Fire,Wasser" oder einzelner String
  return String(t).split(/[\s,|/]+/).map(typeNameKey).filter(Boolean);
}

/* ---------- Sparkline (Accounts der letzten 24 h) ---------- */
function updateSpark() {
  if (!rateSparkEl) return;
  const H = 24;
  const buckets = new Array(H).fill(0);
  const now = Date.now();
  for (const e of allEntries) {
    if (getChannel(e.entry) === '') continue;
    const t = new Date(e.entry.time).getTime();
    if (Number.isNaN(t)) continue;
    const idx = Math.floor((now - t) / 3600e3);
    if (idx >= 0 && idx < H) buckets[H - 1 - idx] += 1;
  }
  const max = Math.max(...buckets, 1);
  const pts = buckets.map((v, i) => {
    const x = (i / (H - 1)) * 100;
    const y = 23 - (v / max) * 21;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  rateSparkEl.innerHTML = '<polyline points="' + pts + '" fill="none" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>';
}

/* ---------- Ton, Toasts, Desktop-Hinweise, Konfetti ---------- */
let soundOn = localStorage.getItem('pe_sound') !== '0'; // Standard: an
let notifOn = localStorage.getItem('pe_notif') === '1'; // Standard: aus
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function playNotes(notes) {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  for (const [freq, delay, dur] of notes) {
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {}
  }
}

const SND_TOP = [[784, 0, 0.12], [988, 0.1, 0.12], [1319, 0.2, 0.22]];
const SND_ERR = [[233, 0, 0.18], [175, 0.16, 0.3]];
const SND_STOP = [[440, 0, 0.12], [330, 0.12, 0.2]];

function showToast(kind, title, sub) {
  if (!toastsEl) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const b = document.createElement('b');
  b.textContent = title;
  el.appendChild(b);
  if (sub) {
    const s = document.createElement('span');
    s.textContent = sub;
    el.appendChild(s);
  }
  el.addEventListener('click', () => el.remove());
  toastsEl.appendChild(el);
  setTimeout(() => el.classList.add('out'), 4000);
  setTimeout(() => el.remove(), 4500);
  while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
}

function notifyDesktop(kind, title, sub) {
  if (!notifOn || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // nur im Hintergrund
  try {
    new Notification(title, { body: sub || '', icon: '/icon-192.png', tag: 'poke-ear-' + kind });
  } catch {}
}

function updateToggleIcons() {
  soundToggleEl.textContent = soundOn ? '🔊' : '🔇';
  soundToggleEl.classList.toggle('off', !soundOn);
  notifToggleEl.textContent = notifOn ? '🔔' : '🔕';
  notifToggleEl.classList.toggle('off', !notifOn);
}

soundToggleEl.addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem('pe_sound', soundOn ? '1' : '0'); } catch {}
  updateToggleIcons();
  if (soundOn) playNotes([[880, 0, 0.1]]);
});

notifToggleEl.addEventListener('click', async () => {
  if (notifOn) {
    notifOn = false;
    try { localStorage.setItem('pe_notif', '0'); } catch {}
    updateToggleIcons();
    return;
  }
  if (typeof Notification === 'undefined') {
    showToast('stopped', 'Nicht unterstützt', 'Dein Browser kennt keine Desktop-Hinweise.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    notifOn = true;
    try { localStorage.setItem('pe_notif', '1'); } catch {}
    showToast('top', 'Desktop-Hinweise aktiv', 'Auch wenn der Tab im Hintergrund ist.');
  } else {
    showToast('err', 'Hinweise blockiert', 'Erlaube Benachrichtigungen in den Browsereinstellungen.');
  }
  updateToggleIcons();
});
updateToggleIcons();

function fireConfetti() {
  const colors = ['#ffcb05', '#e3350d', '#34d399', '#2a75bb', '#a78bfa', '#ff6b3d'];
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.3;
  for (let i = 0; i < 42; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 260;
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--cx', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--cy', Math.round(Math.sin(angle) * dist + 150) + 'px');
    p.style.setProperty('--cr', Math.round(Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = Math.round(Math.random() * 80) + 'ms';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

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

/* ---------- Stopped/Pause-Erkennung ---------- */

function isStoppedEvent(entry) {
  if (entry.type !== 'json' || entry.body == null) return false;
  const b = entry.body;

  if (typeof b === 'object' && !Array.isArray(b)) {
    if (b.stopped === true || b.paused === true || b.is_paused === true ||
        b.is_stopped === true || b.halted === true || b.is_pause === true) return true;

    const st = String(b.status ?? b.state ?? b.mode ?? '').toLowerCase().trim();
    if (/^(stopped|stop|paused|pause|halted|halt|idle)$/.test(st)) return true;

    const ev = getEventName(b);
    if (ev && !/pokestop/.test(ev) && /stop|pause|halt/.test(ev)) return true;

    const msg = String(b.message || b.reason || b.description || '');
    if (/\b(stopped|paused|gestoppt|angehalten|pausiert)\b/i.test(msg) || /\bpause\b/i.test(msg)) return true;
  }

  let s;
  try { s = typeof b === 'object' ? JSON.stringify(b) : String(b); } catch { s = String(b); }
  // false-Flags vorher entfernen (z. B. "paused": false)
  s = s.replace(/"(stopped|paused|is_paused|is_stopped|is_pause)"\s*[::]\s*(false|null|0(?!\d))/gi, ' ');
  if (/\b(stopped|paused|gestoppt|angehalten|pausiert)\b/i.test(s)) return true;
  if (/\bpause\b/i.test(s)) return true;
  return false;
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

function chip(html, cls, style) {
  return '<span class="chip' + (cls ? ' ' + cls : '') + '"' + (style ? ' style="' + style + '"' : '') + '>' + html + '</span>';
}

function prettyPokemon(o) {
  const ev = getEventName(o);
  const kind = classifyKind(ev);

  const name = o.pokemon_name || o.pokemonName || o.name ||
    (o.pokemon && (o.pokemon.name || o.pokemon.pokemon_name)) || null;
  const dex = o.pokemon_id ?? o.pokemonId ?? o.species_id ?? (o.pokemon && o.pokemon.id) ?? null;
  const form = o.form || (o.pokemon && o.pokemon.form) || null;

  const chips = [];

  for (const tk of getTypes(o)) {
    const meta = TYPES[tk];
    if (meta) {
      chips.push(
        chip(meta[1] + ' ' + escapeHtml(meta[0]), 'type-chip',
          'color:' + meta[2] + ';border-color:' + meta[2] + '88;background:' + meta[2] + '22')
      );
    } else if (tk) {
      chips.push(chip(escapeHtml(tk)));
    }
  }

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
  el.dataset.key = entryKey(entry);
  if (item.scope !== 'all') el.classList.add('e-top');
  if (item.stopped) el.classList.add('e-stopped');
  if (item.error) el.classList.add('e-error');
  if (item.pinned) el.classList.add('pinned-extra');

  const body = bodyHtml(entry);
  if (body && body.kind) el.classList.add('e-' + body.kind);
  if (body && body.embedColor != null) {
    try { el.style.borderLeftColor = '#' + Number(body.embedColor).toString(16).padStart(6, '0'); } catch {}
  }

  const statusBadge = item.error
    ? '<span class="badge error">❌ Fehler</span>'
    : item.stopped
      ? '<span class="badge paused">⏸ Stopped</span>'
      : '<span class="badge ok">✅ OK</span>';

  const head = document.createElement('div');
  head.className = 'event-head';
  const time = new Date(entry.time).toLocaleTimeString('de-DE');
  const typeBadge = '<span class="badge ' + escapeHtml(entry.type) + '">' + escapeHtml(entry.type) + '</span>';
  const evBadge = (entry.method === 'DISCORD' && body.evBadge) ? '' : (body.evBadge || typeBadge);

  const stars = getStars(entry);
  const starsHtml = stars > 0
    ? '<span class="mini-stars" title="Deine Bewertung: ' + stars + ' von 5">' + '★'.repeat(stars) + '☆'.repeat(5 - stars) + '</span>'
    : '';
  const pinned = isPinned(entry);
  const pinHtml = (item.scope !== 'all' || pinned)
    ? '<button class="pin-btn' + (pinned ? ' on' : '') + '" title="Favorit merken (bleibt auch nach Leeren/Neustart)">' + (pinned ? '📌' : '📍') + '</button>'
    : '';

  head.innerHTML =
    '<span class="badge ' + escapeHtml((entry.method || '').toLowerCase()) + '">' + escapeHtml(entry.method || '') + '</span>' +
    statusBadge +
    evBadge +
    '<span class="event-meta">' + pinHtml + starsHtml +
    '<span class="time">' + time + '</span>' +
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

function haystack(entry) {
  let body = '';
  try { body = JSON.stringify(entry.body ?? null); } catch { body = String(entry.body ?? ''); }
  return ((entry.method || '') + ' ' + (entry.type || '') + ' ' + body).toLowerCase();
}

function showsInTab(item) {
  const scope = item.scope;
  if (activeTab === 'top') {
    if (scope !== 'top' && scope !== 'both') return false;
  } else {
    if (scope === 'top') return false;
    if (subFilter === 'ok' && (item.error || item.stopped)) return false;
    if (subFilter === 'err' && !item.error) return false;
    if (subFilter === 'stopped' && !item.stopped) return false;
  }
  if (searchQuery && !(item._hay || '').includes(searchQuery)) return false;
  return true;
}

function refreshListChrome() {
  const matching = allEntries.filter(showsInTab).length;
  const rendered = eventsEl.querySelectorAll('.event:not(.pinned-extra)').length;
  const remaining = matching - rendered;
  showMoreWrap.classList.toggle('hidden', remaining <= 0);
  if (remaining > 0) {
    showMoreBtn.textContent = 'Zeige ' + Math.min(remaining, renderLimit) + ' weitere · ' + remaining + ' mehr vorhanden';
  }
  if (searchQuery) {
    searchInfoEl.textContent = matching + (matching === 1 ? ' Treffer' : ' Treffer');
    searchInfoEl.classList.remove('hidden');
    searchClearEl.classList.remove('hidden');
  } else {
    searchInfoEl.classList.add('hidden');
    searchClearEl.classList.add('hidden');
  }
}

function updateCounters() {
  const overview = allEntries.filter((e) => e.scope === 'all' || e.scope === 'both');
  const top = allEntries.filter((e) => e.scope === 'top' || e.scope === 'both').length;
  const ok = overview.filter((e) => !e.error && !e.stopped).length;
  const err = overview.filter((e) => e.error).length;
  const stopped = overview.filter((e) => e.stopped).length;

  countEl.textContent = String(overview.length);
  topCountEl.textContent = String(top);
  tabCountAllEl.textContent = String(overview.length);
  tabCountTopEl.textContent = String(top);
  subAllEl.textContent = String(overview.length);
  subOkEl.textContent = String(ok);
  subErrEl.textContent = String(err);
  subStoppedEl.textContent = String(stopped);
}

function updateEmptyState() {
  if (!booted) {
    // Beim ersten Laden liegen noch Skeletons im Feed
    emptyEl.classList.add('hidden');
    return;
  }
  const visible = allEntries.filter(showsInTab).length;
  if (visible > 0) {
    emptyEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.remove('hidden');
  if (searchQuery) {
    emptyTitleEl.textContent = 'Keine Treffer.';
    emptySubEl.textContent = 'Für „' + searchEl.value.trim() + '" wurde nichts gefunden.';
  } else if (activeTab === 'top') {
    emptyTitleEl.textContent = 'Noch keine Top-Fänge.';
    emptySubEl.textContent = '✨ Shiny, 💯 Hundos und 🏞️ Background landen automatisch hier.';
  } else if (subFilter === 'stopped') {
    emptyTitleEl.textContent = 'Keine Stop-/Pause-Meldungen.';
    emptySubEl.textContent = '⏸ Gestoppte oder pausierte Accounts würden hier erscheinen.';
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
  updateSpark();
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
  const matching = allEntries.filter(showsInTab);
  const shown = matching.slice(-renderLimit);
  eventsEl.innerHTML = '';
  for (const item of shown) {
    eventsEl.prepend(makeEventEl(item));
  }
  if (activeTab === 'top') {
    const baseKeys = new Set(shown.map((s) => entryKey(s.entry)));
    const pins = pinnedItems()
      .filter((p) => showsInTab(p) && !baseKeys.has(entryKey(p.entry)))
      .reverse(); // neuestes Pin ganz oben
    for (const p of pins) {
      eventsEl.prepend(makeEventEl(p));
    }
  }
  refreshListChrome();
  updateEmptyState();
}

function addEntry(entry) {
  if (entry == null || entry.id == null || seenIds.has(entry.id)) return;
  seenIds.add(entry.id);

  const item = {
    entry,
    scope: scopeOf(entry),
    error: isErrorEvent(entry),
    stopped: isStoppedEvent(entry),
    _hay: haystack(entry),
  };
  allEntries.push(item);

  if (showsInTab(item)) {
    if (eventsEl.children.length >= renderLimit) rebuildList();
    else eventsEl.prepend(makeEventEl(item));
    refreshListChrome();
  }

  updateCounters();
  updateRate();
  lastTimeEl.textContent = new Date(entry.time).toLocaleTimeString('de-DE');
  updateEmptyState();
  afterEntryAdded(item);
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

/* ---------- Suche ---------- */
let searchDebounce = null;

function applySearch(resetLimit) {
  searchQuery = searchEl.value.trim().toLowerCase();
  if (resetLimit) renderLimit = 100;
  rebuildList();
}

searchEl.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => applySearch(true), 150);
});
searchClearEl.addEventListener('click', () => {
  searchEl.value = '';
  applySearch(true);
  searchEl.focus();
});

showMoreBtn.addEventListener('click', () => {
  renderLimit += 400;
  rebuildList();
});

/* ---------- Export ---------- */
function downloadBlob(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function fileStamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

function titleFor(entry) {
  const b = entry.body;
  if (b && typeof b === 'object') {
    if (Array.isArray(b.embeds) && b.embeds[0] && b.embeds[0].title) return String(b.embeds[0].title);
    const n = b.pokemon_name || b.pokemonName || b.name;
    if (n) return String(n);
    if (b.content) return String(b.content).slice(0, 120);
    if (b.event) return String(b.event);
  }
  return String(b ?? '').slice(0, 120);
}

function exportJson() {
  const data = allEntries.map((e) => e.entry);
  downloadBlob('poke-ear-' + fileStamp() + '.json', 'application/json', JSON.stringify(data, null, 2));
}

function exportCsv() {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const cols = ['id', 'zeit', 'methode', 'typ', 'status', 'top', 'kanal', 'titel', 'roh'];
  const rows = [cols.map(esc).join(';')];
  for (const item of allEntries) {
    const e = item.entry;
    rows.push([
      e.id,
      e.time,
      e.method,
      e.type,
      item.error ? 'Fehler' : item.stopped ? 'Stopped' : 'OK',
      item.scope !== 'all' ? 'ja' : '',
      getChannel(e),
      titleFor(e),
      JSON.stringify(e.body ?? ''),
    ].map(esc).join(';'));
  }
  downloadBlob('poke-ear-' + fileStamp() + '.csv', 'text/csv;charset=utf-8', '\uFEFF' + rows.join('\n'));
}

exportJsonBtn.addEventListener('click', exportJson);
exportCsvBtn.addEventListener('click', exportCsv);

/* ---------- Detail-Modal ---------- */
let currentModalItem = null;

function openModal(item) {
  if (!item) return;
  currentModalItem = item;
  const entry = item.entry;
  const body = bodyHtml(entry);

  const statusBadge = item.error
    ? '<span class="badge error">❌ Fehler</span>'
    : item.stopped
      ? '<span class="badge paused">⏸ Stopped</span>'
      : '<span class="badge ok">✅ OK</span>';
  const typeBadge = '<span class="badge ' + escapeHtml(entry.type) + '">' + escapeHtml(entry.type) + '</span>';
  const evBadge = (entry.method === 'DISCORD' && body.evBadge) ? '' : (body.evBadge || typeBadge);

  modalBadgesEl.innerHTML =
    '<span class="badge ' + escapeHtml((entry.method || '').toLowerCase()) + '">' + escapeHtml(entry.method || '') + '</span>' +
    statusBadge +
    evBadge +
    '<span class="badge text">📅 ' + new Date(entry.time).toLocaleString('de-DE') + '</span>' +
    '<span class="badge text">#' + entry.id + '</span>';

  modalContentEl.innerHTML = body.html;
  modalJsonEl.innerHTML = highlightJson(entry.body);
  renderModalStars(item);
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderModalStars(item) {
  const cur = getStars(item.entry);
  modalStarsEl.innerHTML = '<span class="stars-label">Deine Bewertung:</span>';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.className = 'star-btn' + (i <= cur ? ' on' : '');
    b.textContent = '★';
    b.title = i + ' Stern' + (i > 1 ? 'e' : '') + (i === cur ? ' (klicken = entfernen)' : '');
    b.addEventListener('click', () => {
      setStars(item.entry, i === cur ? 0 : i);
      renderModalStars(item);
      rebuildList();
    });
    modalStarsEl.appendChild(b);
  }
  if (item.scope !== 'all' || isPinned(item.entry)) {
    const pin = document.createElement('button');
    const pinned = isPinned(item.entry);
    pin.className = 'btn ghost small';
    pin.style.marginLeft = '10px';
    pin.textContent = pinned ? '📌 Gemerkt' : '📍 Merken';
    pin.addEventListener('click', () => {
      togglePin(item.entry);
      renderModalStars(item);
    });
    modalStarsEl.appendChild(pin);
  }
}

function closeModal() {
  modalEl.classList.add('hidden');
  document.body.style.overflow = '';
  currentModalItem = null;
}

function itemByKey(key) {
  return allEntries.find((e) => entryKey(e.entry) === key)
    || pinnedItems().find((p) => entryKey(p.entry) === key)
    || null;
}

eventsEl.addEventListener('click', (ev) => {
  const pinBtn = ev.target.closest('.pin-btn');
  if (pinBtn) {
    const card = pinBtn.closest('.event');
    const item = card ? itemByKey(card.dataset.key) : null;
    if (item) togglePin(item.entry);
    return;
  }
  if (ev.target.closest('a, button, .mini-stars')) return;
  const card = ev.target.closest('.event');
  if (!card || !card.dataset.key) return;
  const item = itemByKey(card.dataset.key);
  if (item) openModal(item);
});

modalCloseBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) closeModal();
});

/* ---------- Nach jedem neuen Eintrag (Hooks für Etappe 2) ---------- */
function afterEntryAdded(item) {
  if (!booted) return; // kein Spam beim Laden des Verlaufs
  const title = titleFor(item.entry);
  const isTop = item.scope === 'both' || item.scope === 'top';
  if (isTop) {
    playNotes(SND_TOP);
    fireConfetti();
    showToast('top', '⭐ Top-Fang!', title);
    notifyDesktop('top', '⭐ Top-Fang!', title);
  } else if (item.error) {
    playNotes(SND_ERR);
    showToast('err', '❌ Fehler', title);
    notifyDesktop('err', '❌ Fehler', title);
  } else if (item.stopped) {
    playNotes(SND_STOP);
    showToast('stopped', '⏸ Stopped/Pause', title);
    notifyDesktop('stopped', '⏸ Stopped/Pause', title);
  }
}

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

function removeSkeletons() {
  eventsEl.querySelectorAll('.skeleton').forEach((el) => el.remove());
}

function loadHistory() {
  return fetch('/api/messages')
    .then((r) => r.json())
    .then((d) => {
      (d.messages || []).forEach((m) => addEntry(m));
    })
    .catch(() => {})
    .finally(() => {
      booted = true;
      removeSkeletons();
      updateEmptyState();
      refreshListChrome();
    });
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => {
    setStatus('online');
    loadHistory(); // bei (Re)Verbindung Verlauf nachziehen
    fetchStatus(); // Uptime nach Deploy-Neustart aktualisieren
  };
  es.onerror = () => { setStatus('offline'); es.close(); setTimeout(connect, 2000); };
  es.onmessage = (e) => {
    try { addEntry(JSON.parse(e.data)); } catch {}
  };
}

loadHistory();
connect();
fetchStatus();
setInterval(updateRate, 30000);
setInterval(loadHistory, 20000); // Sicherheitsnetz: Verlauf regelmäßig abgleichen
setInterval(updateUptime, 10000);
setInterval(fetchStatus, 300000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}