# MSRTC Smart Mechanized Cleaning — Standalone Edition

Plain **HTML + CSS + JS** frontend and a **zero-dependency Node.js** backend with a
built-in **SQLite** database. No Google account, no Apps Script, no `npm install` —
everything runs from one folder with just Node.js.

```
public/            ← frontend (open via the server, not file://)
  index.html         page markup
  css/style.css      all styles
  js/app.js          all app logic (talks to the server at POST /exec)
server/            ← backend (plain Node, no packages)
  server.js          HTTP server: /exec API + /report/:id + static files
  handlers.js        every API function (login, save, reports, search, …)
  db.js              SQLite schema (node:sqlite — built into Node 22.13+/24)
  checklist-config.js  the 8 checklists: questions, penalties, signatures
  report.js          printable Marathi inspection report (Print → Save as PDF)
  seed.js            sample districts/stations/employees (replace with real data)
  smoke-test.js      end-to-end API test (44 checks)
data/app.db        ← the database file (created automatically; BACK THIS UP)
Code.gs, Index.html← original Apps Script version, kept as reference only
```

## Run it

Requires **Node.js 22.13 or newer** (built-in SQLite). Then:

```bash
node server/server.js
```

Open **http://localhost:3000** — done. Sample login: employee ID `1001`
(password = the ID itself, same rule as before).

To use it from phones on the same Wi-Fi, find the computer's IP
(`ipconfig` → IPv4) and open `http://<that-ip>:3000` on the phone.
To auto-start on boot, create a Windows Task Scheduler task that runs
`node C:\...\Checklist V.1\server\server.js` at logon.

## Importing your real master data (CSV)

Create these two files (UTF-8; Excel → *Save As → CSV UTF-8* works) and they are
imported automatically at every server start — no code editing needed:

- **`data/locations.csv`** — header `district,station`, one bus station per row.
- **`data/employees.csv`** — header `employee_id,name,password,active`.
  Leave `password` empty for the "password = employee ID" rule; `active` 1/0.

Templates with the exact format are in `data-templates/`. Rows are **upserted**
(re-running updates names/passwords, never deletes). To import without
restarting: `node server/import.js`. When no CSVs exist, demo samples are seeded
so the app still runs out-of-the-box.

## PDF reports

Every completed checklist gets a report at `/report/<sessionId>` (the app links
it automatically). It's a print-optimized Marathi page — use the **Print** button
→ *Save as PDF*. Add `?print=1` to auto-open the print dialog.

## Testing

With the server running:

```bash
node server/smoke-test.js
```

44 end-to-end checks: login, shift + bus flows, repeat buses, edit, resume,
ownership rules, search, reports, report HTML, path-traversal guard.

## Backup

The entire database is the single file `data/app.db` — copy it anywhere to back
up. (Also copy `data/app.db-wal` if the server is running at the time, or stop
the server first for a clean copy.)

**Remote backup:** set the `ADMIN_KEY` environment variable, then download a
consistent snapshot any time from `https://<your-app>/backup?key=<ADMIN_KEY>`.
Do this weekly (or daily) when hosted in the cloud.

## Deploying to Render (public URL, phones anywhere)

One-time setup:

1. Push this folder to a **GitHub** repository (see commands below).
2. On [render.com](https://render.com): **New + → Blueprint**, pick the repo.
   Render reads `render.yaml` and creates the service automatically.
3. Wait for deploy → your app is live at `https://msrtc-checklist.onrender.com`
   (name varies). Supervisors open that URL on any phone.

```bash
git init && git add -A && git commit -m "MSRTC checklist"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

**Database durability on Render — read this:**

| Plan | What happens to data |
|------|----------------------|
| **Starter (~$7/mo)** + the 1 GB disk in `render.yaml` | ✅ Safe. DB lives on a persistent disk (`/data`), survives deploys/restarts. |
| **Free** | ⚠️ Filesystem is wiped on every deploy/restart/idle-wake, and the service sleeps after 15 min (first request then takes ~50 s). OK for **testing only** — real inspection records will be lost. |

`render.yaml` is currently configured for the **free plan**. To upgrade later:
set `plan: starter` and uncomment the `disk:` block and `DATA_DIR` env var in
`render.yaml`, then `git push` — Render applies it automatically.

**Free-plan survival guide:**
- Master data is safe: `data/locations.csv` + `data/employees.csv` re-import on
  every boot because they ship with the code.
- Inspection records are NOT safe — **download `/backup?key=<ADMIN_KEY>`
  regularly** (e.g. every evening). The key is in the service's *Environment* tab.
- Reduce sleep-wakes (and ~50 s cold starts): create a free monitor at
  [uptimerobot.com](https://uptimerobot.com) that pings
  `https://<your-app>/health` every 10 minutes.

Your real master data deploys with the code: commit `data/locations.csv` and
`data/employees.csv` (they are *not* gitignored — only `app.db` is) and every
deploy re-imports them. Updating an employee = edit CSV → `git push`.

Backups on Render: the `ADMIN_KEY` env var is auto-generated (see the service's
Environment tab) — download snapshots from `/backup?key=...` regularly.

## Differences from the Google version

- Google Sheet → SQLite file (`data/app.db`); Drive PDFs → `/report/:id` pages.
- No 10-million-cell limit, so the archive/chaining machinery was dropped.
- PDFs are generated by the browser's print dialog instead of Drive (v2 option:
  add Puppeteer for true server-side PDF files).
- Same simple auth model as before (internal use): default password = employee ID.
  Keep the server on a private network.
