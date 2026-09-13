# movie_base — Кіноклуб / Movie Club

Modern rebuild of the movie club site (`movie_base`), hosted on **GitHub Pages** with all data stored in **Firebase Realtime Database**. UI language: **Ukrainian by default**, English optional (one click).

## What's inside

| Feature | Details |
|---|---|
| Full original data preserved | All 53 movies (ids 3–55) with Dima / Deni / Yura / Ihor ratings and watch dates |
| Modern design (v2) | Light theme by default — soft neutral canvas, floating cards, large radii, indigo→violet accent gradient, glass sticky header, segmented navigation, tinted rating chips, smooth micro-animations. Dark theme one click away |
| Ukrainian UI (default) + EN toggle | The whole interface is Ukrainian out of the box; the **UA/EN** button in the header switches instantly (choice persists) |
| Visible theme toggle | Sun/moon icon button in the header — light is the default, dark is one click; both themes re-theme the charts |
| List & Grid views | **List** (default) — clean data table, no posters. **Grid** — poster cards with floating rating badges |
| Details on click | Click any movie (row or card) — poster, full info, IMDb/Wikipedia links, Fetch info / Edit / Delete |
| Minimal add flow | Enter **only the title and release year** — original title, director, country, genre, IMDb/Wikipedia links and poster are fetched automatically from Wikipedia / Wikidata. Saving waits for the lookup to finish |
| **Fully editable metadata** | Every fetched field (original title, director, country, genre, wiki/imdb/poster URLs) is a **regular editable input** in both the add form and the edit modal. Anything you type by hand is **never overwritten** by the automatic lookup — so custom Ukrainian titles, corrected directors or manual poster URLs always win. The edit modal never auto-replaces data on open; use **Знайти дані / Fetch data** or edit the title/year to re-run the search |
| One country spelling | Country names are normalized on display **and** in the database — "Сполучені Штати Америки" → **США**, so filters and statistics never split a country in two |
| Reliable auto posters | Posters resolve automatically through a fallback chain: the linked wiki (any language) → en/uk wiki → year-based wiki search (skips disambiguation pages) → IMDb-ID→Wikidata lookup. A poster is also auto-patched in the background after saving and when opening a movie that has links but no poster. The **Fetch info** button stays as a last resort |
| Firebase Realtime Database | **Single source of truth** — every add/edit/delete is written to Firebase instantly |
| Auto-save | Always on (hidden param in `js/app.js`, no toggle UI) |
| Live updates | Always on — all open browser tabs/windows update in real time via `onValue()` |
| Offline backup | Latest Firebase snapshot is cached in `localStorage` automatically (read-only fallback when offline) |
| JSON backup tools | Export / Import JSON in the **Manage** tab (backup only, not the primary store) |
| Rich movie info | Title (UA + original), **release year**, **country**, **director**, genre, **club season**, watch date |
| Stats tab | 8 KPIs + **14 charts**: movies & avg rating by decade, movies by season, watching activity per year, movies by release year, countries, genres, most watched directors, **directors by average rating (min 2 films)**, **avg rating by country**, **avg rating by genre**, rating distribution, raters comparison, top 10 movies |

## Adding movies

In the **Керування / Manage** tab you only type:

- **Назва / Title** — as the club knows it (Ukrainian or original)
- **Рік випуску / Release year** — helps pick the right film
- **Дата перегляду / Watched on** — club data (fills the season/stats)
- the four raters' scores

Everything else happens automatically: the app searches Ukrainian/English Wikipedia and Wikidata labels, shows the matching films (pick one if several), and fills the editable detail fields — original title, director, country, genre, IMDb link, Wikipedia link and poster. **Every field stays editable** — fix anything before or after the fetch, and your edits are saved exactly as typed.

Already-added movies: open a movie → **Оновити дані / Fetch info**, or open **Редагувати / Edit** and press **Знайти дані / Fetch data** (the edit modal deliberately does NOT auto-pick anything on open, so your data is never silently replaced). Movies opened with no metadata at all are auto-enriched once in the background.

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
- `poster` / `imdb` / `wiki` / `director` / `country` / `genre` / `titleEn` — auto-filled from Wikipedia / Wikidata into editable fields, or typed by hand
- `original/movie_base_20251001.html` — archived copy of the old site for reference

## Tech stack

- Vanilla ES modules (no build step) — works out of the box on GitHub Pages
- `js/i18n.js` — Ukrainian/English dictionary + plural rules, no dependencies
- Firebase JS SDK v10 (modular, loaded from gstatic CDN)
- Chart.js 4 (CDN)
- Posters: language-aware chain (Wikipedia REST `page/summary` → Action API `pageimages` with `pilicense=any` → Wikidata P18), cached in `localStorage` with in-flight deduplication

## Metadata note

Metadata is fetched automatically from Wikipedia / Wikidata (IMDb ID comes from Wikidata's P345 property) into **editable form fields** — the app never silently replaces a value you typed. Posters resolve even when the wiki link points to a disambiguation page or the poster lives on another language wiki, and are patched into the database automatically. If something is still off for a specific movie — open it and press **Оновити дані / Fetch info**, or edit its fields by hand in **Редагувати / Edit**.
