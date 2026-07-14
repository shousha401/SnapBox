// History page (managers): browse past photos by date, filter by line + status.
// Read-only — the live board at /hub is where you act on things.
const dateInput = document.getElementById('date');
const lineSel = document.getElementById('line');
const statusSel = document.getElementById('status');
const days = document.getElementById('days');
const summary = document.getElementById('summary');
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxDl = document.getElementById('lightboxDl');

let posts = []; // everything loaded for the selected date

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// ---- day chips ----
async function loadDays() {
  try {
    const d = await (await fetch('/api/history/dates')).json();
    days.innerHTML = '';
    (d.dates || []).slice(0, 14).forEach((row) => {
      const b = document.createElement('button');
      b.className = 'day-chip';
      b.dataset.date = row.date;
      b.innerHTML =
        `<span class="day-date">${prettyDate(row.date)}</span>` +
        `<span class="day-count">${row.total} photo${row.total === 1 ? '' : 's'}</span>`;
      b.addEventListener('click', () => {
        dateInput.value = row.date;
        load();
      });
      days.appendChild(b);
    });
    markActiveDay();
  } catch {
    /* ignore */
  }
}
function markActiveDay() {
  days.querySelectorAll('.day-chip').forEach((b) => {
    b.classList.toggle('active', b.dataset.date === dateInput.value);
  });
}

// ---- cards ----
function buildCard(p) {
  const el = document.createElement('article');
  el.className = 'card ' + p.status;

  const img = document.createElement('img');
  img.className = 'thumb';
  img.loading = 'lazy';
  img.src = p.thumb_path;
  img.alt = `Line ${p.table_no} photo`;
  img.addEventListener('click', () => {
    lightboxImg.src = p.photo_path;
    lightboxDl.href = `/api/posts/${p.id}/download`;
    lightbox.hidden = false;
  });

  const body = document.createElement('div');
  body.className = 'body';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<span><strong>Line ${p.table_no}</strong> · ${fmtTime(p.created_at)}</span>`;
  const badge = document.createElement('span');
  badge.className = 'badge ' + p.status;
  badge.textContent = p.status;
  meta.appendChild(badge);

  const note = document.createElement('div');
  note.className = 'note' + (p.note ? '' : ' empty');
  note.textContent = p.note || 'No note';

  body.append(meta, note);

  if (p.status === 'declined' && p.decline_reason) {
    const reason = document.createElement('div');
    reason.className = 'reason';
    reason.textContent = 'Declined: ' + p.decline_reason;
    body.appendChild(reason);
  }

  if (p.feedback && p.feedback.length) {
    const ul = document.createElement('ul');
    ul.className = 'fb';
    p.feedback.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${fmtTime(f.created_at)}</strong> ${escapeHtml(f.text)}`;
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  const row = document.createElement('div');
  row.className = 'row';
  const dl = document.createElement('a');
  dl.className = 'dl-btn';
  dl.href = `/api/posts/${p.id}/download`;
  dl.textContent = '⬇ Download';
  row.appendChild(dl);
  body.appendChild(row);

  el.append(img, body);
  return el;
}

// ---- render ----
function render() {
  const line = lineSel.value;
  const status = statusSel.value;
  const shown = posts.filter(
    (p) => (!line || String(p.table_no) === line) && (!status || p.status === status)
  );

  grid.innerHTML = '';
  shown.forEach((p) => grid.appendChild(buildCard(p)));
  empty.hidden = shown.length > 0;

  const count = (s) => posts.filter((p) => p.status === s).length;
  summary.innerHTML = posts.length
    ? `<strong>${posts.length}</strong> photo${posts.length === 1 ? '' : 's'} on ${prettyDate(dateInput.value)}` +
      ` · <span class="pill approved">${count('approved')} approved</span>` +
      ` <span class="pill declined">${count('declined')} declined</span>` +
      ` <span class="pill pending">${count('pending')} pending</span>` +
      (shown.length !== posts.length ? ` · showing ${shown.length}` : '')
    : '';
}

async function load() {
  markActiveDay();
  try {
    const d = await (await fetch(`/api/history?date=${encodeURIComponent(dateInput.value)}`)).json();
    posts = d.posts || [];
  } catch {
    posts = [];
  }
  render();
}

// ---- boot ----
document.getElementById('lightboxClose').addEventListener('click', () => (lightbox.hidden = true));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });
dateInput.addEventListener('change', load);
lineSel.addEventListener('change', render);
statusSel.addEventListener('change', render);

async function init() {
  let tableCount = 4;
  try {
    const cfg = await (await fetch('/api/config')).json();
    tableCount = cfg.tableCount || 4;
  } catch {
    /* default */
  }
  for (let i = 1; i <= tableCount; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Line ${i}`;
    lineSel.appendChild(o);
  }
  dateInput.value = todayStr();
  await loadDays();
  await load();
}
init();
