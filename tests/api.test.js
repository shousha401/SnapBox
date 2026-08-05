import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { parseAreas } from '../server/areas.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const PIN = '4242';
const FIXED = new Date(2026, 6, 13, 10, 0); // 2026-07-13 10:00 local -> shift '2026-07-13'
const AREAS = parseAreas({}); // CMP with 4 lines, GFF with 2

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
    areas: AREAS,
    shiftStarts: [0],
    now: () => FIXED,
  });
});
afterEach(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

function post(tableNo = 2, note = 'check this', area = 'cmp') {
  return request(app)
    .post('/api/posts')
    .field('area', area)
    .field('table_no', String(tableNo))
    .field('note', note)
    .attach('photo', img, 'snap.jpg');
}

describe('POST /api/posts', () => {
  it('accepts a photo + note and stores it in the current shift', async () => {
    const res = await post(2, 'label torn');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ area: 'cmp', table_no: 2, note: 'label torn', status: 'pending' });
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

  it('accepts a GFF post and keeps it apart from the same-numbered CMP line', async () => {
    const gff = await post(1, 'gff line one', 'gff');
    const cmp = await post(1, 'cmp line one', 'cmp');
    expect(gff.status).toBe(201);
    expect(gff.body.area).toBe('gff');

    const gffOnly = await request(app).get('/api/lines/gff/1/posts');
    expect(gffOnly.body.posts.map((p) => p.id)).toEqual([gff.body.id]);

    const cmpOnly = await request(app).get('/api/lines/cmp/1/posts');
    expect(cmpOnly.body.posts.map((p) => p.id)).toEqual([cmp.body.id]);

    // the hub board sees both areas at once
    const board = await request(app).get('/api/posts?shift=current');
    expect(board.body.posts).toHaveLength(2);
  });

  it('rejects an area that does not exist', async () => {
    const res = await post(1, 'nope', 'xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_area');
  });

  it('enforces each area\'s own line count', async () => {
    expect((await post(4, 'ok', 'cmp')).status).toBe(201); // CMP has 4 lines
    const res = await post(4, 'too far', 'gff'); // GFF only has 2
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_table');
  });

  it('files a post with no area under CMP, as pre-areas tablets sent them', async () => {
    const res = await request(app)
      .post('/api/posts')
      .field('table_no', '3')
      .attach('photo', img, 'snap.jpg');
    expect(res.status).toBe(201);
    expect(res.body.area).toBe('cmp');
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
    expect(ok.body).toMatchObject({ text: 'please redo', area: 'cmp', table_no: 3 });

    const tf = await request(app).get('/api/lines/cmp/3/feedback');
    expect(tf.body.feedback).toHaveLength(1);
    expect(tf.body.feedback[0].text).toBe('please redo');

    // ...and it never reaches GFF Line 3's namesake
    const other = await request(app).get('/api/lines/gff/2/feedback');
    expect(other.body.feedback).toHaveLength(0);
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
    expect(ok.body).toMatchObject({
      status: 'declined',
      decline_reason: 'photo too blurry',
      area: 'cmp',
      table_no: 1,
    });

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

describe('GET /api/lines/:area/:n/posts', () => {
  it('returns only that line\'s posts for the current shift', async () => {
    const a = await post(2, 'one');
    await post(3, 'other line');
    const res = await request(app).get('/api/lines/cmp/2/posts');
    expect(res.body).toMatchObject({ area: 'cmp', table_no: 2 });
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].id).toBe(a.body.id);
  });

  it('400s on an area that does not exist', async () => {
    const res = await request(app).get('/api/lines/xyz/1/posts');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_area');
  });
});

describe('pre-areas routes still work (old tablet bookmarks)', () => {
  it('/api/table/:n/* answers for the CMP line of that number', async () => {
    const cmp = await post(2, 'cmp two', 'cmp');
    await post(2, 'gff two', 'gff');

    const res = await request(app).get('/api/table/2/posts');
    expect(res.body.area).toBe('cmp');
    expect(res.body.posts.map((p) => p.id)).toEqual([cmp.body.id]);

    await request(app)
      .post(`/api/posts/${cmp.body.id}/feedback`)
      .set('x-snapbox-pin', PIN)
      .send({ text: 'legacy route' });
    const fb = await request(app).get('/api/table/2/feedback');
    expect(fb.body.feedback.map((f) => f.text)).toEqual(['legacy route']);
  });
});

describe('open mode (no PIN configured)', () => {
  it('allows approve without a PIN when pin is empty', async () => {
    const openApp = createApp({
      db,
      uploadsDir,
      publicDir: null,
      pin: '',
      areas: AREAS,
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

describe('delete is an archive, not an erase', () => {
  it('hides the post from the board + tablet but keeps it (and its file) for history', async () => {
    const { body } = await post(2);
    const file = path.join(uploadsDir, path.basename(body.photo_path));

    const del = await request(app).delete(`/api/posts/${body.id}`).set('x-snapbox-pin', PIN);
    expect(del.status).toBe(200);

    expect((await request(app).get('/api/posts')).body.posts).toHaveLength(0);
    expect((await request(app).get('/api/lines/cmp/2/posts')).body.posts).toHaveLength(0);

    const hist = (await request(app).get('/api/history?date=2026-07-13')).body.posts;
    expect(hist).toHaveLength(1);
    expect(hist[0].id).toBe(body.id);
    expect(hist[0].deleted_at).toBeTruthy();
    expect(fs.existsSync(file)).toBe(true); // photo NOT erased from disk
  });

  it('restores a deleted post back onto the board', async () => {
    const { body } = await post(2);
    await request(app).delete(`/api/posts/${body.id}`).set('x-snapbox-pin', PIN);

    const res = await request(app).post(`/api/posts/${body.id}/restore`).set('x-snapbox-pin', PIN);
    expect(res.status).toBe(200);
    expect(res.body.deleted_at).toBeNull();
    expect((await request(app).get('/api/posts')).body.posts).toHaveLength(1);
  });

  it('requires the PIN to restore', async () => {
    const { body } = await post();
    await request(app).delete(`/api/posts/${body.id}`).set('x-snapbox-pin', PIN);
    const res = await request(app).post(`/api/posts/${body.id}/restore`);
    expect(res.status).toBe(401);
  });

  it('can still download a deleted photo', async () => {
    const { body } = await post(1);
    await request(app).delete(`/api/posts/${body.id}`).set('x-snapbox-pin', PIN);
    expect((await request(app).get(`/api/posts/${body.id}/download`)).status).toBe(200);
  });
});

describe('GET /api/posts/:id/download', () => {
  it('sends the photo as an attachment with a friendly filename', async () => {
    const { body } = await post(2);
    const res = await request(app).get(`/api/posts/${body.id}/download`);
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'];
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/SnapBox_CMP-Line2_2026-07-13_1000\.jpg/);
  });

  it('names the area in the filename, so CMP and GFF downloads never collide', async () => {
    const { body } = await post(1, 'gff one', 'gff');
    const res = await request(app).get(`/api/posts/${body.id}/download`);
    expect(res.headers['content-disposition']).toMatch(/SnapBox_GFF-Line1_2026-07-13_1000\.jpg/);
  });

  it('404s for a post that does not exist', async () => {
    const res = await request(app).get('/api/posts/999/download');
    expect(res.status).toBe(404);
  });
});

describe('history endpoints', () => {
  it('returns every post on a date, across lines and areas', async () => {
    const a = await post(1, 'line one');
    const b = await post(4, 'line four');
    const c = await post(2, 'gff line two', 'gff');
    const res = await request(app).get('/api/history?date=2026-07-13');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-07-13');
    expect(res.body.posts.map((p) => p.id).sort()).toEqual(
      [a.body.id, b.body.id, c.body.id].sort()
    );
    // each post says which area it came from, so the page can filter on it
    expect(res.body.posts.find((p) => p.id === c.body.id).area).toBe('gff');
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
  it('reports both areas with their line counts, and whether a PIN is required', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body).toEqual({
      areas: [
        { key: 'cmp', label: 'CMP', lines: 4 },
        { key: 'gff', label: 'GFF', lines: 2 },
      ],
      pinRequired: true,
    });
  });
});

describe('static pages', () => {
  let pagesApp;
  beforeEach(() => {
    pagesApp = createApp({ db, uploadsDir, publicDir, pin: PIN, areas: AREAS, now: () => FIXED });
  });

  it('serves the hub page', async () => {
    const res = await request(pagesApp).get('/hub');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SnapBox');
  });

  it('serves the tablet page for a line in either area, and the stylesheet', async () => {
    expect((await request(pagesApp).get('/line/cmp/2')).status).toBe(200);
    expect((await request(pagesApp).get('/line/gff/1')).status).toBe(200);
    expect((await request(pagesApp).get('/table/2')).status).toBe(200); // old bookmark
    expect((await request(pagesApp).get('/styles.css')).status).toBe(200);
  });

  it('serves the history page', async () => {
    const res = await request(pagesApp).get('/history');
    expect(res.status).toBe(200);
    expect(res.text).toContain('history');
  });

  it('serves the landing / role picker at root, offering both areas', async () => {
    const res = await request(pagesApp).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('CMP Lines');
    expect(res.text).toContain('GFF Lines');
    expect(res.text).toContain('Manager Hub');
  });
});
