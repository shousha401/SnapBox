import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no    INTEGER NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  photo_path  TEXT    NOT NULL,
  thumb_path  TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',
  shift_id    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_shift ON posts(shift_id);
CREATE INDEX IF NOT EXISTS idx_feedback_post ON feedback(post_id);
`;

/**
 * Open a SnapBox database. Pass ':memory:' for an isolated in-memory DB (tests).
 * Returns a small data-access object; no globals, so every caller/test is isolated.
 */
export function createDb(location = ':memory:') {
  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const stmts = {
    insertPost: db.prepare(
      `INSERT INTO posts (table_no, note, photo_path, thumb_path, status, shift_id, created_at)
       VALUES (@table_no, @note, @photo_path, @thumb_path, 'pending', @shift_id, @created_at)`
    ),
    getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
    listByShift: db.prepare(
      'SELECT * FROM posts WHERE shift_id = ? ORDER BY datetime(created_at) DESC, id DESC'
    ),
    fbForPost: db.prepare(
      'SELECT * FROM feedback WHERE post_id = ? ORDER BY datetime(created_at) ASC, id ASC'
    ),
    setStatus: db.prepare('UPDATE posts SET status = ? WHERE id = ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    insertFb: db.prepare(
      'INSERT INTO feedback (post_id, text, created_at) VALUES (?, ?, ?)'
    ),
    getFb: db.prepare('SELECT * FROM feedback WHERE id = ?'),
    fbForTableShift: db.prepare(
      `SELECT f.* FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE p.table_no = ? AND p.shift_id = ?
       ORDER BY datetime(f.created_at) DESC, f.id DESC`
    ),
  };

  function getPost(id) {
    return stmts.getPost.get(id);
  }

  function createPost(o) {
    const info = stmts.insertPost.run({
      table_no: o.table_no,
      note: o.note ?? '',
      photo_path: o.photo_path,
      thumb_path: o.thumb_path,
      shift_id: o.shift_id,
      created_at: o.created_at,
    });
    return getPost(info.lastInsertRowid);
  }

  function listPostsByShift(shift_id) {
    const posts = stmts.listByShift.all(shift_id);
    for (const p of posts) p.feedback = stmts.fbForPost.all(p.id);
    return posts;
  }

  function setStatus(id, status) {
    return stmts.setStatus.run(status, id).changes > 0;
  }

  function deletePost(id) {
    const row = getPost(id);
    if (!row) return null;
    stmts.deletePost.run(id); // feedback removed via ON DELETE CASCADE
    return row;
  }

  function addFeedback(post_id, text, created_at) {
    const info = stmts.insertFb.run(post_id, text, created_at);
    return stmts.getFb.get(info.lastInsertRowid);
  }

  function listFeedbackForTableShift(table_no, shift_id) {
    return stmts.fbForTableShift.all(table_no, shift_id);
  }

  return {
    raw: db,
    createPost,
    getPost,
    listPostsByShift,
    setStatus,
    deletePost,
    addFeedback,
    listFeedbackForTableShift,
    close: () => db.close(),
  };
}
