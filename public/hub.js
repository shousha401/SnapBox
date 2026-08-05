// Hub page: live board of posts grouped by line, across both production areas.
// Managers approve, decline (reason required), send feedback, or delete.
// Live over SSE.
//
// The CMP / GFF / All tabs only show and hide columns — every column is built
// once and every post is kept in the DOM, so switching tabs is instant and a
// post that lands on a hidden area still counts up on that area's tab.
//
// Delete here is an ARCHIVE — the post leaves the board but stays in the DB and
// can be found (and restored) on the History page. The supervisor-PIN gate lives
// in pin.js, shared with History.
const board = document.getElementById('board');
const tabsNav = document.getElementById('tabs');
const hubStatus = document.getElementById('hubStatus');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxDl = document.getElementById('lightboxDl');

const TAB_KEY = 'snapbox_hub_tab';
let areas = [
  { key: 'cmp', label: 'CMP', lines: 4 },
  { key: 'gff', label: 'GFF', lines: 2 },
];
let tab = localStorage.getItem(TAB_KEY) || 'all';
const cards = new Map(); // post id -> { el, fbUl, badge, reason }
const unseen = new Map(); // area key -> posts that arrived while it was hidden
const tabEls = new Map(); // tab value -> { btn, count }

const action = (method, url, body) => window.SnapBoxPin.action(method, url, body);
const areaLabel = (key) => (areas.find((a) => a.key === key) || {}).label || String(key).toUpperCase();

function setHubStatus(text, kind = '') {
  hubStatus.textContent = text;
  hubStatus.className = 'status' + (kind ? ' ' + kind : '');
  if (text) setTimeout(() => { if (hubStatus.textContent === text) hubStatus.textContent = ''; }, 3500);
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

// ---- area tabs ----
const isVisible = (areaKey) => tab === 'all' || tab === areaKey;

function buildTabs() {
  tabsNav.innerHTML = '';
  tabEls.clear();
  const defs = [{ value: 'all', label: 'All lines' }].concat(
    areas.map((a) => ({ value: a.key, label: `${a.label} Lines` }))
  );
  for (const d of defs) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = d.value;
    const name = document.createElement('span');
    name.textContent = d.label;
    const count = document.createElement('span');
    count.className = 'tab-count';
    count.hidden = true;
    btn.append(name, count);
    btn.addEventListener('click', () => selectTab(d.value));
    tabsNav.appendChild(btn);
    tabEls.set(d.value, { btn, count });
  }
}

function selectTab(value) {
  tab = value;
  localStorage.setItem(TAB_KEY, value);
  for (const a of areas) if (isVisible(a.key)) unseen.set(a.key, 0);
  applyTab();
}

function applyTab() {
  for (const [value, t] of tabEls) t.btn.classList.toggle('active', value === tab);
  for (const col of board.querySelectorAll('.col')) {
    col.hidden = !isVisible(col.dataset.area);
  }
  for (const a of areas) {
    const t = tabEls.get(a.key);
    if (!t) continue;
    const n = unseen.get(a.key) || 0;
    t.count.textContent = n > 99 ? '99+' : String(n);
    t.count.hidden = n === 0;
  }
}

// ---- board ----
function buildColumns() {
  board.innerHTML = '';
  for (const a of areas) {
    for (let i = 1; i <= a.lines; i++) {
      const col = document.createElement('section');
      col.className = 'col';
      col.dataset.area = a.key;
      col.innerHTML =
        `<h2><span class="area-pill ${a.key}">${escapeHtml(a.label)}</span> Line ${i}</h2>` +
        `<div class="col-body" id="col-${a.key}-${i}"><div class="col-empty">No posts yet.</div></div>`;
      board.appendChild(col);
    }
  }
}
function toggleEmpty(colBody) {
  const empty = colBody.querySelector('.col-empty');
  const hasCard = colBody.querySelector('.card');
  if (hasCard && empty) empty.remove();
  if (!hasCard && !empty) {
    const e = document.createElement('div');
    e.className = 'col-empty';
    e.textContent = 'No posts yet.';
    colBody.appendChild(e);
  }
}

