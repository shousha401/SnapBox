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
    expect(db.setStatus(p.id, 'approved')).toBe(true);
    expect(db.getPost(p.id).status).toBe('approved');
  });

  it('deletes a post and cascades its feedback', () => {
    const p = db.createPost(makePost());
    db.addFeedback(p.id, 'note', '2026-07-13T10:05:00.000Z');
    const removed = db.deletePost(p.id);
    expect(removed.id).toBe(p.id);
    expect(db.getPost(p.id)).toBeUndefined();
    expect(db.raw.prepare('SELECT COUNT(*) c FROM feedback').get().c).toBe(0);
  });

  it('deletePost returns null for a missing id', () => {
    expect(db.deletePost(999)).toBeNull();
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
