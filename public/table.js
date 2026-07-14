// Tablet page: capture a photo, send it to the hub, and watch each submission's
// status (Pending -> Approved / Declined-with-reason) plus any manager feedback.
const tableNo = Number(location.pathname.split('/')[2] || 0);

const el = (id) => document.getElementById(id);
const video = el('video');
const preview = el('preview');
const hint = el('hint');
const canvas = el('canvas');
const fileInput = el('fileInput');
const shoot = el('shoot');
const retake = el('retake');
const send = el('send');
const note = el('note');
const statusEl = el('status');
const banner = el('banner');
const subs = el('subs');

el('title').textContent = tableNo ? `Line ${tableNo}` : 'Line —';
document.title = `SnapBox — Line ${tableNo || '—'}`;

let blob = null;
let stream = null;
const items = new Map(); // post id -> { el, badge, reason, fbUl }

// ---- helpers ----
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
  return s === 'approved' ? 'Approved ✓' : s === 'declined' ? 'Declined ✗' : 'Pending';
}
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if (text) setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, 4000);
}
function showBanner(text, kind) {
  banner.textContent = text;
  banner.className = 'banner ' + kind;
  banner.hidden = false;
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 700);
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => (banner.hidden = true), 7000);
}

// ---- capture (resize in the browser before upload) ----
const MAX_DIM = 1600;
function fitDims(w, h) {
  if (w <= MAX_DIM && h <= MAX_DIM) return { w, h };
  const r = Math.min(MAX_DIM / w, MAX_DIM / h);
  return { w: Math.round(w * r), h: Math.round(h * r) };
}
function drawResized(source, sw, sh) {
  const { w, h } = fitDims(sw, sh);
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
}
function canvasToJpeg() {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}

async function initCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    video.hidden = false;
    hint.hidden = true;
  } catch {
    stream = null;
    hint.textContent = 'Tap “Take photo” to use the camera.';
    shoot.textContent = '📷 Take / choose photo';
  }
}

function showPreview(url) {
  preview.src = url;
  preview.hidden = false;
  video.hidden = true;
  hint.hidden = true;
  shoot.hidden = true;
  retake.hidden = false;
  send.disabled = false;
}
function resetCapture() {
  blob = null;
  preview.hidden = true;
  retake.hidden = true;
  shoot.hidden = false;
  send.disabled = true;
  if (stream) video.hidden = false;
  else hint.hidden = false;
}

shoot.addEventListener('click', async () => {
  if (stream && video.videoWidth) {
    drawResized(video, video.videoWidth, video.videoHeight);
    const b = await canvasToJpeg();
    if (!b) return;
    blob = b;
    showPreview(URL.createObjectURL(b));
  } else {
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = async () => {
    drawResized(img, img.naturalWidth, img.naturalHeight);
    blob = (await canvasToJpeg()) || f;
    showPreview(URL.createObjectURL(blob));
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => {
    blob = f;
    showPreview(URL.createObjectURL(f));
  };
  img.src = URL.createObjectURL(f);
});

retake.addEventListener('click', resetCapture);

send.addEventListener('click', async () => {
  if (!blob || !tableNo) return;
  send.disabled = true;
  setStatus('Sending…');
  const fd = new FormData();
  fd.append('table_no', String(tableNo));
  fd.append('note', note.value);
  fd.append('photo', blob, 'snap.jpg');
  try {
    const r = await fetch('/api/posts', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const post = await r.json();
    renderSub(post, true);
    setStatus('Sent ✓ — waiting for review', 'ok');
    note.value = '';
    resetCapture();
  } catch {
    setStatus('Failed — try again', 'err');
    send.disabled = false;
  }
});

// ---- submissions list ----
function renderSub(post, atTop) {
  if (items.has(post.id)) return;
  const empty = subs.querySelector('.empty');
  if (empty) empty.remove();

  const li = document.createElement('li');
  li.className = 'sub ' + post.status;

  const img = document.createElement('img');
  img.className = 'sub-thumb';
  img.loading = 'lazy';
  img.src = post.thumb_path;
  img.alt = 'submission';

  const body = document.createElement('div');
  body.className = 'sub-body';

  const top = document.createElement('div');
  top.className = 'sub-top';
  const badge = document.createElement('span');
  badge.className = 'badge ' + post.status;
  badge.textContent = statusLabel(post.status);
  const time = document.createElement('span');
  time.className = 'sub-time';
  time.textContent = fmtTime(post.created_at);
  top.append(badge, time);

  const noteEl = document.createElement('div');
  noteEl.className = 'sub-note' + (post.note ? '' : ' empty');
  noteEl.textContent = post.note || 'No note';

  const reason = document.createElement('div');
  reason.className = 'sub-reason';
  reason.hidden = post.status !== 'declined' || !post.decline_reason;
  if (!reason.hidden) reason.textContent = 'Declined: ' + post.decline_reason;

  const fbUl = document.createElement('ul');
  fbUl.className = 'sub-fb';
  (post.feedback || []).forEach((f) => appendFeedback(fbUl, f));

  body.append(top, noteEl, reason, fbUl);
  li.append(img, body);
  if (atTop) subs.insertBefore(li, subs.firstChild);
  else subs.appendChild(li);
  items.set(post.id, { el: li, badge, reason, fbUl });
}

function appendFeedback(fbUl, f) {
  const li = document.createElement('li');
  li.innerHTML = `<strong>${fmtTime(f.created_at)}</strong> ${escapeHtml(f.text)}`;
  fbUl.appendChild(li);
}

function applyStatus(update) {
  const it = items.get(update.id);
  if (!it) return;
  it.el.className = 'sub ' + update.status;
  it.badge.className = 'badge ' + update.status;
  it.badge.textContent = statusLabel(update.status);
  if (update.status === 'declined' && update.decline_reason) {
    it.reason.textContent = 'Declined: ' + update.decline_reason;
    it.reason.hidden = false;
  } else {
    it.reason.hidden = true;
  }
}

// ---- initial load + live updates ----
async function loadSubs() {
  try {
    const d = await (await fetch(`/api/table/${tableNo}/posts`)).json();
    (d.posts || []).forEach((p) => renderSub(p, false)); // newest-first
  } catch {
    /* ignore */
  }
}

function removeSub(id) {
  const it = items.get(id);
  if (!it) return;
  it.el.remove();
  items.delete(id);
  if (!subs.querySelector('.sub')) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing sent yet.';
    subs.appendChild(li);
  }
}

function connectStream() {
  if (!tableNo) return;
  const es = new EventSource(`/api/stream?role=table&n=${tableNo}`);
  es.addEventListener('post:new', (e) => renderSub(JSON.parse(e.data), true));
  es.addEventListener('post:deleted', (e) => removeSub(JSON.parse(e.data).id));
  es.addEventListener('post:update', (e) => {
    const u = JSON.parse(e.data);
    applyStatus(u);
    if (u.status === 'approved') showBanner('✓ A photo was approved', 'ok');
    else if (u.status === 'declined') showBanner('✗ Declined: ' + (u.decline_reason || ''), 'err');
  });
  es.addEventListener('feedback:new', (e) => {
    const f = JSON.parse(e.data);
    const it = items.get(f.post_id);
    if (it) appendFeedback(it.fbUl, f);
    showBanner('✎ New feedback from a manager', 'warn');
  });
}

initCamera();
loadSubs();
connectStream();
