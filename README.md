# SnapBox 📦

A QC-photo hub for the production floor. Each line **tablet** snaps a photo + note
and posts it to a shared **hub**; supervisors watch a live board and **approve**,
**delete**, or **send feedback** — which shows up right back on that table's tablet.

Replaces the old "text the photo to someone" step with one screen everyone on the
network can see.

## How it works

- **Tablets** — one per line at `/table/1` … `/table/4`. Live camera in the browser
  (falls back to the device photo picker), a note box, and a **Send** button.
  Feedback from supervisors appears at the bottom of the page.
- **Hub** — `/hub` on supervisor PCs. Live feed grouped by table, newest on top.
  Each post has **Approve · Feedback · Delete** (gated behind a shared PIN).
- **Live updates** over Server-Sent Events — posts appear on the hub instantly and
  feedback lands on the tablet instantly.
- **Shifts** — the hub shows the *current shift* only, but nothing is deleted on a
  shift boundary; everything stays in the database (`shift_id` is just a view
  filter).
- **History** — `/history` on manager PCs. Browse any past day, filter by line and
  by status, click a photo to enlarge, **download** it, **delete** it, or
  **restore** a deleted one.
- **Nothing is ever erased** — "Delete" is an *archive*: it sets `deleted_at`, so
  the post leaves the live board and the tablets but keeps its row **and its photo
  file**. Pick **🗑 Deleted** in History's *Show* dropdown to find deleted photos
  and restore them.

## Run it

```bash
npm install
npm start           # http://<this-machine>:4200  (redirects to /hub)
```

Then open:
- Hub:    `http://<vm-ip>:4200/hub`
- Tables: `http://<vm-ip>:4200/table/1` … `/table/4`

> Camera access in the browser requires a secure context. `localhost` works; on the
> LAN, tablets may need the hub served over HTTPS (or the origin allow-listed) for
> the live camera. The photo-picker fallback works either way.

### Run under PM2 (on the VM)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Configuration (env vars)

| Var              | Default            | Purpose                                             |
| ---------------- | ------------------ | --------------------------------------------------- |
| `PORT`           | `4200`             | HTTP port                                            |
| `SNAPBOX_PIN`    | _(empty)_          | Shared supervisor PIN. **Empty = actions are OPEN.** |
| `SNAPBOX_TABLES` | `4`                | Number of line tables                               |
| `SNAPBOX_SHIFTS` | _(empty)_          | Shift starts, e.g. `06:00,18:00`. Empty = one/day.  |
| `SNAPBOX_DB`     | `data/snapbox.db`  | SQLite file path                                     |
| `SNAPBOX_UPLOADS`| `uploads/`         | Where photos are stored                             |

## API

| Method   | Route                          | Notes                            |
| -------- | ------------------------------ | -------------------------------- |
| `POST`   | `/api/posts`                   | multipart: `photo`, `table_no`, `note` |
| `GET`    | `/api/posts?shift=current`     | feed for a shift                 |
| `POST`   | `/api/posts/:id/approve`       | 🔒 PIN                            |
| `DELETE` | `/api/posts/:id`               | 🔒 PIN — archives it (never erases) |
| `POST`   | `/api/posts/:id/restore`       | 🔒 PIN — un-deletes it           |
| `POST`   | `/api/posts/:id/feedback`      | 🔒 PIN — `{ text }`              |
| `GET`    | `/api/table/:n/feedback`       | this table's feedback, this shift |
| `GET`    | `/api/posts/:id/download`      | photo as an attachment, named `SnapBox_Line2_2026-07-13_1604.jpg` |
| `GET`    | `/api/history?date=YYYY-MM-DD` | every post on a calendar date    |
| `GET`    | `/api/history/dates`           | days that have posts + counts    |
| `GET`    | `/api/stream?role=hub\|table`  | SSE live updates                 |

## Tests

```bash
npm test
```

Vitest + supertest cover the shift logic, the SQLite data layer, and every API
endpoint (happy path, bad input, and the PIN gate). CI runs them on every push.

## Stack

Node + Express · SQLite (better-sqlite3) · SSE · vanilla-JS frontend (no build
step). Photos are resized in the browser before upload, so the server has **no
native image dependency**. Runs under PM2.
