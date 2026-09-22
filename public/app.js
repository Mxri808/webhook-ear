const urlInput = document.getElementById('url');
const copyBtn = document.getElementById('copy');
const testBtn = document.getElementById('test');
const clearBtn = document.getElementById('clear');
const eventsEl = document.getElementById('events');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const lastTimeEl = document.getElementById('lastTime');
const connStateEl = document.getElementById('connState');

const hookUrl = new URL('/hook', window.location.origin).toString();
urlInput.value = hookUrl;

let count = 0;

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
  if (o.individual_attacks && o.individual_defense != null) {
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
    o.move_1 != null || o.spawnpoint_id != null || o.pokemon != null && o.pokemon.id != null
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

  const gender = o.gender;
  if (gender) chips.push(chip(escapeHtml(gender)));

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
  if (o.raid_level || o.raid_level_raw != null || o.level && kind === 'raid') {
    chips.push(chip('<span class="lbl">Raid-Lv.</span> <b>' + escapeHtml(o.raid_level ?? o.raid_level_raw ?? o.level) + '</b>'));
  }
  if (o.team) chips.push(chip('🛡️ Team: <b>' + escapeHtml(o.team) + '</b>'));
  if (o.quest || o.reward || o.field_research) {
    const q = typeof o.quest === 'object' ? JSON.stringify(o.quest) : (o.quest || o.reward || o.field_research);
    chips.push(chip('📜 <b>' + escapeHtml(q) + '</b>'));
  }

  const kindLabel = { spawn: 'Spawn', raid: 'Raid', gym: 'Gym', quest: 'Quest', other: 'Event' }[kind];
  const evBadge = ev
    ? '<span class="badge ' + kind + '">' + escapeHtml(kindLabel) + '</span>'
    : '<span class="badge ' + kind + '">' + escapeHtml(kindLabel) + '</span>';

  let title = '';
  if (name || dex != null) {
    const displayName = name || ('#' + dex);
    title =
      '<div class="poke-title">' +
        '<span class="poke-name">' + escapeHtml(displayName) + '</span>' +
        (dex != null && name ? '<span class="poke-sub">#' + escapeHtml(dex) + '</span>' : '') +
        (form && String(form).toLowerCase() !== 'normal' && String(form) !== '0' ? '<span class="poke-sub">· ' + escapeHtml(form) + '</span>' : '') +
        (ev ? '<span class="poke-sub">· ' + escapeHtml(ev) + '</span>' : '') +
      '</div>';
  }

  if (chips.length === 0 && !title) return null;

  return {
    kind,
    html: title + '<div class="chips">' + chips.join('') + '</div>',
    evBadge,
  };
}

/* ---------- Discord-Embed-Erkennung ---------- */

function looksLikeDiscord(o) {
  if (!o || typeof o !== 'object') return false;
  return o.source === 'discord' || Array.isArray(o.embeds);
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

  if (o.author || o.content || o.channel) {
    const metaBits = [];
    if (o.author) metaBits.push('🤖 ' + escapeHtml(o.author));
    if (o.channel) metaBits.push('#' + escapeHtml(o.channel));
    if (metaBits.length) {
      parts.push('<div class="poke-sub" style="margin-bottom:8px">' + metaBits.join(' · ') + '</div>');
    }
  }

  if (o.content) {
    parts.push('<div class="poke-title"><span class="poke-name">' + escapeHtml(o.content) + '</span></div>');
  }

  const embeds = o.embeds || [];
  let embedColor = null;

  for (const e of embeds) {
    if (e.color != null && embedColor == null) embedColor = e.color;

    if (e.title) {
      const t = e.url
        ? '<a href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="poke-name">' + escapeHtml(e.title) + '</span></a>'
        : '<span class="poke-name">' + escapeHtml(e.title) + '</span>';
      parts.push('<div class="poke-title">' + t + '</div>');
    }

    if (e.description) {
      parts.push('<div class="poke-sub" style="margin-bottom:10px;white-space:pre-wrap;line-height:1.5">' + escapeHtml(e.description) + '</div>');
    }

    const chips = [];

    for (const f of e.fields || []) {
      const cls = ivClassFor(f.name, f.value);
      chips.push(chip('<span class="lbl">' + escapeHtml(f.name) + '</span> <b>' + escapeHtml(f.value) + '</b>', cls));
    }

    if (e.footer) chips.push(chip(escapeHtml(e.footer)));
    if (e.timestamp) chips.push(chip('🕐 ' + new Date(e.timestamp).toLocaleString('de-DE')));
    if (e.thumbnail) chips.push(chip('🖼️ <a href="' + escapeHtml(e.thumbnail) + '" target="_blank" rel="noopener">Vorschaubild</a>'));
    if (e.image) chips.push(chip('🖼️ <a href="' + escapeHtml(e.image) + '" target="_blank" rel="noopener">Bild</a>'));

    if (chips.length) parts.push('<div class="chips">' + chips.join('') + '</div>');
  }

  if (parts.length === 0) return null;

  return {
    kind: 'spawn',
    html: parts.join(''),
    evBadge: '<span class="badge discord">Discord</span>',
    embedColor,
  };
}

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

function render(entry) {
  const el = document.createElement('div');
  el.className = 'event';
  el.dataset.id = entry.id;

  const body = bodyHtml(entry);
  if (body && body.kind) el.classList.add('e-' + body.kind);
  if (body && body.embedColor != null) {
    try { el.style.borderLeftColor = '#' + Number(body.embedColor).toString(16).padStart(6, '0'); } catch {}
  }

  const head = document.createElement('div');
  head.className = 'event-head';
  const time = new Date(entry.time).toLocaleTimeString('de-DE');
  head.innerHTML =
    '<span class="badge ' + escapeHtml((entry.method || '').toLowerCase()) + '">' + escapeHtml(entry.method || '') + '</span>' +
    (body.evBadge || '<span class="badge ' + escapeHtml(entry.type) + '">' + escapeHtml(entry.type) + '</span>') +
    '<span class="time">' + time + '</span>' +
    '<span class="id">#' + entry.id + '</span>';

  const contentType = entry.headers && entry.headers['content-type'];
  if (contentType) {
    const ct = document.createElement('span');
    ct.className = 'id';
    ct.textContent = contentType;
    head.appendChild(ct);
  }

  el.appendChild(head);
  el.appendChild(document.createRange().createContextualFragment(body.html));
  eventsEl.prepend(el);

  count += 1;
  countEl.textContent = String(count);
  lastTimeEl.textContent = time;
  emptyEl.classList.add('hidden');
}

function clearList() {
  eventsEl.innerHTML = '';
  count = 0;
  countEl.textContent = '0';
  emptyEl.classList.remove('hidden');
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(hookUrl);
  copyBtn.textContent = 'Kopiert ✓';
  setTimeout(() => { copyBtn.textContent = 'Kopieren'; }, 1500);
});

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
      iv: 98,
      individual_values: { attack: 15, defense: 15, stamina: 14 },
      move_1_name: 'Drachenklaue',
      move_2_name: 'Drachenpuls',
      shiny: true,
      legendary: false,
      latitude: 48.13743,
      longitude: 11.57549,
      timestamp: Date.now(),
    }),
  });
});

clearBtn.addEventListener('click', clearList);

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => setStatus('online');
  es.onerror = () => { setStatus('offline'); es.close(); setTimeout(connect, 2000); };
  es.onmessage = (e) => {
    try { render(JSON.parse(e.data)); } catch {}
  };
}

connect();