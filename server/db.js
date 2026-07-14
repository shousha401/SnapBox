import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no       INTEGER NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  photo_path     TEXT    NOT NULL,
  thumb_path     TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  decline_reason TEXT,
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

  // Migration for databases created before decline_reason existed.
  const cols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!cols.includes('decline_reason')) {
    db.exec('ALTER TABLE posts ADD COLUMN decline_reason TEXT');
  }

  const stmts = {
    insertPost: db.prepare(
      `INSERT INTO posts (table_no, note, photo_path, thumb_path, status, shift_id, created_at)
       VALUES (@table_no, @note, @photo_path, @thumb_path, 'pending', @shift_id, @created_at)`
    ),
    getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
    listByShift: db.prepare(
      'SELECT * FROM posts WHERE shift_id = ? ORDER BY datetime(created_at) DESC, id DESC'
    ),
    listByTableShift: db.prepare(
      'SELECT * FROM posts WHERE table_no = ? AND shift_id = ? ORDER BY datetime(created_at) DESC, id DESC'
    ),
    // shift_id is 'YYYY-MM-DD' (or 'YYYY-MM-DD#N' when multi-shift), so the
    // first 10 chars are always the local calendar date.
    listByDate: db.prepare(
      'SELECT * FROM posts WHERE substr(shift_id, 1, 10) = ? ORDER BY datetime(created_at) DESC, id DESC'
    ),
    historyDates: db.prepare(
      `SELECT substr(shift_id, 1, 10) AS date,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS declined
       FROM posts
       GROUP BY date
       ORDER BY date DESC`
    ),
    fbForPost: db.prepare(
      'SELECT * FROM feedback WHERE post_id = ? ORDER BY datetime(created_at) ASC, id ASC'
    ),
    approve: db.prepare("UPDATE posts SET status = 'approved', decline_reason = NULL WHERE id = ?"),
    decline: db.prepare("UPDATE posts SET status = 'declined', decline_reason = ? WHERE id = ?"),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    insertFb: db.prepare('INSERT INTO feedback (post_id, text, created_at) VALUES (?, ?, ?)'),
    getFb: db.prepare('SELECT * FROM feedback WHERE id = ?'),
    fbForTableShift: db.prepare(
      `SELECT f.* FROM feedback f
       JOIN posts p ON p.id = f.post_id
       WHERE p.table_no = ? AND p.shift_id = ?
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
    deletePost: (id) => {
      const row = getPost(id);
      if (!row) return null;
      stmts.deletePost.run(id); // feedback removed via ON DELETE CASCADE
      return row;
    },
    addFeedback: (post_id, text, created_at) => {
      const info = stmts.insertFb.run(post_id, text, created_at);
      return stmts.getFb.get(info.lastInsertRowid);
    },
    listFeedbackForTableShift: (table_no, shift_id) => stmts.fbForTableShift.all(table_no, shift_id),
    close: () => db.close(),
  };
}
