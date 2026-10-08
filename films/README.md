# Фільмотека — Movie Night Rating App

A minimalistic film-rating web app for a group of friends. Fully in Ukrainian,
light/dark theme, built as a **zero-build static site** — perfect for GitHub Pages.

## Features

- **Effortless rating — ten golden stars** — one tap on «Оцінити» opens a 10-star scale right next to the button (a large bottom sheet on phones). Stars fill with a red→green ramp up to the chosen value (each star keeps its own level colour), a big number + word caption («Добре», «Шедевр»…) reacts live to hovering, and a tap saves instantly. The same stars live in the film window. Keyboard: digits 1–9, 0 = 10, ←/→, Esc.
- **Telegram pushes** — an elegant one-line Ukrainian message lands in your group when someone adds or deletes a film, or rates / changes / removes a rating (e.g. «surguy оцінив фільм «Інтерстеллар» на 8/10», «surguy змінив оцінку: 7 → 9»). Setup is one person's job: tap the paper-plane in the header, paste a free @BotFather token, add the bot to the group, send /start there — the app finds the chat automatically and stores the shared config in Firebase. Pushes are sent by the acting device only (no duplicates) and never block or break the UI; failures stay silent. The plane button gets a green dot while notifications are on.
- **Cinematic card grid** — vertical poster cards with the average score on the poster, a full-width rate button and friends' scores as colored chips; 2-column layout on phones. A compact **table** view with a rating column per friend is one tap away; both views remember your choice.
- **Beautiful film window** — poster blurred into a hero header with the title, director, genres and cast; the 10-star scale for your own score; everyone's scores in one list.
- **Smart adding** — start typing a film name (Ukrainian or English) and pick it from live suggestions; poster, year, Ukrainian title, director, cast, genres, runtime and plot are fetched automatically (IMDb + Wikipedia + Wikidata). Everything stays manually editable.
- **Clickable people & genres** — tap any director, actor or genre (in the film window or in statistics) to see all matching films of the club.
- **Statistics tab** — totals (films, ratings, average, shared cinema-hours, most active viewer), club records (best / worst / most controversial / most discussed / oldest / newest), top films, favourite genres, top actors and directors, rating histogram, decades, runtime stats and per-viewer profiles («strictest critic» vs «most generous viewer»).
- **Modern UI (v3)** — warm-amber identity with gradient accents, glass topbar, springy micro-animations, refined dark theme, soft “projector” glow, thin scrollbars, reduced-motion support.
- **iPhone / mobile friendly (v3.1)** — the suggestion dropdown is anchored directly under the search field (fixed a positioning bug that pushed it off-screen), touch selection works via `touchend`, inputs are 16 px on touch devices so iOS never auto-zooms the page, the rating sheet sits above its backdrop (tappable scores), body scroll is locked behind modals/sheets, and safe-area insets keep the UI clear of the notch and home indicator.
- **Light / dark theme** — toggle in the header, remembered per device (browser UI color adapts too).
- **Realtime** — all data lives in Firebase Realtime Database, so everyone sees updates instantly. Missing posters are re-fetched automatically in the background.

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
- **OMDb poster fallback (optional)**: get a free API key at
  <https://www.omdbapi.com/apikey.aspx> and paste it into `OMDB_API_KEY`
  in `js/config.js`. With a key, OMDb joins the poster fallback chain
  (after TVMaze / Wikidata P18, before the Wikipedia title search);
  without a key the app silently skips it.
- **Telegram notifications**: none needed in code — use the ✈ button in
  the header (see above). To move to another bot/chat, just reconnect;
  config lives in the `tgConfig` node of the shared database.
- Profile choice, theme, list view and sorting are stored in each browser's
  `localStorage` (`films_user`, `films_theme`, `films_view`, `films_sort`).

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
tgConfig/
  enabled:    true
  token:      "123456:AA..."   # from @BotFather
  chatId:     -1002222...      # group chat id (found via getUpdates)
  chatTitle:  "Кіноклуб"
