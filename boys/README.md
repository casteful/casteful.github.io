# movie_base — Movie Club

Modern rebuild of the movie club site (`movie_base`), hosted on **GitHub Pages** with all data stored in **Firebase Realtime Database**.

## What's inside

| Feature | Details |
|---|---|
| Full original data preserved | All 53 movies (ids 3–55) with Dima / Deni / Yura / Ihor ratings and watch dates |
| Modern design | Light theme by default — soft neutral canvas, floating cards, pill navigation, tinted rating chips, blurred sticky header. Dark theme optional |
| List & Grid views | **List** (default) — clean borderless data table, no posters. **Grid** — poster cards with floating rating badges |
| Details on click | Click any movie (row or card) — poster, full info, IMDb/Wikipedia links, Fetch info / Edit / Delete |
| Minimal add flow | Enter **only the title and release year** — original title, director, country, genre, IMDb/Wikipedia links and poster are fetched automatically from Wikipedia / Wikidata (IMDb ID comes from Wikidata). Saving waits for the lookup to finish, so records are never stored half-empty |
| One country spelling | Country names are normalized on display **and** in the database — e.g. "Сполучені Штати Америки" and "США" both become **США**, so filters and statistics never split a country in two |
| Reliable auto posters | Posters resolve automatically through a fallback chain: the linked wiki (any language) → en/uk wiki → year-based wiki search (skips disambiguation pages) → IMDb-ID→Wikidata lookup. The manual **Fetch info** button stays as a last resort |
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

## Adding movies

In the **Manage** tab you only type:

- **Title** — as the club knows it (Ukrainian or original)
- **Release year** — helps pick the right film
- **Watched on** — club data (fills the season/stats)
- the four raters' scores

Everything else happens automatically: the app searches Ukrainian/English Wikipedia and Wikidata labels, shows the matching films (pick one if several), and fills in the original title, director, country, genre, release year, IMDb link, Wikipedia link and poster. If several films match, a small list appears — click the right one. **Save waits for the lookup to finish**, so clicking *Save to Firebase* quickly still stores the full metadata.

Already-added movies can be enriched the same way: open a movie → **Fetch info** (or open **Edit** and re-trigger the search by editing the title/year). Movies opened with no metadata at all are auto-enriched once in the background — no button press needed.

The lookup uses free public APIs — no keys:
- Wikipedia Action API (uk + en) — page search, thumbnails
- Wikidata `wbsearchentities` — label search (finds Ukrainian film titles)
- Wikidata claims — P577 year, P57 directors, P495 country, P136 genres, P345 IMDb ID, P18 poster
- Country names are canonicalized on save (`normalizeCountry()` in `js/data.js`); a one-time cleanup also rewrites old records that still hold variant spellings

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

- `season` = club season (auto-filled from the watch date)
- `rates` value `0` = not rated (excluded from averages, shown as `—`)
- `poster` / `imdb` / `wiki` / `director` / `country` / `genre` / `titleEn` — filled automatically from Wikipedia / Wikidata when adding a movie or pressing **Fetch info**
- `original/movie_base_20251001.html` — archived copy of the old site for reference

## Tech stack

- Vanilla ES modules (no build step) — works out of the box on GitHub Pages
- Firebase JS SDK v10 (modular, loaded from gstatic CDN)
- Chart.js 4 (CDN)
- Posters: language-aware chain (Wikipedia REST `page/summary` → Action API `pageimages` with `pilicense=any` → Wikidata P18), cached in `localStorage` with in-flight deduplication

## Metadata note

Metadata is fetched automatically from Wikipedia / Wikidata (IMDb ID comes from Wikidata's P345 property). Posters resolve even when the wiki link points to a disambiguation page or the poster lives on another language wiki. If something is still off for a specific movie — open it and press **Fetch info** to retry, or use **Edit** and re-run the lookup by adjusting the title/year.
