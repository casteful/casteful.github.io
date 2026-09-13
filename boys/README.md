# Movie Base / Кінобаза

A modern, zero-dependency refactor of the original DBeaver HTML table export
(`movie_base` — 53 movies rated by Dima, Deni, Yura and Ihor since 2019).

Static site — ready for **GitHub Pages**. No build step, no frameworks, no npm.
All original data is preserved 1:1 in `data/movies.json` — and now also synced
to a **Firebase Realtime Database** (Google Cloud) for live multi-device saving.

## Features

- Dark "cinema" UI (light theme included), UA / EN language toggle
- **Two tabs: Movies & Stats**
- Movies tab: per-reviewer cards, summary, ratings distribution, table + card
  views, search, sorting (click any column header), reviewer filter
- Add / edit / delete movies with per-reviewer "watched" toggles and 1–10 sliders
  (`0` = not watched, exactly like the original data)
- Optional **release year** per movie (used for the decade stats; shows as a tag
  in the table)
- **Stats tab with charts** (Chart.js): movies by decade, average rating by
  decade, watches per year, all ratings 1–10, reviewer tastes by decade (radar),
  top-10 movies, biggest rating disagreements, latest watches, KPI cards
- **Four ways to save data** (see below)
- Works even opened directly from disk (`index.html` double-click) thanks to an
  embedded data snapshot; online it always loads the canonical `data/movies.json`

## Deploy to GitHub Pages

Copy the contents of this folder into your existing repo path (e.g. the `movies/`
folder of `oneman72hourgamejam.github.io`, or the root of the `movies` repo):

```bash
git add .
git commit -m "Movie Base: modern redesign"
git push
```

That's it — GitHub Pages serves it as-is. Prefer relative paths are already used,
so sub-path hosting (`/movies/`) works out of the box.

## Saving data

The site is static, so data is saved in four complementary ways:

### 0. Firebase Realtime Database — live cloud sync (recommended for the group)
**Data → Firebase cloud database**. The whole database lives at
`movie_base` in your RTDB (`movies-93171`, europe-west1) — the project config is
embedded in `assets/js/firebase.js`.

- **Save to Firebase** — writes the full snapshot to the cloud right now.
- **Load from Firebase** — pulls the cloud copy (adopted only if it is newer).
- **Auto-save to cloud** — every add/edit/delete is pushed automatically
  (debounced ~1.6 s). The cloud icon in the header turns green when connected.
- **Live updates** — while enabled, changes made by any other reviewer appear on
  your screen instantly (last write wins; the freshest `updatedAtMs` snapshot
  wins, so all devices converge on the same data).

One-time setup in the [Firebase console](https://console.firebase.google.com/project/movies-93171/database):
Realtime Database → **Rules** — allow read/write for the app, e.g.:

```json
{
  "rules": {
    "movie_base": {
      ".read": true,
      ".write": true
    }
  }
}
```

> The current test-mode rules expire after a set period — replace them with the
> rule above (or with auth-based rules) to keep syncing working. The database
> already contains a full backup of all 53 movies.

### 1. Automatic (every visitor)
Every edit is instantly saved to the browser's `localStorage`. Changes survive
page reloads on the same device. Use **Data → Discard local changes** to reset.

### 2. Manual (portable)
**Data → Download JSON** gives you the full database file — commit it to the repo
as `data/movies.json` and every visitor sees the update. CSV export is also
available (opens in Excel / Google Sheets).

### 3. One-click commit to GitHub (recommended owner workflow)
**Data → GitHub sync** commits `data/movies.json` directly to your repository
from the browser, via the GitHub API:

1. Create a fine-grained personal access token:
   https://github.com/settings/personal-access-tokens/new
   - **Repository access**: only select your movies repository
   - **Permissions → Repository permissions → Contents**: `Read and write`
2. Open **Data** on the site, fill in Owner / Repository / Branch / File path
   (auto-suggested when hosted on `github.io`) and paste the token.
   - If the repo is `oneman72hourgamejam.github.io` and files live in `movies/`,
     the path is `movies/data/movies.json`.
   - If the repo is `movies`, the path is `data/movies.json`.
3. Press **Test** to verify, then **Save to GitHub** — done, the commit appears
   in the repo and on the site after a refresh.

The token is stored only in your browser (never sent anywhere except
`api.github.com`).

## Data format (`data/movies.json`)

```json
{
  "name": "movie_base",
  "version": 2,
  "updatedAt": "2026-09-13T12:00:00Z",
  "reviewers": [
    { "key": "dima", "name": "Dima" },
    { "key": "deni", "name": "Deni" },
    { "key": "yura", "name": "Yura" },
    { "key": "ihor", "name": "Ihor" }
  ],
  "movies": [
    { "id": 55, "title": "Фантазм 2", "dima_rate": 7, "deni_rate": 7,
      "yura_rate": 9, "ihor_rate": 7, "year": 1988, "date_created": "2025-08-30" }
  ]
}
```

Column names match the original database export exactly, so the JSON round-trips
back into your DB if ever needed. A rating of `0` means "not watched" — it is
kept in the data for fidelity and displayed as `—` (excluded from averages).
`year` is an optional addition (release year, filled in for 44 of 53 films
where the film was identified with confidence; edit any movie to fix or add it).

## Stats tab

The **Stats** tab gives the group a monitoring dashboard:

- KPI cards: movies, ratings given, overall average, decades covered, top
  decade, watched this year
- **Movies by decade** and **average rating by decade** (release year when
  known, otherwise the watch date — see the note on the tab)
- Watches per year, all individual ratings 1–10
- Reviewer tastes by decade (radar, one line per reviewer)
- Top-10 movies by average rating
- Biggest disagreements (largest spread between reviewers) and latest watches

Charts are rendered by Chart.js loaded from a CDN; without internet the KPI
cards and lists still work.

## Local development

Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Structure

```
index.html          app shell + embedded data snapshot (offline fallback)
data/movies.json    canonical data file (edit freely or via UI + sync)
assets/css/style.css
assets/js/i18n.js   UA/EN strings
assets/js/icons.js  inline SVG icons
assets/js/store.js  state, persistence, stats, import/export
assets/js/github.js GitHub Contents API client
assets/js/firebase.js Firebase RTDB sync (config embedded, SDK lazy-loaded)
assets/js/stats.js  Stats tab: KPIs, Chart.js graphs, highlight lists
assets/js/render.js stats / table / cards rendering
assets/js/main.js   boot, events, modals, tabs, sync UI
```

External CDNs: Google Fonts, Chart.js 4, Firebase JS SDK 10 (compat builds,
loaded lazily only when cloud sync is used).
