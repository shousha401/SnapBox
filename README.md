# SnapBox 📦

A QC-photo hub for the production floor. Each line **tablet** snaps a photo + note
and posts it to a shared **hub**; supervisors watch a live board and **approve**,
**delete**, or **send feedback** — which shows up right back on that line's tablet.

Replaces the old "text the photo to someone" step with one screen everyone on the
network can see.

## Areas

The floor is split into four **areas**, each with its own lines:

| Area  | Lines       | Tablet URL                       |
| ----- | ----------- | -------------------------------- |
| **CMP** | 1 … 4     | `/line/cmp/1` … `/line/cmp/4`   |
| **GFF** | 1 … 2     | `/line/gff/1` … `/line/gff/2`   |
| **RTE** | 1 … 4     | `/line/rte/1` … `/line/rte/4`   |
| **Pack Off** | 1 … 4 | `/line/packoff/1` … `/line/packoff/4` |

A post belongs to an *(area, line)* pair, so **CMP Line 1 and GFF Line 1 are
different lines** — separate columns on the hub, separate feedback, separate
tablets. The Manager Hub sees **every area**, with **CMP / GFF / RTE / Pack Off /
All** tabs.

## How it works

- **Tablets** — one per line, at `/line/<area>/<n>`. Live camera in the browser
  (falls back to the device photo picker), a note box, and a **Send** button.
  Feedback from supervisors appears at the bottom of the page. A tablet only ever
  sees its own line's posts and feedback.
- **Hub** — `/hub` on supervisor PCs. Live feed grouped by line across every area,
  newest on top, with one tab per area plus **All** (the choice is remembered per
  PC, and a post landing on a hidden area counts up on its tab). Each post has
  **Approve · Feedback · Delete** (gated behind a shared PIN).
- **Live updates** over Server-Sent Events — posts appear on the hub instantly and
  feedback lands on the right tablet instantly.
- **Shifts** — the hub shows the *current shift* only, but nothing is deleted on a
  shift boundary; everything stays in the database (`shift_id` is just a view
  filter).
- **History** — `/history` on manager PCs. Browse any past day, filter by area,
  line and status, click a photo to enlarge, **download** it, **delete** it, or
  **restore** a deleted one.
- **Nothing is ever erased** — "Delete" is an *archive*: it sets `deleted_at`, so
  the post leaves the live board and the tablets but keeps its row **and its photo
  file**. Pick **🗑 Deleted** in History's *Show* dropdown to find deleted photos
  and restore them.

## Run it

```bash
npm install
npm start           # http://<this-machine>:4200
```

Then open:
- Start:  `http://<vm-ip>:4200/` — pick a line's area or the Manager Hub
- Hub:    `http://<vm-ip>:4200/hub`
- Lines:  `http://<vm-ip>:4200/line/<area>/<n>` — `/line/cmp/1` … `/line/cmp/4`,
  `/line/gff/1` … `/line/gff/2`, `/line/rte/1` … `/line/rte/4`,
  `/line/packoff/1` … `/line/packoff/4`

> Upgrading an existing install? Nothing to do — the database migrates itself on
> first start and every post already in it stays a **CMP** post. Old `/table/N`
> tablet bookmarks keep working and mean CMP line N.

> Camera access in the browser requires a secure context. `localhost` works; on the
> LAN, tablets may need the hub served over HTTPS (or the origin allow-listed) for
> the live camera. The photo-picker fallback works either way.

### Run under PM2 (on the VM)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Configuration (env vars)

| Var                 | Default            | Purpose                                             |
| ------------------- | ------------------ | --------------------------------------------------- |
| `PORT`              | `4200`             | HTTP port                                            |
| `SNAPBOX_PIN`       | _(empty)_          | Shared supervisor PIN. **Empty = actions are OPEN.** |
| `SNAPBOX_CMP_LINES` | `4`                | Number of CMP lines                                  |
| `SNAPBOX_GFF_LINES` | `2`                | Number of GFF lines                                  |
| `SNAPBOX_RTE_LINES` | `4`                | Number of RTE lines                                  |
| `SNAPBOX_PACKOFF_LINES` | `4`            | Number of Pack Off lines                             |
| `SNAPBOX_SHIFTS`    | _(empty)_          | Shift starts, e.g. `06:00,18:00`. Empty = one/day.  |
| `SNAPBOX_DB`        | `data/snapbox.db`  | SQLite file path                                     |
| `SNAPBOX_UPLOADS`   | `uploads/`         | Where photos are stored                             |

`SNAPBOX_TABLES` — the name from before areas existed — is still read as the CMP
line count, so an existing `.env` or PM2 config keeps working untouched.

## API

`:area` is `cmp`, `gff`, `rte` or `packoff`.

| Method   | Route                              | Notes                            |
| -------- | ---------------------------------- | -------------------------------- |
| `POST`   | `/api/posts`                       | multipart: `photo`, `area`, `table_no`, `note` (no `area` = `cmp`) |
| `GET`    | `/api/posts?shift=current`         | feed for a shift, **every area**  |
| `GET`    | `/api/config`                      | areas + line counts, PIN required? |
| `POST`   | `/api/posts/:id/approve`           | 🔒 PIN                            |
| `POST`   | `/api/posts/:id/decline`           | 🔒 PIN — `{ reason }` required    |
| `DELETE` | `/api/posts/:id`                   | 🔒 PIN — archives it (never erases) |
| `POST`   | `/api/posts/:id/restore`           | 🔒 PIN — un-deletes it           |
| `POST`   | `/api/posts/:id/feedback`          | 🔒 PIN — `{ text }`              |
| `GET`    | `/api/lines/:area/:n/posts`        | this line's posts, this shift    |
| `GET`    | `/api/lines/:area/:n/feedback`     | this line's feedback, this shift |
| `GET`    | `/api/posts/:id/download`          | photo as an attachment, named `SnapBox_GFF-Line2_2026-07-13_1604.jpg` |
| `GET`    | `/api/history?date=YYYY-MM-DD`     | every post on a calendar date    |
| `GET`    | `/api/history/dates`               | days that have posts + counts    |
| `GET`    | `/api/stream?role=hub\|table&area=&n=` | SSE live updates             |

`GET /api/table/:n/posts` and `/api/table/:n/feedback` still answer for the CMP
line of that number, so tablets bookmarked before areas existed keep working.

## Tests

```bash
npm test
```

Vitest + supertest cover the shift logic, the area config, the SQLite data layer
(including the migration of a pre-areas database), and every API endpoint — happy
path, bad input, the PIN gate, and that the areas never leak into each other.
CI runs them on every push.

## Stack

Node + Express · SQLite (better-sqlite3) · SSE · vanilla-JS frontend (no build
step). Photos are resized in the browser before upload, so the server has **no
native image dependency**. Runs under PM2.