```

## Tech notes

- Vanilla JavaScript ES modules, no frameworks, no build tools.
- Firebase JS SDK v10 loaded from the official CDN.
- **Fast autocomplete** — IMDb and Wikipedia are queried in parallel with short
  timeouts; results are cached per query, so repeating a name is instant.
  Typical first suggestions appear in well under a second.
- **Films + series, both sources always** — IMDb suggestions paint first, then
  Wikipedia results are merged in (progressively, no duplicates). This matters
  for series: IMDb's suggestion endpoint often doesn't know them by full name
  (e.g. «Monster: The Ed Gein Story»), while Wikipedia does — so the two lists
  are always combined and an exact-title match (Ukrainian or original) is
  raised to the top. Suggestions that arrive without a poster get one quietly
  filled in from fast sources (IMDb by tt-ID → TVMaze) in the background.
- **All matches in one scrollable list** — up to 20 suggestions from IMDb and
  both Wikipedia sections. The dropdown scrolls, with a results counter in the
  footer («Усього N збігів — гортайте список»); touching the list to scroll
  never accidentally picks a row (touch-move guard in `js/film-form.js`).
- **Ukrainian → English transliteration fallback** — when a Cyrillic query
  finds fewer than 10 matches, the title is transliterated to Latin (official
  KMU-2010 plus phonetic and g-variants: «Інтерстеллар» → "Interstellar",
  «Джокер» → "Joker", «Гладіатор» → "Gladiator") and searched on IMDb and in
  English Wikipedia; everything is merged into the same list.
- **«Title 2007» / «title (2007)» queries** — the trailing year is split off:
  IMDb still gets the full query (it understands title+year), Wikipedia gets
  the title only (a year in full-text search used to push episode lists and
  seasons to the top), and results whose year matches are boosted to the top.
  TV-series seasons (`Q3464665`) and Wikimedia list pages (`Q13406463`) are
  filtered out of suggestions entirely.
- **Correct Ukrainian plot** — enrichment resolves the exact uk.Wikipedia
  article of the film/series through its Wikidata sitelink instead of a blind
  title search (which used to fetch the cosmology article for «Теорія
  великого вибуху»); search-based plot candidates must look film-like
  (mentions фільм/серіал…) and never disambiguation pages, and an
  English-sourced plot is replaced by the Ukrainian one when available.
- Film sources:
  1. Public IMDb suggestion endpoint (`v3.sg.media-imdb.com` / `v2` mirror,
     raced in parallel, 3 s cap).
  2. **Wikipedia fallback** (`js/wiki.js`) — used automatically when IMDb is
     unreachable (CORS / network block) or finds nothing (e.g. a Ukrainian
     title). Searches Ukrainian and English Wikipedia (fast prefix search
     first, full-text on top), resolves each article's Wikidata item via the
     fast `wbgetentities` API and keeps only real films (books, actors,
     episodes, seasons etc. are filtered out). Results are painted
     progressively — whichever source answers first is shown immediately —
     and marked with a «Вікіпедія» badge in the dropdown.
- If IMDb fails, the app remembers it for 10 minutes (sessionStorage) and
  searches Wikipedia first — no timeout waiting on every keystroke. The flag
  clears itself as soon as IMDb answers again.
- Details enrichment: Wikidata (queried by IMDb ID `P345` or Wikidata `QID`)
  with a Ukrainian Wikipedia fallback for plot text — all optional and fail-safe.
- Poster chain (first hit wins): IMDb by `tt`-ID → Wikidata sitelinks
  (uk → en → **ru** Wikipedia, the latter two serve fair-use posters through
  the API when en doesn't) → **TVMaze** (free, CORS-open — the best source for
  series key art) → Wikidata `P18` → Wikipedia article search by title with a
  release-year sanity check so a same-named older film can't donate its poster.
- Poster images are hot-linked from the IMDb/Amazon image CDN, TVMaze or Wikimedia.

### Mobile / iOS specifics

- The autocomplete list is a child of the positioning wrapper (`.suggest-wrap`)
  and is placed at `top: calc(100% + 6px)` — always right under the search field.
- Suggestions are picked on `touchend` (with `preventDefault`, so the keyboard
  and focus state stay stable), with `mousedown`/`click` fallbacks for desktop;
  a 350 ms guard prevents double-picks.
- `@media (pointer: coarse), (hover: none)` raises all inputs to 16 px —
  iOS Safari otherwise zooms into any smaller field and breaks the layout.
- On phones the modal overlay drops `backdrop-filter` (a WebKit bug prevents
  dynamically shown children from painting inside a fixed, scrollable,
  backdrop-filtered element).
- The mobile rating sheet uses `z-index` below its panel, so taps reach the
  score segments instead of the backdrop.
