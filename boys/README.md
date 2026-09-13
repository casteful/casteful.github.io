# movie_base — Movie Club

Modern rebuild of the movie club site (`movie_base`), hosted on **GitHub Pages** with all data stored in **Firebase Realtime Database**.

## What's inside

| Feature | Details |
|---|---|
| Full original data preserved | All 53 movies (ids 3–55) with Dima / Deni / Yura / Ihor ratings and watch dates |
| Original design | Light theme by default, styled after the source table: white background, blue borders, zebra rows |
| List & Grid views | **List** (default) — the original table look, no posters. **Grid** — compact poster cards |
| Details on click | Click any movie (row or card) — poster, full info, IMDb/Wikipedia links, Edit / Delete |
| Minimal UI | Plain text tabs and buttons, no decorative icons — all info kept |
| Firebase Realtime Database | **Single source of truth** — every add/edit/delete is written to Firebase instantly |
| Auto-save | Always on (hidden param in `js/app.js`, no toggle UI) |
| Live updates | Always on — all open browser tabs/windows update in real time via `onValue()` |
| Offline backup | Latest Firebase snapshot is cached in `localStorage` automatically (read-only fallback when offline) |
| JSON backup tools | Export / Import JSON in the **Manage** tab (backup only, not the primary store) |
| Rich movie info | Title (UA + original), **release year**, **country**, **director**, genre, **club season**, watch date |
| Links & posters | IMDb + Wikipedia links, poster auto-fetched from Wikipedia (or set a manual poster URL) |
| Stats tab | KPIs + 10 charts: movies & avg rating by decade, movies by season, activity per year, countries, top directors, genres, rating distribution, raters comparison, top 10 movies |
| Dark theme | Optional — toggle in the header; light stays the default |

## Deploy to GitHub Pages

1. **Create/use a repo** — e.g. `oneman72hourgamejam.github.io` with this site in the `/movies` folder, or a standalone repo named e.g. `movies`.

2. **Copy all files** from this folder (`index.html`, `css/`, `js/`, `original/`) into the repo folder.

3. **Set up Firebase rules** — open [Firebase Console](https://console.firebase.google.com/) → project `movies-93171` → **Realtime Database** → **Rules** tab, paste:

   ```json
   {
     "rules": {
       "movies": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```

   Note: these rules are open (fine for a private hobby tracker). If you want to restrict writes later, look at Firebase Auth-based rules — the code is ready for it.

4. **Enable GitHub Pages** — repo *Settings* → *Pages* → Source: `main` branch, `/ (root)` (or `/docs` if you keep the site there). Open `https://<username>.github.io/<repo>/`.

5. **First run seeding** — the app detects an empty `movies` node in Firebase and automatically uploads the built-in dataset (53 movies with full metadata). No manual import needed.

## Local preview

```bash
# from this folder — ES modules require an http server (not file://)
python3 -m http.server 8080
# open http://localhost:8080
```

## Data model (Firebase `movies/<id>`)

```json
{
  "id": 55,
  "title": "Фантазм 2",
  "titleEn": "Phantasm II",
  "year": 1988,
  "country": "США",
  "director": "Дон Коскареллі",
  "genre": "Жахи, Фантастика",
  "season": "2025",
  "date": "2025-08-30",
  "imdb": "https://www.imdb.com/title/tt0098173/",
  "wiki": "https://en.wikipedia.org/wiki/Phantasm_II",
  "poster": "",
  "rates": { "dima": 7, "deni": 7, "yura": 9, "ihor": 7 }
}
```

- `season` = club season (defaults to the year of the watch date, editable)
- `rates` value `0` = not rated (excluded from averages, shown as `—`)
- `poster` empty → auto-fetched from the Wikipedia page of the movie
- `original/movie_base_20251001.html` — archived copy of the old site for reference

## Tech stack

- Vanilla ES modules (no build step) — works out of the box on GitHub Pages
- Firebase JS SDK v10 (modular, loaded from gstatic CDN)
- Chart.js 4 (CDN)
- Posters via Wikipedia REST API (`page/summary`), cached in `localStorage`

## Metadata note

Release year / country / director / links were researched from the original Ukrainian titles (verified via Wikipedia). If any field is off for a specific movie — click the movie, press **Edit** in the details panel, fix it, and it saves to Firebase instantly.
