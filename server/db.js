import Database from 'better-sqlite3';

// Posts are NEVER hard-deleted. "Delete" sets deleted_at, which hides the post
// from the live board and the tablets but keeps the row (and the photo file) so
// managers can find it again in History.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no       INTEGER NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  photo_path     TEXT    NOT NULL,
  thumb_path     TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  decline_reason TEXT,
  deleted_at     TEXT,
  shift_id       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_shift ON posts(shift_id);
CREATE INDEX IF NOT EXISTS idx_posts_table_shift ON posts(table_no, shift_id);
CREATE INDEX IF NOT EXISTS idx_feedback_post ON feedback(post_id);
`;

export function createDb(location = ':memory:') {
  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Migrations for databases created by earlier versions.
  const cols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!cols.includes('decline_reason')) db.exec('ALTER TABLE posts ADD COLUMN decline_reason TEXT');
  if (!cols.includes('deleted_at')) db.exec('ALTER TABLE posts ADD COLUMN deleted_at TEXT');

  const stmts = {
    insertPost: db.prepare(
      `INSERT INTO posts (table_no, note, photo_path, thumb_path, status, shift_id, created_at)
       VALUES (@table_no, @note, @photo_path, @thumb_path, 'pending', @shift_id, @created_at)`
    ),
    getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),

    // Live views exclude deleted posts.
    listByShift: db.prepare(
      `SELECT * FROM posts WHERE shift_id = ? AND deleted_at IS NULL
       ORDER BY datetime(created_at) DESC, id DESC`
    ),
    listByTableShift: db.prepare(
      `SELECT * FROM posts WHERE table_no = ? AND shift_id = ? AND deleted_at IS NULL
       ORDER BY datetime(created_at) DESC, id DESC`
    ),

    // History INCLUDES deleted posts (the page filters them). shift_id is
    // 'YYYY-MM-DD' (or 'YYYY-MM-DD#N'), so chars 1-10 are the local date.
    listByDate: db.prepare(
      `SELECT * FROM posts WHERE substr(shift_id, 1, 10) = ?
       ORDER BY datetime(created_at) DESC, id DESC`
    ),
    historyDates: db.prepare(
      `SELECT substr(shift_id, 1, 10) AS date,
              SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS total,
              SUM(CASE WHEN deleted_at IS NULL AND status = 'pending'  THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN deleted_at IS NULL AND status = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN deleted_at IS NULL AND status = 'declined' THEN 1 ELSE 0 END) AS declined,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted
       FROM posts
       GROUP BY date
       ORDER BY date DESC`
    ),

    fbForPost: db.prepare(
      'SELECT * FROM feedback WHERE post_id = ? ORDER BY datetime(created_at) ASC, id ASC'
    ),
    approve: db.prepare("UPDATE posts SET status = 'approved', decline_reason = NULL WHERE id = ?"),
    decline: db.prepare("UPDATE posts SET status = 'declined', decline_reason = ? WHERE id = ?"),
    softDelete: db.prepare('UPDATE posts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    restore: db.prepare('UPDATE posts SET deleted_at = NULL WHERE id = ?'),
    insertFb: db.prepare('INSERT INTO feedback (post_id, text, created_at) VALUES (?, ?, ?)'),
    getFb: db.prepare('SELECT * FROM feedback WHERE id = ?'),
    fbForTableShift: db.prepare(
      `SELECT f.* FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE p.table_no = ? AND p.shift_id = ? AND p.deleted_at IS NULL
       ORDER BY datetime(f.created_at) DESC, f.id DESC`
    ),
  };

  const getPost = (id) => stmts.getPost.get(id);

  function withFeedback(posts) {
    for (const p of posts) p.feedback = stmts.fbForPost.all(p.id);
    return posts;
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

  return {
    raw: db,
    createPost,
    getPost,
    listPostsByShift: (shift_id) => withFeedback(stmts.listByShift.all(shift_id)),
    listPostsByTableShift: (table_no, shift_id) =>
      withFeedback(stmts.listByTableShift.all(table_no, shift_id)),
    listPostsByDate: (date) => withFeedback(stmts.listByDate.all(date)),
    listHistoryDates: () => stmts.historyDates.all(),
    approve: (id) => stmts.approve.run(id).changes > 0,
    decline: (id, reason) => stmts.decline.run(reason, id).changes > 0,
    softDelete: (id, when) => stmts.softDelete.run(when, id).changes > 0,
    restore: (id) => stmts.restore.run(id).changes > 0,
    addFeedback: (post_id, text, created_at) => {
      const info = stmts.insertFb.run(post_id, text, created_at);
      return stmts.getFb.get(info.lastInsertRowid);
    },
    listFeedbackForTableShift: (table_no, shift_id) => stmts.fbForTableShift.all(table_no, shift_id),
    listFeedbackForPost: (post_id) => stmts.fbForPost.all(post_id),
    close: () => db.close(),
  };
}
