// ============================================================
// i18n — Ukrainian is the default UI language, English optional.
// The language choice persists in localStorage ("movieclub_lang").
// Static HTML carries Ukrainian text + data-i18n attributes;
// applyStaticLang() swaps it. Dynamic strings use t(key, vars).
// ============================================================

export const LANG_KEY = "movieclub_lang";
// per-language plural form sets: [one, few, many]
export const WORDS = {
  movie: {
    uk: ["фільм", "фільми", "фільмів"],
    en: ["movie", "movies", "movies"],
  },
  season: {
    uk: ["сезон", "сезони", "сезонів"],
    en: ["season", "seasons", "seasons"],
  },
  country: {
    uk: ["країна", "країни", "країн"],
    en: ["country", "countries", "countries"],
  },
  match: {
    uk: ["збіг", "збіги", "збігів"],
    en: ["match", "matches", "matches"],
  },
  director: {
    uk: ["режисер", "режисери", "режисерів"],
    en: ["director", "directors", "directors"],
  },
  genre: {
    uk: ["жанр", "жанри", "жанрів"],
    en: ["genre", "genres", "genres"],
  },
};

let LANG = "uk";

const DICT = {
  uk: {
    // header / brand
    brandSub: "кіноклуб · з 2019",
    tabMovies: "Фільми",
    tabStats: "Статистика",
    tabAdmin: "Керування",
    syncConnecting: "з'єднання…",
    syncLive: "онлайн",
    syncOffline: "офлайн — резервна копія",
    footerBase: "дані у Firebase Realtime Database",
    footerLive: "онлайн через Firebase",
    footerOffline: "офлайн — показано локальну копію",
    themeToggle: "Світла / темна тема",
    langBtnTitle: "Мова інтерфейсу / UI language",

    // toolbar
    searchPh: "Пошук: назва, режисер, країна, рік…",
    seasonAll: "Сезон: усі",
    decadeAll: "Десятиліття: усі",
    countryAll: "Країна: усі",
    directorAll: "Режисер: усі",
    sortNewest: "Найновіші переглянуті",
    sortOldest: "Найстаріші переглянуті",
    sortRateDesc: "Оцінка: висока → низька",
    sortRateAsc: "Оцінка: низька → висока",
    sortYearDesc: "Рік випуску ↓",
    sortYearAsc: "Рік випуску ↑",
    sortTitle: "Назва А→Я",
    viewList: "Список",
    viewGrid: "Сітка",
    emptyText: "Нічого не знайдено.",
    resetFilters: "Скинути фільтри",
    rowHint: "Натисніть, щоб відкрити деталі",

    // summary strip
    sumAvg: "середня оцінка",
    sumFav: "улюбленець клубу:",

    // list table headers
    thId: "id",
    thTitle: "назва",
    thYear: "рік",
    thDirector: "режисер",
    thCountry: "країна",
    thSeason: "сезон",
    thWatched: "переглянуто",
    thAvg: "сер.",

    noPoster: "без постера",

    // details modal
    dYear: "Рік випуску",
    dDirector: "Режисер",
    dCountry: "Країна",
    dGenre: "Жанр",
    dSeason: "Сезон",
    dWatched: "Переглянуто",
    dAvg: "Середня",
    btnFetch: "Оновити дані",
    btnFetching: "Оновлюємо…",
    btnEdit: "Редагувати",
    btnDelete: "Видалити",

    // forms
    formAddTitle: "Додати фільм",
    formAddHint: "Введіть назву та рік випуску — оригінальна назва, режисер, країна, жанр, посилання IMDb/Wikipedia й постер підтягнуться автоматично з Wikipedia / IMDb. Усі поля нижче можна вільно редагувати вручну.",
    fTitle: "Назва",
    fTitleEn: "Оригінальна назва",
    fYear: "Рік випуску",
    fDate: "Дата перегляду",
    fDirector: "Режисер",
    fCountry: "Країна",
    fGenre: "Жанр",
    fWiki: "Wikipedia URL",
    fImdb: "IMDb URL",
    fPoster: "Постер URL",
    detailsNote: "Деталі — заповнюються автоматично, можна редагувати",
    btnSave: "Зберегти у Firebase",
    btnClear: "Очистити",
    btnCancel: "Скасувати",
    btnFind: "Знайти дані",
    editTitle: "Редагувати фільм #{id} — {title}",

    // lookup
    lkSearching: "Шукаємо у Wikipedia…",
    lkNeed: "Введіть назву й рік випуску (4 цифри), щоб знайти дані.",
    lkLoading: "Завантажуємо деталі фільму…",
    lkPicks: "Знайдено {n} {word} — якщо це не той фільм, виберіть правильний:",
    lkNoFilm: "Точного збігу з фільмом немає — якщо один із цих результатів і є фільм, виберіть його; інакше поля залишаться порожніми:",
    lkNone: "Нічого не знайдено у Wikipedia — додаткові поля залишаться порожніми (фільм усе одно можна зберегти).",
    lkFail: "Помилка пошуку: {msg}",
    lkDetailsFail: "Не вдалося отримати деталі: {msg}",
    lkFilled: "Дані заповнено з Wikipedia — поля можна вільно редагувати.",
    lkCurrent: "Поточні дані фільму (оновлять поля після пошуку):",

    // tools panel
    toolsTitle: "Інструменти даних",
    toolsHint: "Firebase Realtime Database — єдине джерело правди. Браузер автоматично тримає офлайн-копію останнього знімка даних.",
    stSource: "Джерело даних",
    stSourceVal: "Firebase RTDB",
    stAuto: "Автозбереження",
    stAlways: "завжди увімкнено",
    stLive: "Живі оновлення",
    stBackup: "Локальна копія",
    stBackupVal: "авто (офлайн-запас)",
    btnExport: "Експорт JSON",
    btnImport: "Імпорт JSON",
    btnSeed: "Відновити початкові дані",
    toolsHint2: "Експорт/імпорт — лише резервні копії; звичайне збереження завжди йде у Firebase. Імпорт перезаписує базу Firebase вмістом файлу.",

    // toasts
    tSaved: "Збережено: {title} (id {id})",
    tSaveFail: "Помилка збереження: {msg}",
    tDeleted: "Фільм #{id} видалено",
    tDeleteFail: "Помилка видалення: {msg}",
    tInfoUpdated: "Дані оновлено з Wikipedia / IMDb",
    tFetchFail: "Помилка: {msg}",
    tSeededAuto: "Перший запуск: база фільмів завантажена у Firebase",
    tSeeded: "Початкові дані відновлено у Firebase",
    tFbFail: "Помилка запису у Firebase: {msg}",
    tReadFail: "Помилка читання Firebase — показано локальну копію",
    tNoBackup: "— резервної копії немає, завантажено початкові дані",
    tExported: "Резервну копію завантажено",
    tImported: "Імпортовано у Firebase",
    tImportFail: "Імпорт не вдався: {msg}",
    tPosterAuto: "Постер знайдено й додано автоматично",
    tRequired: "Потрібні: назва, рік випуску й дата перегляду",
    confirmDelete: "Видалити «{title}» (id {id}) з бази даних?",
    confirmSeed: "Відновити вбудований початковий набір у Firebase? Поточний вміст Firebase буде перезаписано.",

    // stats — KPIs
    kMovies: "Фільмів переглянуто",
    kAvg: "Середня оцінка",
    kAvgSub: "усі фільми, всі учасники",
    kFav: "Улюбленець клубу",
    kFavSub: "найвищий рейтинг",
    kSeason: "Цей сезон",
    kSeasonSub: "сезон {s}",
    kTopDecade: "Топ-десятиліття",
    kTopDecadeSub: "найчастіше дивились",
    kTopDir: "Топ-режисер",
    kTopDirSub: "найчастіше дивились",
    kDirectors: "Режисерів",
    kCountries: "Країн",
    kUniqueSub: "унікальних у базі",

    // stats — charts
    cDecade: "Фільми за десятиліттями",
    cDecadeAvg: "Середня оцінка за десятиліттями",
    cSeason: "Фільми за сезонами",
    cActivity: "Активність переглядів (за роками)",
    cReleaseYears: "Фільми за роком випуску",
    cCountry: "Країни",
    cGenres: "Жанри",
    cDirectors: "Найпопулярніші режисери",
    cDirAvg: "Режисери за середньою оцінкою",
    cCountryAvg: "Середня оцінка за країною",
    cGenreAvg: "Середня оцінка за жанром",
    cDist: "Розподіл оцінок",
    cRaters: "Порівняння учасників",
    cTop: "Топ-10 фільмів",
    ttMovies: "{n} фільмів",
    ttRated: "оцінили {n} фільмів",
    other: "Інші",
    chartNoData: "Поки що немає даних для цього графіка",
  },

  en: {
    brandSub: "movie club · est. 2019",
    tabMovies: "Movies",
    tabStats: "Stats",
    tabAdmin: "Manage",
    syncConnecting: "connecting…",
    syncLive: "live",
    syncOffline: "offline — backup",
    footerBase: "data in Firebase Realtime Database",
    footerLive: "live via Firebase",
    footerOffline: "offline — showing local backup",
    themeToggle: "Light / dark theme",
    langBtnTitle: "Мова інтерфейсу / UI language",

    searchPh: "Search title, director, country, year…",
    seasonAll: "Season: all",
    decadeAll: "Decade: all",
    countryAll: "Country: all",
    directorAll: "Director: all",
    sortNewest: "Newest watched",
    sortOldest: "Oldest watched",
    sortRateDesc: "Rating high → low",
    sortRateAsc: "Rating low → high",
    sortYearDesc: "Release year ↓",
    sortYearAsc: "Release year ↑",
    sortTitle: "Title A→Z",
    viewList: "List",
    viewGrid: "Grid",
    emptyText: "Nothing found.",
    resetFilters: "Reset filters",
    rowHint: "Click for details",

    sumAvg: "average rating",
    sumFav: "club favourite:",

    thId: "id",
    thTitle: "title",
    thYear: "year",
    thDirector: "director",
    thCountry: "country",
    thSeason: "season",
    thWatched: "watched",
    thAvg: "avg",

    noPoster: "no poster",

    dYear: "Release year",
    dDirector: "Director",
    dCountry: "Country",
    dGenre: "Genre",
    dSeason: "Season",
    dWatched: "Watched on",
    dAvg: "Average",
    btnFetch: "Fetch info",
    btnFetching: "Fetching…",
    btnEdit: "Edit",
    btnDelete: "Delete",

    formAddTitle: "Add movie",
    formAddHint: "Just enter the title and release year — original title, director, country, genre, IMDb/Wikipedia links and the poster are fetched automatically from Wikipedia / IMDb. Every field below can also be edited manually.",
    fTitle: "Title",
    fTitleEn: "Original title",
    fYear: "Release year",
    fDate: "Watched on",
    fDirector: "Director",
    fCountry: "Country",
    fGenre: "Genre",
    fWiki: "Wikipedia URL",
    fImdb: "IMDb URL",
    fPoster: "Poster URL",
    detailsNote: "Details — auto-filled, fully editable",
    btnSave: "Save to Firebase",
    btnClear: "Clear",
    btnCancel: "Cancel",
    btnFind: "Fetch data",
    editTitle: "Edit movie #{id} — {title}",

    lkSearching: "Searching Wikipedia…",
    lkNeed: "Enter a title and a 4-digit release year to look up data.",
    lkLoading: "Loading film details…",
    lkPicks: "{n} {word} found — pick one if it is not the right film:",
    lkNoFilm: "No exact film match — if one of these is the film, pick it; otherwise the fields will stay empty:",
    lkNone: "No Wikipedia match — extra fields will stay empty (the movie can still be saved).",
    lkFail: "Lookup failed: {msg}",
    lkDetailsFail: "Details failed: {msg}",
    lkFilled: "Fields filled from Wikipedia — edit them freely.",
    lkCurrent: "Current movie data (fields will refresh after a search):",

    toolsTitle: "Data tools",
    toolsHint: "Firebase Realtime Database is the single source of truth. The browser keeps an automatic offline backup of the latest snapshot.",
    stSource: "Source of truth",
    stSourceVal: "Firebase RTDB",
    stAuto: "Auto-save",
    stAlways: "always on",
    stLive: "Live updates",
    stBackup: "Local backup",
    stBackupVal: "auto (offline fallback)",
    btnExport: "Export JSON backup",
    btnImport: "Import JSON backup",
    btnSeed: "Restore seed data",
    toolsHint2: "Export/import are backups only — normal saving always goes to Firebase. Import overwrites the Firebase database with the file content.",

    tSaved: "Saved: {title} (id {id})",
    tSaveFail: "Save failed: {msg}",
    tDeleted: "Deleted movie #{id}",
    tDeleteFail: "Delete failed: {msg}",
    tInfoUpdated: "Info updated from Wikipedia / IMDb",
    tFetchFail: "Fetch failed: {msg}",
    tSeededAuto: "First run: movie base uploaded to Firebase",
    tSeeded: "Seed data restored to Firebase",
    tFbFail: "Firebase write failed: {msg}",
    tReadFail: "Firebase read failed — using local backup",
    tNoBackup: " — no backup found, loading seed data",
    tExported: "Backup downloaded",
    tImported: "Backup imported into Firebase",
    tImportFail: "Import failed: {msg}",
    tPosterAuto: "Poster found and added automatically",
    tRequired: "Title, release year and watch date are required",
    confirmDelete: "Delete \"{title}\" (id {id}) from the database?",
    confirmSeed: "Restore the built-in seed dataset to Firebase? Current Firebase content will be overwritten.",

    kMovies: "Movies watched",
    kAvg: "Average rating",
    kAvgSub: "all movies, all raters",
    kFav: "Club favourite",
    kFavSub: "highest rated movie",
    kSeason: "This season",
    kSeasonSub: "season {s}",
    kTopDecade: "Top decade",
    kTopDecadeSub: "most watched",
    kTopDir: "Top director",
    kTopDirSub: "most watched",
    kDirectors: "Directors",
    kCountries: "Countries",
    kUniqueSub: "unique in the base",

    cDecade: "Movies by release decade",
    cDecadeAvg: "Average rating by decade",
    cSeason: "Movies by season",
    cActivity: "Watching activity (per year)",
    cReleaseYears: "Movies by release year",
    cCountry: "Countries",
    cGenres: "Genres",
    cDirectors: "Most watched directors",
    cDirAvg: "Directors by average rating",
    cCountryAvg: "Average rating by country",
    cGenreAvg: "Average rating by genre",
    cDist: "Rating distribution",
    cRaters: "Raters comparison",
    cTop: "Top 10 movies",
    ttMovies: "{n} movies",
    ttRated: "rated {n} movies",
    other: "Other",
    chartNoData: "No data for this chart yet",
  },
};

export function initLang() {
  try { LANG = localStorage.getItem(LANG_KEY) || "uk"; } catch (e) { LANG = "uk"; }
  if (!DICT[LANG]) LANG = "uk";
  document.documentElement.lang = LANG === "uk" ? "uk" : "en";
  return LANG;
}

export function getLang() { return LANG; }

export function setLang(l) {
  if (!DICT[l]) return;
  LANG = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  document.documentElement.lang = l === "uk" ? "uk" : "en";
}

// t("editTitle", { id: 5, title: "Дюна" }) → interpolated string
export function t(key, vars) {
  let s = DICT[LANG]?.[key] ?? DICT.uk[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Ukrainian plural forms: [one, few, many]; English: [one, other]
export function plural(n, forms) {
  n = Number(n) || 0;
  if (LANG !== "uk") return n === 1 ? forms[0] : forms[2];
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

// plural by dictionary word key, language-aware: pluralW(60, "movie") →
// "фільмів" (uk) / "movies" (en)
export function pluralW(n, key) {
  const set = WORDS[key];
  const forms = (set && (set[LANG] || set.uk)) || [key, key, key];
  return plural(n, forms);
}

// swap text of all statically marked elements (run after setLang)
export function applyStaticLang(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
