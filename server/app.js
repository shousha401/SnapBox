import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { shiftIdFor } from './shift.js';
import { createBroker } from './sse.js';
import { savePhoto } from './storage.js';

/**
 * Build the SnapBox Express app. Everything it needs is injected, so tests can
 * pass an in-memory db, a temp uploads dir, a fixed clock, and a known PIN.
 *
 * @param {object} opts
 * @param {object} opts.db            data-access object from createDb()
 * @param {string} opts.uploadsDir    where photos are written
 * @param {string} [opts.publicDir]   static assets (tablet + hub pages)
 * @param {string} [opts.pin]         supervisor PIN; falsy = actions are open
 * @param {number} [opts.tableCount]  number of line tables (default 4)
 * @param {number[]} [opts.shiftStarts] shift-start minutes (default [0])
 * @param {() => Date} [opts.now]     clock (injectable for tests)
 * @param {object} [opts.sse]         SSE broker (defaults to a fresh one)
 */
export function createApp(opts) {
  const {
    db,
    uploadsDir,
    publicDir,
    pin = '',
    tableCount = 4,
    shiftStarts = [0],
    now = () => new Date(),
    sse = createBroker(),
  } = opts;

  const app = express();
  app.locals.sse = sse;
  app.use(express.json());

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB
  });

  fs.mkdirSync(uploadsDir, { recursive: true });
  if (publicDir) app.use(express.static(publicDir));
  app.use('/uploads', express.static(uploadsDir));

  // --- supervisor PIN gate (only when a PIN is configured) ---
  function requirePin(req, res, next) {
    if (!pin) return next();
    if (req.get('x-snapbox-pin') === pin) return next();
    return res.status(401).json({ error: 'bad_pin' });
  }

  // --- pages ---
  if (publicDir) {
    app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'landing.html')));
    app.get('/hub', (_req, res) => res.sendFile(path.join(publicDir, 'hub.html')));
    app.get('/history', (_req, res) => res.sendFile(path.join(publicDir, 'history.html')));
    app.get('/table/:n', (_req, res) => res.sendFile(path.join(publicDir, 'table.html')));
  }

  // --- config for the frontend ---
  app.get('/api/config', (_req, res) =>
    res.json({ tableCount, pinRequired: !!pin })
  );

  // --- create a post (tablet uploads photo + note) ---
  app.post('/api/posts', upload.single('photo'), async (req, res) => {
    try {
      const tableNo = Number(req.body.table_no);
      if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > tableCount) {
        return res.status(400).json({ error: 'bad_table' });
      }
      if (!req.file) return res.status(400).json({ error: 'photo_required' });
      if (!/^image\//.test(req.file.mimetype || '')) {
        return res.status(400).json({ error: 'bad_file' });
      }

      const note = String(req.body.note || '').slice(0, 1000);
      const { photo_path, thumb_path } = await savePhoto(
        req.file.buffer,
        uploadsDir,
        req.file.mimetype
      );
      const ts = now();
      const post = db.createPost({
        table_no: tableNo,
        note,
        photo_path,
        thumb_path,
        shift_id: shiftIdFor(ts, shiftStarts),
        created_at: ts.toISOString(),
      });
      post.feedback = [];
      sse.send('post:new', post, toHubAndTable(tableNo));
      res.status(201).json(post);
    } catch (err) {
      res.status(500).json({ error: 'server_error', detail: String(err?.message || err) });
    }
  });

  // --- list posts for a shift (default: current) ---
  app.get('/api/posts', (req, res) => {
    const shift =
      !req.query.shift || req.query.shift === 'current'
        ? shiftIdFor(now(), shiftStarts)
        : String(req.query.shift);
    res.json({ shift_id: shift, posts: db.listPostsByShift(shift) });
  });

  // status changes go to the hub AND to the worker's own tablet
  const toHubAndTable = (tableNo) => (m) =>
    m.role === 'hub' || (m.role === 'table' && Number(m.tableNo) === tableNo);

  // --- approve ---
  app.post('/api/posts/:id/approve', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    db.approve(id);
    const payload = { id, status: 'approved', table_no: post.table_no, decline_reason: null };
    sse.send('post:update', payload, toHubAndTable(post.table_no));
    res.json(payload);
  });

  // --- decline (reason required) ---
  app.post('/api/posts/:id/decline', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    const reason = String(req.body.reason || '').trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: 'reason_required' });
    db.decline(id, reason);
    const payload = { id, status: 'declined', table_no: post.table_no, decline_reason: reason };
    sse.send('post:update', payload, toHubAndTable(post.table_no));
    res.json(payload);
  });

  // --- delete (soft: hidden from the live board, kept in the DB + on disk,
  //     so managers can still find it — and restore it — from History) ---
  app.delete('/api/posts/:id', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    const when = now().toISOString();
    db.softDelete(id, when);
    const payload = { id, table_no: post.table_no, deleted: true, deleted_at: when };
    sse.send('post:deleted', payload, toHubAndTable(post.table_no));
    res.json(payload);
  });

  // --- restore a deleted post ---
  app.post('/api/posts/:id/restore', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    db.restore(id);
    const restored = db.getPost(id);
    restored.feedback = db.listFeedbackForPost(id);
    sse.send('post:new', restored, toHubAndTable(post.table_no));
    res.json(restored);
  });

  // --- feedback (shows on the tablet + stays on the post) ---
  app.post('/api/posts/:id/feedback', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    const text = String(req.body.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'empty' });
    const fb = db.addFeedback(id, text, now().toISOString());
    const payload = { ...fb, table_no: post.table_no };
    sse.send(
      'feedback:new',
      payload,
      (m) => m.role === 'hub' || (m.role === 'table' && Number(m.tableNo) === post.table_no)
    );
    res.status(201).json(payload);
  });

  // --- download a photo with a human-friendly filename ---
  app.get('/api/posts/:id/download', (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });

    const file = path.join(uploadsDir, path.basename(post.photo_path));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'file_missing' });

    const d = new Date(post.created_at);
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    const ext = path.extname(post.photo_path) || '.jpg';
    res.download(file, `SnapBox_Line${post.table_no}_${stamp}${ext}`);
  });

  // --- history: which days have posts, with per-day counts ---
  app.get('/api/history/dates', (_req, res) => {
    res.json({ dates: db.listHistoryDates() });
  });

  // --- history: every post on a given calendar date ---
  app.get('/api/history', (req, res) => {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad_date' });
    res.json({ date, posts: db.listPostsByDate(date) });
  });

  // --- a table's own posts for the current shift (tablet list + persistence) ---
  app.get('/api/table/:n/posts', (req, res) => {
    const n = Number(req.params.n);
    const shift = shiftIdFor(now(), shiftStarts);
    res.json({ table_no: n, shift_id: shift, posts: db.listPostsByTableShift(n, shift) });
  });

  // --- a table's feedback for the current shift (tablet initial load + fallback) ---
  app.get('/api/table/:n/feedback', (req, res) => {
    const n = Number(req.params.n);
    const shift = shiftIdFor(now(), shiftStarts);
    res.json({ table_no: n, shift_id: shift, feedback: db.listFeedbackForTableShift(n, shift) });
  });

  // --- SSE stream ---
  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const meta = {
      role: req.query.role === 'table' ? 'table' : 'hub',
      tableNo: req.query.n ? Number(req.query.n) : null,
    };
    const id = sse.addClient(res, meta);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 25000);
    ping.unref?.();
    req.on('close', () => {
      clearInterval(ping);
      sse.removeClient(id);
    });
  });

  return app;
}
