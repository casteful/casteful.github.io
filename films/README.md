# Фільмотека — Movie Night Rating App

A minimalistic film-rating web app for a group of friends. Fully in Ukrainian,
light/dark theme, built as a **zero-build static site** — perfect for GitHub Pages.

## Features

- **Easy rating** — open any film and tap one of ten color-coded chips (1–10, red → green). Tap the same chip again to remove your rating.
- **Smart adding** — start typing a film name and pick it from live IMDb suggestions; poster, year, Ukrainian title, director, genres, runtime and plot are fetched automatically (IMDb suggestion API + Wikidata + Ukrainian Wikipedia). Everything stays manually editable.
- **Editing & deleting** — any member can edit or remove any film (pencil icon on the card or inside the film window).
- **Profiles** — on first visit everyone picks their name (surguy, q1oob, dimyeah, burlaka21, oddfriend); it's remembered on that device.
- **Statistics tab** — total films/ratings, average score, top-rated films, rating distribution histogram, films by decade, top directors, and a per-viewer profile (average, favorite film, "strictest critic" vs "most generous viewer").
- **Light / dark theme** — toggle in the header, remembered per device.
- **Realtime** — all data lives in Firebase Realtime Database, so everyone sees updates instantly.

## Deploy to GitHub Pages (no build step needed)

1. Create a new repository on GitHub (e.g. `films`).
2. Upload **all files from this folder** to the repo, keeping the structure:

   ```
   index.html
   .nojekyll
   README.md
   css/style.css
   js/*.js
   ```

   Easiest way: drag & drop the folder contents on the GitHub "Upload files" page, or:

   ```bash
   git init
   git add .
   git commit -m "Filmoteka"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo>.git
   git push -u origin main
   ```

3. In the repo: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"** → Branch: `main`, Folder: `/ (root)` → **Save**.
4. In a minute the app will be live at `https://<your-username>.github.io/<repo>/`.

All paths are relative, so the app works under any repository subpath. Nothing to install, nothing to build.

## Firebase setup

Your Firebase project config is already embedded in `js/config.js`. The only thing
to verify is database access rules. If you see a "Немає доступу до бази даних"
error, open **Firebase Console → Realtime Database → Rules** and publish:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> This means anyone with the link can read/write the data. It's the standard
> trade-off for a no-auth app on the free plan — fine for a private friends'
> club, but don't share the URL publicly.

## Customization

- **Add / remove friends**: edit the `USERS` array in `js/config.js`
  (id, display name, avatar color).
- **Change Firebase project**: edit `firebaseConfig` in `js/config.js`.
- Profile choice and theme are stored in each browser's `localStorage`
  (`films_user`, `films_theme`).

## Data model (Realtime Database)

```
films/
  <pushId>/
    title:      "The Shawshank Redemption"
    titleUk:    "Втеча з Шоушенка"
    year:       1994
    poster:     "https://m.media-amazon.com/..."
    imdbId:     "tt0111161"
    director:   "Френк Дарабонт"
    genres:     ["драматичний фільм", "кримінальний фільм"]
    runtime:    142
    plot:       "«Втеча з Шоушенка» — ..."
    addedBy:    "surguy"
    createdAt:  1728300000000
    updatedAt:  1728300000000
    ratings:
      surguy:   9
      q1oob:    8
```

## Tech notes

- Vanilla JavaScript ES modules, no frameworks, no build tools.
- Firebase JS SDK v10 loaded from the official CDN.
- Film autocomplete: public IMDb suggestion endpoint (`v3.sg.media-imdb.com`).
- Details enrichment: Wikidata SPARQL (queried by IMDb ID `P345`) with a
  Ukrainian Wikipedia fallback for plot text — all optional and fail-safe.
- Poster images are hot-linked from the IMDb/Amazon image CDN.
