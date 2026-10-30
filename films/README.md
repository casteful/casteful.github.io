# Фільмотека — Movie Night Rating App

A minimalistic film-rating web app for a group of friends. UI in Ukrainian,
film **metadata in English** (titles in both Ukrainian and English),
light/dark theme, built as a **zero-build static site** — perfect for GitHub Pages.

## Features

- **One title for games & music/books (v6.2)** — the «Назва (українською)» field is **removed** from the Ігри, Альбоми, Сингли and Книги add/edit forms (films and series keep their bilingual titles): one name, always the original («The Witcher 3», «Abbey Road», «Nineteen Eighty-Four»). Suggestions, cards, table and detail windows show only that title, and legacy `titleUk` values stored earlier are ignored for display and wiped on the next edit. **Pushes now name the author** — the developer for games (publisher as fallback) and the artist/author for albums, singles and books, in the same parenthetical as the year: «surguy додав альбом «Abbey Road» (The Beatles, 1969) — 8/10», «oddfriend оцінив книгу «1984» (George Orwell, 1949) на 9/10», «surguy додав гру «The Witcher 3» (CD Projekt Red, 2015)».
- **Music autocomplete beyond Wikipedia (v6.1)** — «Сингли» and «Альбоми» now search **three sources in parallel**: Wikipedia (uk titles, genres, tracklist, plot) + **iTunes Search API** (virtually every song/album: 600×600 cover art, artist, year, genre and a **30-second preview** — no keys, open CORS) + **MusicBrainz** (top-4 most relevant recordings/release-groups — full catalog depth). Results are **merged by title+artist**: the genuine original outranks remixes/covers because several catalogs agree on it («Blinding Lights» → The Weeknd 2019 first, covers below), list/discography pages are filtered out, and suggestions show their source («Вікіпедія / iTunes / MusicBrainz»), the kind («пісня/альбом») and a ♪ dot when a preview exists. Picking a suggestion fills artist, year, cover, preview and plot automatically (the Ukrainian article still supplies the description).
- **30-second previews (v6.1)** — records with a preview get a **play button right on the cover** and a «Прослухати» pill in the detail window: one tap plays a 30-second fragment (amber pulse while playing), a second tap stops it. One shared audio element per app — closing the window or switching tabs always stops the music. The preview URL is stored with the record, so friends get playable singles too.
- **Everyday UX (v6.1)** — the list toolbar (search + sort + view + add) **sticks under the header** while scrolling long lists (measured header height, glass blur; phones keep the compact non-sticky layout). The app **reopens on the tab you left**, and **«/» focuses the search** of the current tab from the keyboard.
- **Music & books tabs (v6)** — three new rating collections: **«Альбоми»** (albums), **«Сингли»** (singles/songs) and **«Книги»** (books), each with the exact same design and flow as films/games: square cover cards (portrait for books) / table, own search & sorts (including «За оцінкою друга»), 10-star rating (quick pop + detail window with everyone's scores), edit and delete. Autocomplete is **wiki-first and keyless** like games: uk+en Wikipedia (prefix + full-text + wildcard deepcategory passes) run **in parallel** and paint progressively, Wikidata classes filter out films/people/games and boost the right kind (album `Q482994`, single/song `Q134556`/`Q7366`, book/novel/…). Picking a suggestion auto-fills **performer** (P175) or **author** (P50), year (P577), genres (P136), the **tracklist** for albums (P658), publisher & page count for books (P123/P1104), the description from the uk/en article, and the **cover** (Wikidata P18 → article thumbnail → Cover Art Archive via MusicBrainz ID). Rate while adding works here too (friends see your score in the push). Telegram pushes speak the right noun («додав альбом/сингл/книгу», «оцінив книгу…») with direct `?album=`/`?single=`/`?book=` deep links. Each collection lives in its own node (`albums/`, `singles/`, `books/`) and doesn't affect films, games or statistics.
- **Organized tab bar (v6)** — the topbar now groups the six libraries (Фільми · Серіали · Альбоми · Сингли · Книги · Ігри) before a subtle divider and the utility tabs (Статистика · Гра). On narrower screens the panel moves to its own row, and on phones it **scrolls sideways** (hidden scrollbar) with the active tab auto-scrolling into view — no crammed 8-way split, deep links included. The floating «+» button always matches the current tab («Додати альбом», «Додати книгу»…).
- **Series have their own tab (v5)** — «Серіали» lives next to «Фільми»: same design and flow, but its own search, sorts and view mode. Series **don't affect film statistics** — watch time, records, top-10, genres and decades count films only; a compact «Серіали» panel shows their own totals and the best-rated one. Series have **no runtime** (impossible to calculate for episodes) — the «Хв» column and duration simply don't exist for them. The add/edit form has a **«Тип» selector (Фільм / Серіал)** — picking a series suggestion flips it automatically. Old records are classified **automatically in the background** via TVMaze (free API, by IMDb ID): a one-time write of `kind: 'series'` for actual series, films need no write.
- **Sort by each friend's rating (v5)** — new «За оцінкою друга» sort in films and games: a row of friend chips appears (tap to pick whose ratings), with an ↑/↓ direction toggle (asc = their lowest first — «what did we not like?»). In the table view just **click a friend's column header** (click again to flip direction, ▲▼ shows the active one). Films this friend hasn't rated always sink to the bottom. Each tab remembers its own friend and direction.
- **Faster, tougher autocomplete (v5)** — Wikipedia now kicks in after **150 ms instead of 800 ms** (it's the fastest source and often the only one that knows brand-new titles), IMDb gets the query **with the year stripped** («Primetime 2026» → searches «Primetime»), all Wikipedia/Wikidata requests **retry once** automatically on network hiccups, and **empty results are never cached** — retyping the same title genuinely searches again (a transient failure used to “stick” for the whole session). The «Нічого не знайдено» note now has a **«Спробувати ще раз»** button that also lifts the 10-minute IMDb down-flag. This fixed the real bug: «Primetime» (2026, A24) showed **no suggestions at all** when IMDb had a temporary hiccup and Wikipedia was throttled — now either source alone is enough.
- **Short Cyrillic prefixes find films (v5.4)** — typing «Алекс» used to return **nothing** when IMDb was blocked in your network (a common ISP case): full-text Wikipedia search for «Алекс» only matches biographies and places («Александр» is not stem-related to «Алекс»), and the top prefix matches are people. Now the search adds two **wildcard + deepcategory passes** over uk.Wikipedia's «Фільми» and «Телесеріали» category trees — «Алекс* deepcategory:Фільми» surfaces «Александр (фільм)», «Про Алекса», «Фанні та Александр» directly, and the Wikidata filter drops the person pages. Prefix search also got a wider window (top-10 instead of top-6).
- **Rate while adding (v5)** — the add/edit form has a **«Ваша оцінка»** 10-star section: set your score right when adding — friends see the film already rated by you (the rating rides inside the same record, no second save). In edit mode your current rating is prefilled; changing it sends the usual Telegram push.

- **Games tab (v4)** — a second library, «Ігри», with the **same design and flow as films**: cover cards / table, search, sorts, the 10-star scale (quick pop, bottom sheet on phones, game window with everyone's scores), edit and delete. Autocomplete goes **straight from Wikipedia + Wikidata** — no API keys (IGDB needs Twitch OAuth, RAWG needs an account): cover art comes from the article thumbnail / Wikidata P18, and year (P577), **developer** (P178), **publisher** (P123), **platforms** (P400), **genres** (P136) and the plot are filled automatically. Telegram pushes mirror films («surguy додав гру «The Witcher 3» (CD Projekt Red, 2015)», «oddfriend оцінив гру «Hollow Knight» (Team Cherry, 2017) на 8/10») with a direct `?game=<id>` link that opens that game's card. Games live in their own `games/` node and don't touch the film statistics.
- **Profile avatars (v4)** — the Settings panel has a **«Мій аватар» section on top**: pick any photo and it's center-cropped to a 144×144 square and compressed to a few KB right in the browser, then saved to a small `avatars/{userId}` node — every friend sees the photo instead of the letter avatar (topbar badge, profile picker, film/game rating lists, quiz, leaderboards, statistics). «Видалити» brings back the classic initials look.
- **Sort by friends' rating (v4)** — new «За оцінкою друзів» option in the films and games sort dropdowns: orders by the **average of everyone else's ratings**, ignoring your own — see which titles the team loved even if you didn't, with films nobody else rated last.
- **Effortless rating — ten golden stars** — one tap on «Оцінити» opens a 10-star scale right next to the button (a large bottom sheet on phones). Stars fill with a red→green ramp up to the chosen value (each star keeps its own level colour), a big number + word caption («Добре», «Шедевр»…) reacts live to hovering, and a tap saves instantly. The same stars live in the film window. Keyboard: digits 1–9, 0 = 10, ←/→, Esc.
- **Telegram pushes** — an elegant one-line Ukrainian message lands in your group when someone adds or deletes a film, or rates / changes / removes a rating (e.g. «surguy оцінив фільм «Інтерстеллар» на 8/10», «surguy змінив оцінку: 7 → 9»). **Every push about a film carries a direct link** — friends tap it and the app opens straight on that film's card, ready to rate (if no profile is chosen yet, the profile picker shows first). Setup is one person's job: open the gear (Налаштування) → Telegram, paste a free @BotFather token, add the bot to the group, send /start there — the app finds the chat automatically and stores the shared config in Firebase. Pushes are sent by the acting device only (no duplicates) and never block or break the UI; failures stay silent. The gear gets a green dot while notifications are on.
- **Cinematic card grid** — vertical poster cards with the average score on the poster, a full-width rate button and friends' scores as colored chips; 2-column layout on phones. A compact **table** view with a rating column per friend is one tap away; both views remember your choice.
- **Beautiful film window** — poster blurred into a hero header with the title, director, genres and cast; the 10-star scale for your own score; everyone's scores in one list.
- **Smart adding** — start typing a film name (Ukrainian or English) and pick it from live suggestions; poster, year, both titles, director, cast, genres, runtime and plot are fetched automatically (IMDb + Wikipedia + Wikidata). **Titles are bilingual** — Ukrainian («Чудовисько: Історія Еда Ґіна») above the English original ("Monster: The Ed Gein Story") in suggestions, cards, the table and the film window; **all other metadata is English-first** (director, cast, genres, plot come from en.Wikipedia / English Wikidata labels, with Ukrainian as fallback). **Series always get their premiere**: the year is filled from the premiere date (IMDb year-range, Wikidata P577, TVMaze) and the exact day shows as «Прем'єра: 24 вересня 2007» under the year field and in the film window. Everything stays manually editable.
- **Clickable people & genres** — tap any director, actor, genre or country (in the film window or in statistics) to see all matching films of the club.
- **Statistics tab** — totals (films, ratings, average, shared cinema-hours, most active viewer), club records (best / worst / most controversial / most discussed / oldest / newest), top-10 films, favourite genres and average by genre, countries and average by country, top actors and directors plus directors by average rating, rating histogram, decades (count and average), films by release year, watch activity by year and by season, runtime stats and per-viewer profiles («strictest critic» vs «most generous viewer») with a participants comparison.
- **Guess-the-rating game with per-mode leaderboards (v3.7)** — the «Гра» tab has two modes, played as **matches of 5 rounds** (max 25 points): **«Рейтинг друга»** — guess a friend's score 1–10 on the familiar star scale (tap or keyboard digits); **«Середня команди»** — guess the team's average rating for a film with a 1,0–10,0 slider. Scoring per round: exact 5 / off-by-one or ≤1,0 3 / off-by-two or ≤2,0 1. Your own ratings are never guessed and never count into the average. The reveal compares your guess with the real answer, shows everyone's ratings for context, and the final summary lists every round. **Films never repeat while unplayed ones remain**: answered films are remembered per profile + mode (localStorage) across matches and reloads; only when the whole pool has been played does a new cycle start (the question shows a «новий круг» note). **Completed matches are saved to a small `quizScores/{userId}` node in Firebase** — per mode: `{name, updatedAt, friend: {best, games, exact}, average: {best, games, exact}}`, written via a transaction so simultaneous matches don't clobber each other. It feeds **two separate live leaderboards** on the start screen: «Хто найкраще знає друзів» (friend mode) and «Хто найкраще відчуває команду» (average mode); each mode card also shows your own best. Abandoned matches write nothing.
- **Modern UI (v3)** — warm-amber identity with gradient accents, glass topbar, springy micro-animations, refined dark theme, soft “projector” glow, thin scrollbars, reduced-motion support.
- **iPhone / mobile friendly (v3.1)** — the suggestion dropdown is anchored directly under the search field (fixed a positioning bug that pushed it off-screen), touch selection works via `touchend`, inputs are 16 px on touch devices so iOS never auto-zooms the page, the rating sheet sits above its backdrop (tappable scores), body scroll is locked behind modals/sheets, and safe-area insets keep the UI clear of the notch and home indicator.
- **Light / dark theme** — toggle in the header, remembered per device (browser UI color adapts too).
- **Realtime** — all data lives in Firebase Realtime Database, so everyone sees updates instantly. Missing posters are re-fetched automatically in the background.
- **Settings & backup (v3.4)** — one gear button in the header combines **Telegram notifications** (status, quick on/off, full setup) and **data tools**: **Експортувати JSON** downloads the entire database (`filmoteka-backup-YYYY-MM-DD.json`), **Імпортувати JSON** restores it (with a confirmation; fully replaces the DB, also accepts raw Firebase-console JSON).
- **Cache-busting & stuck-load watchdog (v4.1)** — every JS module and the stylesheet are loaded with a build stamp (`js/app.js?v=4.1`), so after each update browsers can never mix old and new files (the classic “films stuck on skeletons after upload” symptom). On top of that, a **watchdog** fires if the film list hasn't arrived within 12 seconds and shows a small dismissible banner — «Оновити» re-opens the app on a unique URL, forcing every file to be fetched fresh (one tap instead of clearing the browser cache).
- **Bigger statistics (v3.4)** — top-10 films plus new panels: average rating by decade / genre / country, directors by average rating, films by release year, countries (from Wikidata P495, new «Країна» form field), watch activity by year and by season (winter/spring/summer/autumn — based on the day a film was added), and a participants comparison (average ± disagreement with the group).

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

> **Updating an already deployed app:** upload **all files again, replacing the old ones** (the JS/CSS links carry a version stamp like `?v=4.1` — after each code change bump it, e.g. with `node scripts/stamp-version.mjs 4.2`, so every friend's browser fetches the fresh set instead of mixing cached old modules with new ones).

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
- **Telegram notifications**: none needed in code — use the gear button in
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
    premiere:   "1994-09-10"          # full premiere date when known (optional)
    poster:     "https://m.media-amazon.com/..."
    imdbId:     "tt0111161"
    director:   "Frank Darabont"
    country:    "United States"       # country of origin (Wikidata P495, optional)
    genres:     ["drama film", "crime film"]
    runtime:    142
    plot:       "The Shawshank Redemption is a 1994 American…"
    addedBy:    "surguy"
    createdAt:  1728300000000
    updatedAt:  1728300000000
    ratings:
      surguy:   9
      q1oob:    8
albums/   # «Альбоми» (v6) — same shape as games/ plus:
singles/  # «Сингли» (v6) — single original title only (no titleUk since v6.2)
  <pushId>/
    title:    "Abbey Road"
    kind:     "album"                 # 'album' | 'single' | 'book'
    artist:   "The Beatles"           # albums & singles (Wikidata P175)
    author:   "George Orwell"         # books only (Wikidata P50)
    year:     1969
    genres:   ["rock music"]
    tracks:   ["Come Together", "Something", …]   # albums only (P658)
    publisher: "Secker & Warburg"     # books only (P123)
    pages:    328                     # books only (P1104)
    cover:    "https://commons.wikimedia.org/…"   # or article thumb / CAA / iTunes
    preview:  "https://audio-ssl.itunes.apple.com/…"  # 30-sec fragment, singles/albums (optional)
    plot:     "Abbey Road is the eleventh studio album…"
    wikiUrl:  "https://en.wikipedia.org/wiki/Abbey_Road"
    qid:      "Q173643"
    addedBy / createdAt / updatedAt / ratings: …
books/    # «Книги» (v6) — same record shape with author/publisher/pages
tgConfig/
  enabled:    true
  token:      "123456:AA..."   # from @BotFather
  chatId:     -1002222...      # group chat id (found via getUpdates)
  chatTitle:  "Кіноклуб"
```

## Backup: export / import (settings gear)

The gear button in the header (where the Telegram button used to be) opens
**Налаштування** with two sections:

- **Telegram-сповіщення** — connection status, quick on/off toggle and the
  full bot setup (same window as before).
- **Дані** — **Експортувати JSON** downloads the whole database (films,
  ratings, tgConfig and any other nodes) as `filmoteka-backup-YYYY-MM-DD.json`;
  **Імпортувати JSON** restores a backup: after picking a file you see a
  confirmation, and on confirm the database content is fully replaced.
  The import accepts our own export format as well as a raw root JSON
  (e.g. from the Firebase console); `films` given as an array is normalized
  to the key-value shape the app uses.

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
  top. Suggestions that arrive without a poster get one quietly filled in
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
- The mobile rating sheet uses `z-index` below its panel, so taps reach the
  score segments instead of the backdrop.
