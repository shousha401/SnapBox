// Hub page: live board of posts grouped by table. Supervisors approve, decline
// (with a required reason), send feedback, or delete. Live over SSE; PIN-gated.
const board = document.getElementById('board');
const pinInput = document.getElementById('pin');
const hubStatus = document.getElementById('hubStatus');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

let tableCount = 4;
const cards = new Map(); // post id -> { el, fbUl, badge, reason }

pinInput.value = sessionStorage.getItem('snapbox_pin') || '';
pinInput.addEventListener('input', () => sessionStorage.setItem('snapbox_pin', pinInput.value));

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
function statusLabel(s) {
  return s === 'approved' ? 'approved' : s === 'declined' ? 'declined' : 'pending';
}

async function action(method, url, body) {
  const headers = {};
  const p = pinInput.value.trim();
  if (p) headers['x-snapbox-pin'] = p;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) {
    setHubStatus('Enter the supervisor PIN', 'err');
    pinInput.focus();
    throw new Error('pin');
  }
  if (!r.ok) {
    setHubStatus('Action failed', 'err');
    throw new Error('http ' + r.status);
  }
  return r.json();
}

function buildColumns() {
  board.innerHTML = '';
  for (let i = 1; i <= tableCount; i++) {
    const col = document.createElement('section');
    col.className = 'col';
    col.innerHTML = `<h2>Line ${i}</h2><div class="col-body" id="col-${i}"><div class="col-empty">No posts yet.</div></div>`;
    board.appendChild(col);
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

function buildCard(p) {
  const el = document.createElement('article');
  el.className = 'card ' + p.status;
  el.dataset.id = p.id;

  const img = document.createElement('img');
  img.className = 'thumb';
  img.loading = 'lazy';
  img.src = p.thumb_path;
  img.alt = `Line ${p.table_no} photo`;
  img.addEventListener('click', () => openLightbox(p.photo_path));

  const body = document.createElement('div');
  body.className = 'body';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = 'badge ' + p.status;
  badge.textContent = statusLabel(p.status);
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
  const approve = mkBtn('approve', '✓ Approve', () =>
    action('POST', `/api/posts/${p.id}/approve`).catch(() => {})
  );
  const decline = mkBtn('decline', '✗ Decline', () => {
    const reasonText = prompt(`Reason for declining (Line ${p.table_no}):`);
    if (reasonText && reasonText.trim()) {
      action('POST', `/api/posts/${p.id}/decline`, { reason: reasonText.trim() }).catch(() => {});
    }
  });
  row1.append(approve, decline);

  const row2 = document.createElement('div');
  row2.className = 'row';
  const fb = mkBtn('', '✎ Feedback', () => {
    const text = prompt(`Feedback to Line ${p.table_no}:`);
    if (text && text.trim()) {
      action('POST', `/api/posts/${p.id}/feedback`, { text: text.trim() }).catch(() => {});
    }
  });
  const del = mkBtn('danger', '🗑', () => {
    if (confirm('Delete this post?')) action('DELETE', `/api/posts/${p.id}`).catch(() => {});
  });
  row2.append(fb, del);

  body.append(meta, note, reason, fbUl, row1, row2);
  el.append(img, body);
  return { el, fbUl, badge, reason };
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

function renderPost(p, atTop) {
  const colBody = document.getElementById('col-' + p.table_no);
  if (!colBody || cards.has(p.id)) return;
  const card = buildCard(p);
  cards.set(p.id, card);
  if (atTop) colBody.insertBefore(card.el, colBody.firstChild);
  else colBody.appendChild(card.el);
  toggleEmpty(colBody);
}

function applyStatus(u) {
  const card = cards.get(u.id);
  if (!card) return;
  card.el.className = 'card ' + u.status;
  card.badge.className = 'badge ' + u.status;
  card.badge.textContent = statusLabel(u.status);
  if (u.status === 'declined' && u.decline_reason) {
    card.reason.textContent = 'Declined: ' + u.decline_reason;
    card.reason.hidden = false;
  } else {
    card.reason.hidden = true;
  }
}

function connect() {
  const es = new EventSource('/api/stream?role=hub');
  es.addEventListener('post:new', (e) => renderPost(JSON.parse(e.data), true));
  es.addEventListener('post:update', (e) => applyStatus(JSON.parse(e.data)));
  es.addEventListener('post:deleted', (e) => {
    const { id } = JSON.parse(e.data);
    const card = cards.get(id);
    if (card) {
      const colBody = card.el.parentElement;
      card.el.remove();
      cards.delete(id);
      if (colBody) toggleEmpty(colBody);
    }
  });
  es.addEventListener('feedback:new', (e) => {
    const f = JSON.parse(e.data);
    const card = cards.get(f.post_id);
    if (card) appendFeedback(card.fbUl, f);
  });
  es.onerror = () => setHubStatus('Reconnecting…');
  es.onopen = () => setHubStatus('');
}

function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.hidden = false;
}
document.getElementById('lightboxClose').addEventListener('click', () => (lightbox.hidden = true));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });

async function init() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    tableCount = cfg.tableCount || 4;
  } catch {
    /* defaults */
  }
  buildColumns();
  try {
    const d = await (await fetch('/api/posts?shift=current')).json();
    (d.posts || []).forEach((p) => renderPost(p, false));
  } catch {
    setHubStatus('Could not load posts', 'err');
  }
  connect();
}
init();
