// Tablet page: capture a photo (live camera, or file-input fallback),
// attach a note, send it to the hub, and show feedback that comes back.
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
const fbList = el('fbList');

el('title').textContent = tableNo ? `Table ${tableNo}` : 'Table —';
document.title = `SnapBox — Table ${tableNo || '—'}`;

let blob = null;
let stream = null;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if (text) {
    setTimeout(() => {
      if (statusEl.textContent === text) statusEl.textContent = '';
    }, 4000);
  }
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
    // No camera / permission denied -> fall back to the device photo picker.
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
  if (stream) {
    video.hidden = false;
  } else {
    hint.hidden = false;
  }
}

shoot.addEventListener('click', () => {
  if (stream && video.videoWidth) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (b) => {
        if (!b) return;
        blob = b;
        showPreview(URL.createObjectURL(b));
      },
      'image/jpeg',
      0.9
    );
  } else {
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) {
    blob = f;
    showPreview(URL.createObjectURL(f));
  }
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
    setStatus('Sent ✓', 'ok');
    note.value = '';
    resetCapture();
  } catch {
    setStatus('Failed — try again', 'err');
    send.disabled = false;
  }
});

// ---- feedback ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function addFeedback(item, flashScreen) {
  const emptyLi = fbList.querySelector('.empty');
  if (emptyLi) emptyLi.remove();
  const li = document.createElement('li');
  const t = new Date(item.created_at);
  const time = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span class="fb-time">${time}</span>${escapeHtml(item.text)}`;
  fbList.prepend(li);
  if (flashScreen) {
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 700);
  }
}

async function loadFeedback() {
  try {
    const r = await fetch(`/api/table/${tableNo}/feedback`);
    const d = await r.json();
    (d.feedback || []).forEach((f) => addFeedback(f, false));
  } catch {
    /* ignore */
  }
}

function connectStream() {
  if (!tableNo) return;
  const es = new EventSource(`/api/stream?role=table&n=${tableNo}`);
  es.addEventListener('feedback:new', (e) => {
    try {
      addFeedback(JSON.parse(e.data), true);
    } catch {
      /* ignore */
    }
  });
}

initCamera();
loadFeedback();
connectStream();
