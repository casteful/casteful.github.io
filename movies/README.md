# Фільмотека — Movie Night Rating App

A minimalistic film-rating web app for a group of friends. UI in Ukrainian,
film **metadata in English** (titles in both Ukrainian and English),
light/dark theme, built as a **zero-build static site** — perfect for GitHub Pages.

## Features

- **Effortless rating — ten golden stars** — one tap on «Оцінити» opens a 10-star scale right next to the button (a large bottom sheet on phones). Stars fill with a red→green ramp up to the chosen value (each star keeps its own level colour), a big number + word caption («Добре», «Шедевр»…) reacts live to hovering, and a tap saves instantly. The same stars live in the film window. Keyboard: digits 1–9, 0 = 10, ←/→, Esc.
- **Telegram pushes** — an elegant one-line Ukrainian message lands in your group when someone adds or deletes a film, or rates / changes / removes a rating (e.g. «Діма оцінив фільм «Інтерстеллар» на 8/10», «Діма змінив оцінку: 7 → 9»). Setup is one person's job: open the single ⚙ button in the header (Telegram-сповіщення section), paste a free @BotFather token, add the bot to the group, send /start there — the app finds the chat automatically and stores the shared config in Firebase. Pushes are sent by the acting device only (no duplicates) and never block or break the UI; failures stay silent. The ⚙ button gets a green dot while notifications are on.
- **Cinematic card grid** — vertical poster cards with the average score on the poster, a full-width rate button and friends' scores as compact fixed-size light-gray chips (colored dot + the score number in the friend's own color), left-aligned in a single row under the rate button (auto-compacting on narrow cards so even four «10» scores stay in one line); 2-column layout on phones. A compact **table** view with a rating column per friend is one tap away; both views remember your choice.
- **Beautiful film window** — poster blurred into a hero header with the title, director, genres and cast; the 10-star scale for your own score; everyone's scores in one list.
- **Smart adding** — start typing a film name (Ukrainian or English) and pick it from live suggestions; poster, year, both titles, director, cast, genres, runtime and plot are fetched automatically (IMDb + Wikipedia + Wikidata). **Titles are bilingual** — Ukrainian («Чудовисько: Історія Еда Ґіна») above the English original ("Monster: The Ed Gein Story") in suggestions, cards, the table and the film window; **remakes and same-name films are all listed separately (per year)**, **all other metadata is English-first** (director, cast, genres, plot come from en.Wikipedia / English Wikidata labels, with Ukrainian as fallback). **Series always get their premiere**: the year is filled from the premiere date (IMDb year-range, Wikidata P577, TVMaze) and the exact day shows as «Прем'єра: 24 вересня 2007» under the year field and in the film window. Everything stays manually editable. **Auto-translated Ukrainian titles** — when no source has a ready Ukrainian name (Wikidata without a uk label, no uk.wiki article: e.g. «Creep» 2004), the original title is machine-translated to Ukrainian (Google Translate, MyMemory fallback; junk-filtered, cached and **always capitalized** — «повзучість» → «Повзучість») and quietly filled into the title field for review; if an official uk name is found later (Wikidata), it replaces the machine translation.
- **Clickable people & genres** — tap any director, actor or genre (in the film window or in statistics) to see all matching films of the club.
- **Statistics tab** — totals (films, ratings, average, shared cinema-hours, most active viewer), club records (best / worst / most controversial / most discussed / oldest / newest), top films, favourite genres, top actors and directors, rating histogram, decades, runtime stats and per-viewer profiles («strictest critic» vs «most generous viewer»).
- **Modern UI (v3)** — warm-amber identity with gradient accents, glass topbar, springy micro-animations, refined dark theme, soft “projector” glow, thin scrollbars, reduced-motion support.
- **iPhone / mobile friendly (v3.1)** — the suggestion dropdown is anchored directly under the search field (fixed a positioning bug that pushed it off-screen), touch selection works via `touchend`, inputs are 16 px on touch devices so iOS never auto-zooms the page, the rating sheet sits above its backdrop (tappable scores), body scroll is locked behind modals/sheets, and safe-area insets keep the UI clear of the notch and home indicator. **Rating chips always fit in one row** — the per-friend score chips on grid cards are fixed-size (never stretch) and never wrap to a second line: cards are CSS containers and the chips auto-compact (smaller dot/padding/font, three size tiers) on narrow cards, so even four two-digit scores fit without clipping.
- **Settings: one button for notifications + DB backup & restore** — a single ⚙ button sits in the header (first in the row, exactly where the Telegram button used to live) and opens one window with two sections. **Telegram-сповіщення** — bot token, automatic chat search, test message, on/off toggle and disconnect, with a live status row. **База даних** — **Export** downloads the full database (every film with all ratings plus the shared Telegram config) as `filmmoteka-db-YYYY-MM-DD.json`, generated entirely in the browser; **Restore** picks such a file back, validates its structure, shows exactly what's inside (films / ratings / Telegram config) and — after an explicit confirmation — atomically replaces the database contents in one multi-path write (all-or-nothing). Perfect for backups or moving to another Firebase project.
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
- **Telegram notifications**: none needed in code — use ⚙ Settings →
  Telegram-сповіщення (see above). To move to another bot/chat, just reconnect;
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
    premiere:   "1994-09-10"          # full premiere date when known (optional)
    poster:     "https://m.media-amazon.com/..."
    imdbId:     "tt0111161"
    director:   "Frank Darabont"
    genres:     ["drama film", "crime film"]
    country:    "США"                  # one string, may list several countries
    season:     "2019"                 # club season (watch cycle)
    watchedAt:  "2019-08-28"           # date the club watched it (optional)
    runtime:    142
    plot:       "The Shawshank Redemption is a 1994 American…"
    addedBy:    "dima"
    createdAt:  1728300000000
    updatedAt:  1728300000000
    ratings:
      dima:     9
      deni:     8
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
  (e.g. «Monster: The Ed Gein Story» — on IMDb it is a season of the
  "Monster" anthology), while Wikipedia does — so the two lists are always
  combined and an exact-title match (Ukrainian or original) is raised to the
  top. **Same-title films of different years are different films** —
  «Creep» (2004), «Creep» (2014) and «Creep» (1995) all stay in the list
  (dedupe is title + year aware), Wikipedia rows like «Creep (2004 film)»
  are cleaned to «Creep · 2004» and merged with their IMDb twin — and the picked film's title fields get the clean name only («Creep», «Джокер»), never the article suffix «(2004 film)» / «(фільм, 2019)», and when
  a year is typed («creep 2004») Wikipedia is additionally queried with
  the year so the right article ranks first. Suggestions that arrive without a poster get one quietly filled in
  from fast sources in the background (en.Wikipedia by exact article name →
  Wikidata sitelinks → IMDb by tt-ID → TVMaze).
