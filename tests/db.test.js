import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../server/db.js';

let db;
beforeEach(() => {
  db = createDb(':memory:');
});
afterEach(() => {
  db.close();
});

function makePost(over = {}) {
  return {
    table_no: 1,
    note: 'hello',
    photo_path: '/uploads/a.jpg',
    thumb_path: '/uploads/a.thumb.jpg',
    shift_id: '2026-07-13',
    created_at: '2026-07-13T10:00:00.000Z',
    ...over,
  };
}

describe('posts', () => {
  it('creates and reads back a post with pending status', () => {
    const p = db.createPost(makePost());
    expect(p.id).toBeGreaterThan(0);
    expect(p.status).toBe('pending');
    expect(db.getPost(p.id).note).toBe('hello');
  });

  it('lists a shift newest-first with feedback attached', () => {
    const a = db.createPost(makePost({ created_at: '2026-07-13T10:00:00.000Z' }));
    const b = db.createPost(makePost({ created_at: '2026-07-13T11:00:00.000Z' }));
    db.createPost(makePost({ shift_id: '2026-07-12' })); // other shift, excluded
    db.addFeedback(a.id, 'fix the label', '2026-07-13T10:05:00.000Z');

    const list = db.listPostsByShift('2026-07-13');
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]); // newest first
    expect(list.find((p) => p.id === a.id).feedback).toHaveLength(1);
    expect(list.find((p) => p.id === b.id).feedback).toEqual([]);
  });

  it('approves a post', () => {
    const p = db.createPost(makePost());
    expect(db.approve(p.id)).toBe(true);
    expect(db.getPost(p.id).status).toBe('approved');
  });

  it('declines a post with a reason, and approve clears the reason', () => {
    const p = db.createPost(makePost());
    expect(db.decline(p.id, 'label unreadable')).toBe(true);
    let row = db.getPost(p.id);
    expect(row.status).toBe('declined');
    expect(row.decline_reason).toBe('label unreadable');

    db.approve(p.id);
    row = db.getPost(p.id);
    expect(row.status).toBe('approved');
    expect(row.decline_reason).toBeNull();
  });

  it('soft-deletes: the row and its feedback survive, but it leaves the live views', () => {
    const p = db.createPost(makePost({ table_no: 1 }));
    db.addFeedback(p.id, 'note', '2026-07-13T10:05:00.000Z');

    expect(db.softDelete(p.id, '2026-07-13T12:00:00.000Z')).toBe(true);

    const row = db.getPost(p.id);
    expect(row).toBeDefined(); // NOT erased
    expect(row.deleted_at).toBe('2026-07-13T12:00:00.000Z');
    expect(db.raw.prepare('SELECT COUNT(*) c FROM feedback').get().c).toBe(1);

    // hidden from the hub board and the tablet
    expect(db.listPostsByShift('2026-07-13')).toHaveLength(0);
    expect(db.listPostsByTableShift(1, '2026-07-13')).toHaveLength(0);
    expect(db.listFeedbackForTableShift(1, '2026-07-13')).toHaveLength(0);

    // still visible in history
    expect(db.listPostsByDate('2026-07-13')).toHaveLength(1);
  });

  it('restores a deleted post back onto the live views', () => {
    const p = db.createPost(makePost({ table_no: 1 }));
    db.softDelete(p.id, '2026-07-13T12:00:00.000Z');
    expect(db.restore(p.id)).toBe(true);
    expect(db.getPost(p.id).deleted_at).toBeNull();
    expect(db.listPostsByShift('2026-07-13')).toHaveLength(1);
  });

  it('softDelete is a no-op on an already-deleted post', () => {
    const p = db.createPost(makePost());
    db.softDelete(p.id, '2026-07-13T12:00:00.000Z');
    expect(db.softDelete(p.id, '2026-07-13T13:00:00.000Z')).toBe(false);
    expect(db.getPost(p.id).deleted_at).toBe('2026-07-13T12:00:00.000Z'); // keeps the first time
  });
});

describe('listPostsByTableShift', () => {
  it('returns only that table + shift, newest first, with feedback', () => {
    const a = db.createPost(makePost({ table_no: 1, created_at: '2026-07-13T10:00:00.000Z' }));
    const b = db.createPost(makePost({ table_no: 1, created_at: '2026-07-13T11:00:00.000Z' }));
    db.createPost(makePost({ table_no: 2 })); // other table
    db.createPost(makePost({ table_no: 1, shift_id: '2026-07-12' })); // other shift
    db.addFeedback(a.id, 'redo', '2026-07-13T10:05:00.000Z');

    const list = db.listPostsByTableShift(1, '2026-07-13');
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(list.find((p) => p.id === a.id).feedback).toHaveLength(1);
  });
});

describe('history', () => {
  it('lists all posts on a calendar date, newest first, with feedback', () => {
    const a = db.createPost(makePost({ table_no: 1, created_at: '2026-07-13T10:00:00.000Z' }));
    const b = db.createPost(makePost({ table_no: 3, created_at: '2026-07-13T14:00:00.000Z' }));
    db.createPost(makePost({ shift_id: '2026-07-12' })); // different day
    db.addFeedback(a.id, 'redo', '2026-07-13T10:05:00.000Z');

    const list = db.listPostsByDate('2026-07-13');
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(list.find((p) => p.id === a.id).feedback).toHaveLength(1);
  });

  it('still groups by date when shift ids are multi-shift (YYYY-MM-DD#N)', () => {
    db.createPost(makePost({ shift_id: '2026-07-13#0' }));
    db.createPost(makePost({ shift_id: '2026-07-13#1' }));
    expect(db.listPostsByDate('2026-07-13')).toHaveLength(2);
  });

  it('counts deleted separately and leaves them out of the day total', () => {
    const a = db.createPost(makePost({ shift_id: '2026-07-13' }));
    db.createPost(makePost({ shift_id: '2026-07-13' }));
    db.softDelete(a.id, '2026-07-13T12:00:00.000Z');

    const [day] = db.listHistoryDates();
    expect(day).toMatchObject({ date: '2026-07-13', total: 1, deleted: 1 });
  });

  it('summarises each day with per-status counts, newest day first', () => {
    const p1 = db.createPost(makePost({ shift_id: '2026-07-13' }));
    const p2 = db.createPost(makePost({ shift_id: '2026-07-13' }));
    db.createPost(makePost({ shift_id: '2026-07-13' })); // stays pending
    db.createPost(makePost({ shift_id: '2026-07-12' }));
    db.approve(p1.id);
    db.decline(p2.id, 'blurry');

    const dates = db.listHistoryDates();
    expect(dates.map((d) => d.date)).toEqual(['2026-07-13', '2026-07-12']);
    expect(dates[0]).toMatchObject({ total: 3, approved: 1, declined: 1, pending: 1 });
  });
});

describe('feedback by table + shift', () => {
  it('returns only feedback for the given table and shift', () => {
    const t1 = db.createPost(makePost({ table_no: 1 }));
    const t2 = db.createPost(makePost({ table_no: 2 }));
    db.addFeedback(t1.id, 'for table 1', '2026-07-13T10:05:00.000Z');
    db.addFeedback(t2.id, 'for table 2', '2026-07-13T10:06:00.000Z');

    const got = db.listFeedbackForTableShift(1, '2026-07-13');
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('for table 1');
  });
});