function mkBtn(cls, label, onClick) {
  const b = document.createElement('button');
  if (cls) b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function appendFeedback(fbUl, f) {
  const li = document.createElement('li');
  li.innerHTML = `<strong>${fmtTime(f.created_at)}</strong> ${escapeHtml(f.text)}`;
  fbUl.appendChild(li);
}

function buildCard(p) {
  const line = `${areaLabel(p.area)} Line ${p.table_no}`;

  const el = document.createElement('article');
  el.className = 'card ' + p.status;
  el.dataset.id = p.id;

  const img = document.createElement('img');
  img.className = 'thumb';
  img.loading = 'lazy';
  img.src = p.thumb_path;
  img.alt = `${line} photo`;
  img.addEventListener('click', () => openLightbox(p));

  const body = document.createElement('div');
  body.className = 'body';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = 'badge ' + p.status;
  badge.textContent = p.status;
  meta.innerHTML = `<span>${fmtTime(p.created_at)}</span>`;
  meta.appendChild(badge);

  const note = document.createElement('div');
  note.className = 'note' + (p.note ? '' : ' empty');
  note.textContent = p.note || 'No note';

  const reason = document.createElement('div');
  reason.className = 'reason';
  reason.hidden = p.status !== 'declined' || !p.decline_reason;
  if (!reason.hidden) reason.textContent = 'Declined: ' + p.decline_reason;

  const fbUl = document.createElement('ul');
  fbUl.className = 'fb';
  (p.feedback || []).forEach((f) => appendFeedback(fbUl, f));

  const row1 = document.createElement('div');
  row1.className = 'row';
  row1.append(
    mkBtn('approve', '✓ Approve', () => action('POST', `/api/posts/${p.id}/approve`)),
    mkBtn('decline', '✗ Decline', () => {
      const why = prompt(`Reason for declining (${line}):`);
      if (why && why.trim()) action('POST', `/api/posts/${p.id}/decline`, { reason: why.trim() });
    })
  );

  const row2 = document.createElement('div');
  row2.className = 'row';
  row2.append(
    mkBtn('', '✎ Feedback', () => {
      const text = prompt(`Feedback to ${line}:`);
      if (text && text.trim()) action('POST', `/api/posts/${p.id}/feedback`, { text: text.trim() });
    }),
    mkBtn('danger', '🗑', () => {
      if (confirm('Remove this post from the board?\n\nIt is kept in History and can be restored.')) {
        action('DELETE', `/api/posts/${p.id}`);
      }
    })
  );

  body.append(meta, note, reason, fbUl, row1, row2);
  el.append(img, body);
  return { el, fbUl, badge, reason };
}

function renderPost(p, atTop) {
  const colBody = document.getElementById(`col-${p.area}-${p.table_no}`);
  if (!colBody || cards.has(p.id)) return;
  const card = buildCard(p);
  cards.set(p.id, card);
  if (atTop) colBody.insertBefore(card.el, colBody.firstChild);
  else colBody.appendChild(card.el);
  toggleEmpty(colBody);
}

// A post arriving live on an area you are not looking at counts up on its tab.
function onLivePost(p) {
  renderPost(p, true);
  if (!isVisible(p.area)) {
    unseen.set(p.area, (unseen.get(p.area) || 0) + 1);
    applyTab();
  }
}

function applyStatus(u) {
  const card = cards.get(u.id);
  if (!card) return;
  card.el.className = 'card ' + u.status;
  card.badge.className = 'badge ' + u.status;
  card.badge.textContent = u.status;
  if (u.status === 'declined' && u.decline_reason) {
    card.reason.textContent = 'Declined: ' + u.decline_reason;
    card.reason.hidden = false;
  } else {
    card.reason.hidden = true;
  }
}

function removeCard(id) {
  const card = cards.get(id);
  if (!card) return;
  const colBody = card.el.parentElement;
  card.el.remove();
  cards.delete(id);
  if (colBody) toggleEmpty(colBody);
}

function connect() {
  const es = new EventSource('/api/stream?role=hub');
  es.addEventListener('post:new', (e) => onLivePost(JSON.parse(e.data)));
  es.addEventListener('post:update', (e) => applyStatus(JSON.parse(e.data)));
  es.addEventListener('post:deleted', (e) => removeCard(JSON.parse(e.data).id));
  es.addEventListener('feedback:new', (e) => {
    const f = JSON.parse(e.data);
    const card = cards.get(f.post_id);
    if (card) appendFeedback(card.fbUl, f);
  });
  es.onerror = () => setHubStatus('Reconnecting…');
  es.onopen = () => setHubStatus('');
}

function openLightbox(p) {
  lightboxImg.src = p.photo_path;
  lightboxDl.href = `/api/posts/${p.id}/download`;
  lightbox.hidden = false;
}
document.getElementById('lightboxClose').addEventListener('click', () => (lightbox.hidden = true));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });

async function init() {
  let pinRequired = false;
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (cfg.areas && cfg.areas.length) areas = cfg.areas;
    pinRequired = !!cfg.pinRequired;
  } catch {
    /* defaults */
  }
  window.SnapBoxPin.init({ required: pinRequired, onStatus: setHubStatus });

  // A tab remembered from before an area was renamed or removed.
  if (tab !== 'all' && !areas.some((a) => a.key === tab)) tab = 'all';

  buildTabs();
  buildColumns();
  applyTab();

  try {
    const d = await (await fetch('/api/posts?shift=current')).json();
    (d.posts || []).forEach((p) => renderPost(p, false));
  } catch {
    setHubStatus('Could not load posts', 'err');
  }
  connect();
}
init();