- **Seasons rescued when typed exactly** — Wikidata entities classified as a
  TV-series season (`Q3464665`) are normally filtered out of suggestions, BUT
  an entity whose English or Ukrainian label matches the user's query letter-
  for-letter is kept (that is exactly the show the user wants). This is how
  "Monster: The Ed Gein Story" (a season of the IMDb "Monster" anthology)
  appears as the first suggestion. A wrong IMDb ID from Wikidata (`P345`
  pointing to the anthology) is detected by comparing IMDb's own title for
  that tt-ID with the picked title and dropped, so the film is enriched via
  its correct Wikidata QID instead; TVMaze can supply the correct tt-ID later.
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
- **Series premiere dates** — Wikidata `P577` is often empty for series and
  IMDb suggestions carry only a start year, so the year is filled from a
  chain: IMDb `y` / `yr` range → Wikidata `P577` → **TVMaze `premiered`** (full
  date, matched by IMDb ID or exact title). When the full day is known it is
  stored as `premiere` ("2007-09-24"), shown as «Прем'єра: 24 вересня 2007»
  under the year field in the add/edit form and in the film window instead of
  the bare year. Year extraction from Wikipedia extracts also learned
  «2025 році», English "is a 2025 American…" and "premiered on October 3,
  2025" patterns (year near premiere/release keywords within the intro).
- **English-first metadata, bilingual titles** — the title is stored in both
  languages (`titleUk` + `title`); everything else prefers English: director,
  genres and cast use English Wikidata labels (en → uk fallback), and the
  plot comes from the exact en.Wikipedia article first (uk article / uk
  search / en search as fallbacks). Legacy Ukrainian genres in the database
  are normalized to English at aggregation time (`genreEn()` in
  `js/utils.js`), so statistics and filters group «драма» and "drama"
  together.
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
- Details enrichment: Wikidata (queried by IMDb ID `P345` or a direct QID)
  with an English-Wikipedia-first plot chain — all optional and fail-safe.
  The SPARQL endpoint stays as a fallback when the fast path returns nothing.
- Poster chain (first hit wins): IMDb by `tt`-ID → Wikidata sitelinks
  (**en → uk → ru** Wikipedia) → **TVMaze** (free, CORS-open — the best source
  for series key art) → Wikidata `P18` → Wikipedia article search by title
  (en → uk → ru) with a release-year sanity check so a same-named older film
  can't donate its poster.
- **`pilicense=any` on every `prop=pageimages` request** — MediaWiki defaults
  this parameter to `free`, which silently hides ALL fair-use film posters
  (almost every film poster on en.Wikipedia is fair-use). Without it en.wiki
  looked like it "had no posters"; with it nearly every suggestion row and
  film gets a thumbnail, because en.Wikipedia has an article for almost every
  film/series. Wiki-sourced images are guarded by a film-likeness check
  (extract text + disambiguation/redirect guard) so a generic title like
  "Parasite" can't pull the image from the biology article "Parasitism".
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
- **Phones get a 2×2 profile grid (portrait and landscape)** — the
  «Хто дивиться?» login sheet always shows two columns (Діма Денис /
  Ігор Юра) on touch devices: portrait via
  `@media (orientation: portrait) and (max-width: 640px)` (original
  avatar-above-name cards, just 2×2), landscape via
  `@media (orientation: landscape) and (max-height: 500px)` with compact
  horizontal rows (avatar beside the name) so everything fits on short
  screens. Both use the `(pointer: coarse), (hover: none)` touch-only
  pattern the app already relies on for 16 px inputs. Desktops and
  tablets keep the original layout.
- The mobile rating sheet uses `z-index` below its panel, so taps reach the
  score segments instead of the backdrop.
