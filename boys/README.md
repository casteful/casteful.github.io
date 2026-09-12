# Movie Base / Кінобаза

A modern, zero-dependency refactor of the original DBeaver HTML table export
(`movie_base` — 53 movies rated by Dima, Deni, Yura and Ihor since 2019).

Static site — ready for **GitHub Pages**. No build step, no frameworks, no npm.
All original data is preserved 1:1 in `data/movies.json`.

## Features

- Dark "cinema" UI (light theme included), UA / EN language toggle
- Stats dashboard: per-reviewer averages, ratings given, best movie, watching period
- Distribution chart of average ratings
- Table + card views, search, sorting (click any column header), reviewer filter
- Add / edit / delete movies with per-reviewer "watched" toggles and 1–10 sliders
  (`0` = not watched, exactly like the original data)
- **Three ways to save data** (see below)
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

The site is static, so data is saved in three complementary ways:

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
  "updatedAt": "2025-10-01T22:19:13Z",
  "reviewers": [
    { "key": "dima", "name": "Dima" },
    { "key": "deni", "name": "Deni" },
    { "key": "yura", "name": "Yura" },
    { "key": "ihor", "name": "Ihor" }
  ],
  "movies": [
    { "id": 55, "title": "Фантазм 2", "dima_rate": 7, "deni_rate": 7,
      "yura_rate": 9, "ihor_rate": 7, "date_created": "2025-08-30" }
  ]
}
```

Column names match the original database export exactly, so the JSON round-trips
back into your DB if ever needed. A rating of `0` means "not watched" — it is
kept in the data for fidelity and displayed as `—` (excluded from averages).

## Local development

Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Structure

```
index.html          app shell + embedded data snapshot (offline fallback)
data/movies.json    canonical data file (edit freely or via UI + GitHub sync)
assets/css/style.css
assets/js/i18n.js   UA/EN strings
assets/js/icons.js  inline SVG icons
assets/js/store.js  state, persistence, stats, import/export
assets/js/github.js GitHub Contents API client
assets/js/render.js stats / table / cards rendering
assets/js/main.js   boot, events, modals, sync UI
```
