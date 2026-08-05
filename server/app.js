import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { shiftIdFor } from './shift.js';
import { createBroker } from './sse.js';
import { savePhoto } from './storage.js';
import { DEFAULT_AREA, defaultAreas, findArea } from './areas.js';

/**
 * Build the SnapBox Express app. Everything it needs is injected, so tests can
 * pass an in-memory db, a temp uploads dir, a fixed clock, and a known PIN.
 *
 * @param {object} opts
 * @param {object} opts.db            data-access object from createDb()
 * @param {string} opts.uploadsDir    where photos are written
 * @param {string} [opts.publicDir]   static assets (tablet + hub pages)
 * @param {string} [opts.pin]         supervisor PIN; falsy = actions are open
 * @param {Array<{key,label,lines}>} [opts.areas] production areas + line counts
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
    areas = defaultAreas(),
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
    app.get('/line/:area/:n', (_req, res) => res.sendFile(path.join(publicDir, 'table.html')));
    // Pre-areas tablet bookmarks — these were all CMP lines.
    app.get('/table/:n', (_req, res) => res.sendFile(path.join(publicDir, 'table.html')));
  }

  // --- config for the frontend ---
  app.get('/api/config', (_req, res) => res.json({ areas, pinRequired: !!pin }));

  // --- create a post (tablet uploads photo + note) ---
  app.post('/api/posts', upload.single('photo'), async (req, res) => {
    try {
      const area = findArea(areas, req.body.area || DEFAULT_AREA);
      if (!area) return res.status(400).json({ error: 'bad_area' });

      const lineNo = Number(req.body.table_no);
      if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > area.lines) {
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
        area: area.key,
        table_no: lineNo,
        note,
        photo_path,
        thumb_path,
        shift_id: shiftIdFor(ts, shiftStarts),
        created_at: ts.toISOString(),
      });
      post.feedback = [];
      sse.send('post:new', post, toHubAndLine(area.key, lineNo));
      res.status(201).json(post);
    } catch (err) {
      res.status(500).json({ error: 'server_error', detail: String(err?.message || err) });
    }
  });

  // --- list posts for a shift, every area (default: current) ---
  app.get('/api/posts', (req, res) => {
    const shift =
      !req.query.shift || req.query.shift === 'current'
        ? shiftIdFor(now(), shiftStarts)
        : String(req.query.shift);
    res.json({ shift_id: shift, posts: db.listPostsByShift(shift) });
  });

  // Status changes go to the hub AND to that one line's own tablet — a GFF
  // tablet must not light up for a CMP post that happens to share its number.
  const toHubAndLine = (areaKey, lineNo) => (m) =>
    m.role === 'hub' || (m.role === 'table' && m.area === areaKey && Number(m.tableNo) === lineNo);

  // --- approve ---
  app.post('/api/posts/:id/approve', requirePin, (req, res) => {
    const id = Number(req.params.id);
    const post = db.getPost(id);
    if (!post) return res.status(404).json({ error: 'not_found' });
    db.approve(id);
    const payload = {
      id,
      status: 'approved',
      area: post.area,
      table_no: post.table_no,
      decline_reason: null,
    };
    sse.send('post:update', payload, toHubAndLine(post.area, post.table_no));
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
    const payload = {
      id,
      status: 'declined',
      area: post.area,
      table_no: post.table_no,
      decline_reason: reason,
    };
    sse.send('post:update', payload, toHubAndLine(post.area, post.table_no));
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
    const payload = {
      id,
      area: post.area,
      table_no: post.table_no,
      deleted: true,
      deleted_at: when,
    };
    sse.send('post:deleted', payload, toHubAndLine(post.area, post.table_no));
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
    sse.send('post:new', restored, toHubAndLine(post.area, post.table_no));
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
    const payload = { ...fb, area: post.area, table_no: post.table_no };
    sse.send('feedback:new', payload, toHubAndLine(post.area, post.table_no));
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
    const areaLabel = (findArea(areas, post.area)?.label || post.area).toUpperCase();
    res.download(file, `SnapBox_${areaLabel}-Line${post.table_no}_${stamp}${ext}`);
  });

  // --- history: which days have posts, with per-day counts ---
  app.get('/api/history/dates', (_req, res) => {
    res.json({ dates: db.listHistoryDates() });
  });

  // --- history: every post on a given calendar date, every area ---
  app.get('/api/history', (req, res) => {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad_date' });
    res.json({ date, posts: db.listPostsByDate(date) });
  });

  // --- one line's own posts / feedback for the current shift (tablet) ---
  function lineOf(req, res) {
    const area = findArea(areas, req.params.area ?? DEFAULT_AREA);
    if (!area) {
      res.status(400).json({ error: 'bad_area' });
      return null;
    }
    return { area, lineNo: Number(req.params.n), shift: shiftIdFor(now(), shiftStarts) };
  }

  function linePosts(req, res) {
    const l = lineOf(req, res);
    if (!l) return;
    res.json({
      area: l.area.key,
      table_no: l.lineNo,
      shift_id: l.shift,
      posts: db.listPostsByLineShift(l.area.key, l.lineNo, l.shift),
    });
  }

  function lineFeedback(req, res) {
    const l = lineOf(req, res);
    if (!l) return;
    res.json({
      area: l.area.key,
      table_no: l.lineNo,
      shift_id: l.shift,
      feedback: db.listFeedbackForLineShift(l.area.key, l.lineNo, l.shift),
    });
  }

  app.get('/api/lines/:area/:n/posts', linePosts);
  app.get('/api/lines/:area/:n/feedback', lineFeedback);
  // Pre-areas routes — these were all CMP lines.
  app.get('/api/table/:n/posts', linePosts);
  app.get('/api/table/:n/feedback', lineFeedback);

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
      area: findArea(areas, req.query.area || DEFAULT_AREA)?.key || null,
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
