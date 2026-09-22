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

function highlightJson(value) {
  const json = JSON.stringify(value, null, 2);
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:');
}

function bodyHtml(entry) {
  const meta = entry.body;
  if (entry.type === 'json') {
    return '<pre class="json">' + highlightJson(meta) + '</pre>';
  }
  if (entry.type === 'form') {
    const rows = Object.entries(meta).map(([k, v]) => {
      return `"${k}": "${String(v)}"`;
    }).join(',\n');
    return '<pre>' + rows + '</pre>';
  }
  if (entry.type === 'text') {
    return '<pre>' + escapeHtml(String(meta)) + '</pre>';
  }
  return '<pre><i>Leerer Body</i></pre>';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(entry) {
  const el = document.createElement('div');
  el.className = 'event';
  el.dataset.id = entry.id;

  const head = document.createElement('div');
  head.className = 'event-head';
  const time = new Date(entry.time).toLocaleTimeString();
  head.innerHTML =
    '<span class="badge ' + (entry.method || '').toLowerCase() + '">' + escapeHtml(entry.method || '') + '</span>' +
    '<span class="badge ' + entry.type + '">' + escapeHtml(entry.type) + '</span>' +
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
  el.appendChild(document.createRange().createContextualFragment(bodyHtml(entry)));
  eventsEl.prepend(el);

  count += 1;
  countEl.textContent = String(count);
  lastTimeEl.textContent = new Date(entry.time).toLocaleTimeString('de-DE');
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
    body: JSON.stringify({ event: 'test', message: 'Hallo vom Test-Button', timestamp: Date.now() }),
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