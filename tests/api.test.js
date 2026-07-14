import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const PIN = '4242';
const FIXED = new Date(2026, 6, 13, 10, 0); // 2026-07-13 10:00 local -> shift '2026-07-13'

// The server stores the received bytes as-is (no image processing), so any
// buffer sent with an image content-type is enough to exercise the endpoints.
const img = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

let db, uploadsDir, app;
beforeEach(() => {
  db = createDb(':memory:');
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbox-test-'));
  app = createApp({
    db,
    uploadsDir,
    publicDir: null,
    pin: PIN,
    tableCount: 4,
    shiftStarts: [0],
    now: () => FIXED,
  });
});
afterEach(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

function post(tableNo = 2, note = 'check this') {
  return request(app)
    .post('/api/posts')
    .field('table_no', String(tableNo))
    .field('note', note)
    .attach('photo', img, 'snap.jpg');
}

describe('POST /api/posts', () => {
  it('accepts a photo + note and stores it in the current shift', async () => {
    const res = await post(2, 'label torn');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ table_no: 2, note: 'label torn', status: 'pending' });
    expect(res.body.photo_path).toMatch(/^\/uploads\//);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(res.body.photo_path)))).toBe(true);

    const list = await request(app).get('/api/posts?shift=current');
    expect(list.body.shift_id).toBe('2026-07-13');
    expect(list.body.posts).toHaveLength(1);
    expect(list.body.posts[0].id).toBe(res.body.id);
  });

  it('rejects a missing photo', async () => {
    const res = await request(app).post('/api/posts').field('table_no', '1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('photo_required');
  });

  it('rejects an out-of-range table', async () => {
    const res = await post(9);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_table');
  });
});

describe('supervisor actions are PIN-gated', () => {
  it('rejects approve without the PIN', async () => {
    const { body } = await post();
    const res = await request(app).post(`/api/posts/${body.id}/approve`);
    expect(res.status).toBe(401);
  });

  it('approves with the PIN', async () => {
    const { body } = await post();
    const res = await request(app)
      .post(`/api/posts/${body.id}/approve`)
      .set('x-snapbox-pin', PIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(db.getPost(body.id).status).toBe('approved');
  });

  it('deletes with the PIN and removes it from the feed', async () => {
    const { body } = await post();
    const del = await request(app).delete(`/api/posts/${body.id}`).set('x-snapbox-pin', PIN);
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/posts');
    expect(list.body.posts).toHaveLength(0);
  });

  it('adds feedback and rejects empty feedback', async () => {
    const { body } = await post(3);
    const empty = await request(app)
      .post(`/api/posts/${body.id}/feedback`)
      .set('x-snapbox-pin', PIN)
      .send({ text: '   ' });
    expect(empty.status).toBe(400);

    const ok = await request(app)
      .post(`/api/posts/${body.id}/feedback`)
      .set('x-snapbox-pin', PIN)
      .send({ text: 'please redo' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ text: 'please redo', table_no: 3 });

    const tf = await request(app).get('/api/table/3/feedback');
    expect(tf.body.feedback).toHaveLength(1);
    expect(tf.body.feedback[0].text).toBe('please redo');
  });

  it('declines with a reason and rejects a decline with no reason', async () => {
    const { body } = await post(1);
    const noReason = await request(app)
      .post(`/api/posts/${body.id}/decline`)
      .set('x-snapbox-pin', PIN)
      .send({ reason: '   ' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe('reason_required');

    const ok = await request(app)
      .post(`/api/posts/${body.id}/decline`)
      .set('x-snapbox-pin', PIN)
      .send({ reason: 'photo too blurry' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'declined', decline_reason: 'photo too blurry', table_no: 1 });

    const list = await request(app).get('/api/posts');
    const stored = list.body.posts.find((p) => p.id === body.id);
    expect(stored.status).toBe('declined');
    expect(stored.decline_reason).toBe('photo too blurry');
  });

  it('requires the PIN to decline', async () => {
    const { body } = await post(1);
    const res = await request(app).post(`/api/posts/${body.id}/decline`).send({ reason: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for actions on a missing post', async () => {
    const res = await request(app).post('/api/posts/999/approve').set('x-snapbox-pin', PIN);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/table/:n/posts', () => {
  it('returns only the given table\'s posts for the current shift', async () => {
    const a = await post(2, 'one');
    await post(3, 'other table');
    const res = await request(app).get('/api/table/2/posts');
    expect(res.body.table_no).toBe(2);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].id).toBe(a.body.id);
  });
});

describe('open mode (no PIN configured)', () => {
  it('allows approve without a PIN when pin is empty', async () => {
    const openApp = createApp({
      db,
      uploadsDir,
      publicDir: null,
      pin: '',
      tableCount: 4,
      now: () => FIXED,
    });
    const { body } = await request(openApp)
      .post('/api/posts')
      .field('table_no', '1')
      .attach('photo', img, 'snap.jpg');
    const res = await request(openApp).post(`/api/posts/${body.id}/approve`);
    expect(res.status).toBe(200);
  });
});

describe('history endpoints', () => {
  it('returns every post on a date, across lines', async () => {
    const a = await post(1, 'line one');
    const b = await post(4, 'line four');
    const res = await request(app).get('/api/history?date=2026-07-13');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-07-13');
    expect(res.body.posts.map((p) => p.id).sort()).toEqual([a.body.id, b.body.id].sort());
  });

  it('returns nothing for a day with no posts', async () => {
    await post(1);
    const res = await request(app).get('/api/history?date=2020-01-01');
    expect(res.status).toBe(200);
    expect(res.body.posts).toEqual([]);
  });

  it('rejects a malformed date', async () => {
    const res = await request(app).get('/api/history?date=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_date');
  });

  it('lists days with per-status counts', async () => {
    const a = await post(2);
    await post(2);
    await request(app).post(`/api/posts/${a.body.id}/approve`).set('x-snapbox-pin', PIN);

    const res = await request(app).get('/api/history/dates');
    expect(res.body.dates[0]).toMatchObject({
      date: '2026-07-13',
      total: 2,
      approved: 1,
      pending: 1,
    });
  });
});

describe('GET /api/config', () => {
  it('reports table count and whether a PIN is required', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body).toEqual({ tableCount: 4, pinRequired: true });
  });
});

describe('static pages', () => {
  let pagesApp;
  beforeEach(() => {
    pagesApp = createApp({ db, uploadsDir, publicDir, pin: PIN, tableCount: 4, now: () => FIXED });
  });

  it('serves the hub page', async () => {
    const res = await request(pagesApp).get('/hub');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SnapBox');
  });

  it('serves the tablet page and the stylesheet', async () => {
    expect((await request(pagesApp).get('/table/2')).status).toBe(200);
    expect((await request(pagesApp).get('/styles.css')).status).toBe(200);
  });

  it('serves the history page', async () => {
    const res = await request(pagesApp).get('/history');
    expect(res.status).toBe(200);
    expect(res.text).toContain('history');
  });

  it('serves the landing / role picker at root', async () => {
    const res = await request(pagesApp).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Warehouse Tablet');
    expect(res.text).toContain('Manager Hub');
  });
});
