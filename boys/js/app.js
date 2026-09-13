// ============================================================
// movie_base app — Firebase RTDB is the SINGLE SOURCE OF TRUTH.
// localStorage is only an automatic offline backup (read fallback).
//
// Hidden settings (no UI by design — owner can flip in code):
//   AUTO_SAVE     = true   → every change is written to Firebase immediately
//   LIVE_UPDATES  = true   → onValue() keeps all open browsers in sync
//   LOCAL_BACKUP  = true   → latest snapshot cached in localStorage
//
// Views: "list" (default — table, no posters) | "grid" (poster cards).
// Click any movie (row or card) → details modal with poster, links, actions.
// Theme: light default, dark optional (icon toggle). UI language: Ukrainian
// default, English optional (UA/EN toggle) — see js/i18n.js.
// Add/edit forms: metadata is auto-fetched from Wikipedia/IMDb into EDITABLE
// fields — anything typed by hand is never overwritten by the auto-lookup.
// ============================================================
import { db, ref, onValue, get, update, remove } from "./firebase-config.js";
import { SEED_MOVIES, RATERS, avgRate, seasonFromDate, decadeOf, normalizeCountry } from "./data.js";
import { renderStats } from "./stats.js";
import { searchFilms, getFilmDetails } from "./lookup.js";
import { initLang, setLang, getLang, t, pluralW, applyStaticLang } from "./i18n.js";

const AUTO_SAVE    = true;   // hidden param — always true
const LIVE_UPDATES = true;   // hidden param — always true
const LOCAL_BACKUP = true;   // hidden param — offline fallback

const DB_PATH = "movies";
const CACHE_KEY = "movieclub_cache_v1";
const POSTER_CACHE_KEY = "movieclub_posters_v2";
const VIEW_KEY = "movieclub_view_v1";
const THEME_KEY = "movieclub_theme";

// ---------- state ----------
let MOVIES = {};           // { "<id>": movie }
let FILTERS = { q: "", season: "", decade: "", country: "", director: "", sort: "date-desc" };
let VIEW = "list";         // "list" | "grid"
let posterCache = {};      // "lang:Title" -> poster URL
let posterInFlight = {};   // "lang:Title" -> Promise (dedupe parallel fetches)
let currentSnapshot = null;
let lastSyncState = null;         // { online, label } — re-applied after language switch
let countryCleanupDone = false; // one-time DB normalization of country variants
const autoHealTried = new Set();   // movie ids already auto-enriched this session
const posterHealTried = new Set(); // movie ids whose poster was auto-repaired this session

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rated = (v) => Number(v) > 0;

function rateClass(v) {
  v = Number(v);
  if (!rated(v)) return "r-na";
  if (v >= 8) return "r-hi";
  if (v >= 6) return "r-mid";
  if (v >= 4) return "r-low";
  return "r-bad";
}
function avgClass(a) {
  if (a >= 8) return "a-hi";
  if (a >= 6) return "a-mid";
  if (a >= 4) return "a-low";
  return "a-bad";
}

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3500);
}

// RTDB casts numeric keys (3..55) into a sparse array with null holes —
// normalize any shape (array / object / cache / file) into a clean { key: movie }
function normalizeMovies(val) {
  const out = {};
  const src = Array.isArray(val)
    ? val.map((m, i) => [String(i), m])
    : Object.entries(val || {});
  src.forEach(([k, m]) => {
    if (m && typeof m === "object") out[k] = { ...m, id: Number(m.id ?? k) };
  });
  return out;
}

function allMovies() {
  // country is normalized on the fly so the table, grid, details, filters
  // and statistics always show ONE spelling per country (e.g. only "США",
  // never also "Сполучені Штати Америки") regardless of what is stored.
  return Object.values(MOVIES).map((m) => ({
    ...m,
    id: Number(m.id),
    country: normalizeCountry(m.country),
  }));
}

// one-time repair: rewrite Firebase records whose stored country is a
// variant spelling, so the database itself becomes consistent too
async function cleanupCountryVariants() {
  if (countryCleanupDone || !AUTO_SAVE) return;
  countryCleanupDone = true;
  const payload = {};
  Object.entries(MOVIES).forEach(([key, m]) => {
    const fixed = normalizeCountry(m.country);
    if (fixed && fixed !== m.country) payload[`${DB_PATH}/${key}/country`] = fixed;
  });
  if (!Object.keys(payload).length) return;
  try {
    await update(ref(db), payload);
    console.info(`country normalization: repaired ${Object.keys(payload).length} record(s)`);
  } catch (e) { /* cosmetic fix — non-fatal */ }
}

// ---------- localStorage backup (offline fallback only) ----------
function saveCache(moviesObj) {
  if (!LOCAL_BACKUP) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), movies: moviesObj }));
  } catch (e) { /* storage full — ignore */ }
}

function loadCache() {
  if (!LOCAL_BACKUP) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return normalizeMovies(JSON.parse(raw)?.movies);
  } catch (e) { return null; }
}

// ============================================================
// Firebase sync (single source of truth)
// ============================================================
function initSync() {
  onValue(ref(db, ".info/connected"), (snap) => {
    setSync(snap.val() === true);
  });

  const moviesRef = ref(db, DB_PATH);

  if (LIVE_UPDATES) {
    onValue(moviesRef, (snap) => {
      const val = snap.val();
      if (!val || Object.keys(val).length === 0) {
        // empty database → seed it once with the built-in dataset
        seedFirebase(false);
        return;
      }
      MOVIES = normalizeMovies(val);
      currentSnapshot = MOVIES;
      saveCache(MOVIES);
      renderAll();
      cleanupCountryVariants();
    }, (err) => {
      console.error("Firebase read error:", err);
      setSync(false, "read error");
      useBackup(t("tReadFail"));
    });
  }
}

function setSync(online, label) {
  lastSyncState = { online, label }; // remember, so a language switch can re-render it
  const dot = $("#syncDot"), text = $("#syncText"), footer = $("#footerSync");
  if (online) {
    dot.className = "dot on";
    text.textContent = t("syncLive");
    footer.textContent = t("footerLive");
  } else {
    dot.className = "dot off";
    text.textContent = label || t("syncOffline");
    footer.textContent = t("footerOffline");
  }
}

function useBackup(msg) {
  const cached = loadCache();
  if (cached && Object.keys(cached).length) {
    MOVIES = cached;
    renderAll();
    toast(msg, "warn");
  } else {
    toast(msg + t("tNoBackup"), "warn");
    MOVIES = Object.fromEntries(SEED_MOVIES.map((m) => [String(m.id), m]));
    renderAll();
  }
}

async function seedFirebase(manual = false) {
  const payload = {};
  SEED_MOVIES.forEach((m) => (payload[`${DB_PATH}/${m.id}`] = m));
  try {
    await update(ref(db), payload);
    toast(manual ? t("tSeeded") : t("tSeededAuto"), "ok");
  } catch (e) {
    console.error(e);
    toast(t("tFbFail", { msg: e.message }), "err");
  }
}

// ---------- writes (auto-save → Firebase instantly) ----------
async function saveMovie(movie) {
  if (!AUTO_SAVE) return;
  try {
    await update(ref(db, `${DB_PATH}/${movie.id}`), movie);
    toast(t("tSaved", { title: movie.title, id: movie.id }), "ok");
  } catch (e) {
    console.error(e);
    toast(t("tSaveFail", { msg: e.message }), "err");
  }
}

async function deleteMovie(id) {
  if (!AUTO_SAVE) return;
  try {
    await remove(ref(db, `${DB_PATH}/${id}`));
    toast(t("tDeleted", { id }), "ok");
  } catch (e) {
    console.error(e);
    toast(t("tDeleteFail", { msg: e.message }), "err");
  }
}

// ============================================================
// Rendering
// ============================================================
function renderAll() {
  fillFilterOptions();
  renderSummary();
  renderMovies();
  renderStats(allMovies(), $("#chartsGrid"), $("#kpiGrid"));
}

function fillFilterOptions() {
  const ms = allMovies();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "uk"));

  const seasons = uniq(ms.map((m) => m.season || seasonFromDate(m.date)));
  const decades = uniq(ms.map((m) => decadeOf(m.year)).filter(Boolean)).sort((a, b) => b - a);
  const countries = uniq(ms.map((m) => (m.country || "").split(",")[0].trim()));
  const directors = uniq(ms.map((m) => (m.director || "").split(",")[0].trim()));

  fillSelect($("#fSeason"), seasons);
  fillSelect($("#fDecade"), decades.map((d) => `${d}s`));
  fillSelect($("#fCountry"), countries);
  fillSelect($("#fDirector"), directors);

  $("#fSeason").value = FILTERS.season;
  $("#fDecade").value = FILTERS.decade;
  $("#fCountry").value = FILTERS.country;
  $("#fDirector").value = FILTERS.director;
}

function fillSelect(sel, values) {
  const first = sel.querySelector("option");
  sel.innerHTML = "";
  sel.appendChild(first);
  values.forEach((v) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}

function renderSummary() {
  const ms = allMovies();
  const best = ms.reduce((a, m) => (avgRate(m.rates) > avgRate(a?.rates || {}) ? m : a), null);
  const avg = ms.length ? ms.reduce((s, m) => s + avgRate(m.rates), 0) / ms.length : 0;
  const nSeasons = new Set(ms.map((m) => m.season || seasonFromDate(m.date))).size;
  const nCountries = new Set(ms.flatMap((m) => (m.country || "").split(",").map((c) => c.trim())).filter(Boolean)).size;
  $("#moviesStrip").innerHTML = `
    <b>${ms.length}</b> ${pluralW(ms.length, "movie")} ·
    <b>${nSeasons}</b> ${pluralW(nSeasons, "season")} ·
    <b>${nCountries}</b> ${pluralW(nCountries, "country")} ·
    ${t("sumAvg")} <b>${avg.toFixed(1)}</b> ·
    ${t("sumFav")} <b>${best ? esc(best.title) : "—"}</b>
  `;
}

function applyFilters(ms) {
  const q = FILTERS.q.trim().toLowerCase();
  let out = ms.filter((m) => {
    if (q) {
      const hay = `${m.title} ${m.titleEn || ""} ${m.director || ""} ${m.country || ""} ${m.year || ""} ${m.genre || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (FILTERS.season && (m.season || seasonFromDate(m.date)) !== FILTERS.season) return false;
    if (FILTERS.decade && `${decadeOf(m.year)}s` !== FILTERS.decade) return false;
    if (FILTERS.country && (m.country || "").split(",")[0].trim() !== FILTERS.country) return false;
    if (FILTERS.director && (m.director || "").split(",")[0].trim() !== FILTERS.director) return false;
    return true;
  });

  const cmp = {
    "date-desc": (a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id,
    "date-asc": (a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id,
    "rate-desc": (a, b) => avgRate(b.rates) - avgRate(a.rates),
    "rate-asc": (a, b) => avgRate(a.rates) - avgRate(b.rates),
    "year-desc": (a, b) => (b.year || 0) - (a.year || 0),
    "year-asc": (a, b) => (a.year || 0) - (b.year || 0),
    "title-asc": (a, b) => String(a.title).localeCompare(String(b.title), "uk"),
  }[FILTERS.sort];
  return out.sort(cmp || (() => 0));
}

function renderMovies() {
  const listEl = $("#moviesList");
  const gridEl = $("#moviesGrid");
  const ms = applyFilters(allMovies());
  $("#moviesEmpty").hidden = ms.length > 0;

  listEl.hidden = VIEW !== "list";
  gridEl.hidden = VIEW !== "grid";

  if (VIEW === "list") {
    gridEl.innerHTML = "";
    listEl.innerHTML = listHTML(ms);
  } else {
    listEl.innerHTML = "";
    gridEl.innerHTML = ms.map(cardHTML).join("");
    gridEl.querySelectorAll(".poster[data-wiki]").forEach(async (el) => {
      const url = await getPoster(el.dataset.wiki, el.dataset.manualPoster, el.dataset.imdb, el.dataset.year);
      el.style.backgroundImage = url ? `url("${url}")` : "";
      el.classList.toggle("ph", !url);
    });
  }

  // click → details modal
  document.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () => openDetails(Number(el.dataset.open)))
  );
}

/* ---------- list view (original table, no posters) ---------- */
function listHTML(ms) {
  const head = `
    <thead><tr>
      <th>${t("thId")}</th><th>${t("thTitle")}</th><th>${t("thYear")}</th><th>${t("thDirector")}</th><th>${t("thCountry")}</th>
      <th>${t("thSeason")}</th><th>${t("thWatched")}</th>
      ${RATERS.map((r) => `<th class="c-num">${r.name}</th>`).join("")}
      <th class="c-num">${t("thAvg")}</th>
    </tr></thead>`;
  const rows = ms.map((m) => {
    const avg = avgRate(m.rates);
    const cells = RATERS.map((r) => {
      const v = m.rates?.[r.key];
      return rated(v)
        ? `<td class="c-rate ${rateClass(v)}">${v}</td>`
        : `<td class="r-na">—</td>`;
    }).join("");
    return `
    <tr data-open="${m.id}" title="${esc(t("rowHint"))}">
      <td class="c-id">${m.id}</td>
      <td class="c-title"><span class="t">${esc(m.title)}</span>${m.titleEn ? `<br><span class="o">${esc(m.titleEn)}</span>` : ""}</td>
      <td class="c-num">${esc(m.year || "—")}</td>
      <td class="c-dir">${esc((m.director || "").split(",")[0].trim() || "—")}</td>
      <td class="c-country">${esc((m.country || "").split(",").map((c) => c.trim()).filter(Boolean)[0] || "—")}</td>
      <td class="c-num">${esc(m.season || seasonFromDate(m.date) || "—")}</td>
      <td class="c-date">${esc(m.date || "—")}</td>
      ${cells}
      <td class="c-avg ${avg > 0 ? rateClass(avg) : "r-na"}">${avg > 0 ? avg.toFixed(1) : "—"}</td>
    </tr>`;
  }).join("");
  return `<table class="mtable">${head}<tbody>${rows}</tbody></table>`;
}

/* ---------- grid view (minimal cards with posters) ---------- */
function cardHTML(m) {
  const avg = avgRate(m.rates);
  const manualPoster = m.poster ? esc(m.poster) : "";
  return `
  <article class="movie-card" data-open="${m.id}" title="${esc(t("rowHint"))}">
    <div class="poster ${m.wiki || m.poster ? "" : "ph"}"
         ${m.wiki ? `data-wiki="${esc(m.wiki)}"` : ""}
         ${m.imdb ? `data-imdb="${esc(m.imdb)}"` : ""}
         ${m.year ? `data-year="${esc(m.year)}"` : ""}
         ${manualPoster ? `data-manual-poster="${manualPoster}"` : ""}>
      <span class="ph-text">${t("noPoster")}</span>
      ${avg > 0 ? `<span class="p-avg ${avgClass(avg)}">${avg.toFixed(1)}</span>` : ""}
    </div>
    <div class="card-body">
      <span class="t">${esc(m.title)}</span>
      ${m.titleEn ? `<span class="o">${esc(m.titleEn)}</span>` : ""}
      <span class="meta">${esc(m.year || "—")} · ${esc((m.country || "").split(",").map((c) => c.trim()).filter(Boolean)[0] || "—")}${m.director ? ` · ${esc((m.director || "").split(",")[0].trim())}` : ""}</span>
      <div class="card-foot">
        <span class="avg ${avg > 0 ? avgClass(avg) : ""}">${avg > 0 ? avg.toFixed(1) : "—"}</span>
        <span class="date">${esc(m.date || "")}</span>
      </div>
    </div>
  </article>`;
}

/* ---------- details modal (opened by clicking a movie) ---------- */
function openDetails(id) {
  const m = MOVIES[String(id)];
  if (!m) return;
  const show = { ...m, country: normalizeCountry(m.country) }; // one spelling per country in UI
  const avg = avgRate(m.rates);

  const ratesHTML = RATERS.map((r) => {
    const v = m.rates?.[r.key];
    return `<span class="rate">${r.name}<b class="${rated(v) ? rateClass(v) : "r-na"}">${rated(v) ? v : "—"}</b></span>`;
  }).join("");

  const links = [];
  if (m.imdb) links.push(`<a href="${esc(m.imdb)}" target="_blank" rel="noopener">IMDb</a>`);
  if (m.wiki) links.push(`<a href="${esc(m.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);

  const manualPoster = m.poster ? esc(m.poster) : "";

  $("#detailsBody").innerHTML = `
    <div class="d-poster ${m.wiki || m.poster ? "" : "ph"}" id="detailsPoster"
         ${m.wiki ? `data-wiki="${esc(m.wiki)}"` : ""}
         ${manualPoster ? `data-manual-poster="${manualPoster}"` : ""}>
      <span class="ph-text">${t("noPoster")}</span>
    </div>
    <div class="d-info">
      <h3>${esc(show.title)}</h3>
      ${show.titleEn ? `<p class="d-orig">${esc(show.titleEn)}</p>` : `<p class="d-orig"></p>`}
      <dl class="d-rows">
        <dt>${t("dYear")}</dt><dd>${esc(show.year || "—")}</dd>
        <dt>${t("dDirector")}</dt><dd>${esc(show.director || "—")}</dd>
        <dt>${t("dCountry")}</dt><dd>${esc(show.country || "—")}</dd>
        <dt>${t("dGenre")}</dt><dd>${esc(show.genre || "—")}</dd>
        <dt>${t("dSeason")}</dt><dd>${esc(show.season || seasonFromDate(show.date) || "—")}</dd>
        <dt>${t("dWatched")}</dt><dd>${esc(show.date || "—")}</dd>
      </dl>
      <div class="d-rates">${ratesHTML}</div>
      <p class="d-avg">${t("dAvg")}: <b class="${avg > 0 ? rateClass(avg) : "r-na"}">${avg > 0 ? avg.toFixed(1) : "—"} / 10</b></p>
      ${links.length ? `<div class="d-links">${links.join("")}</div>` : ""}
      <div class="d-actions">
        <button class="btn" id="dFetch" title="Wikipedia / IMDb">${t("btnFetch")}</button>
        <button class="btn" id="dEdit">${t("btnEdit")}</button>
        <button class="btn danger" id="dDelete">${t("btnDelete")}</button>
      </div>
    </div>`;

  $("#detailsModal").hidden = false;

  // async poster (language-aware: works for uk / en / ru wiki links alike)
  const pEl = $("#detailsPoster");
  if (m.wiki || m.poster) {
    getPoster(m.wiki, m.poster, m.imdb, m.year).then((url) => {
      if (url && document.body.contains(pEl)) {
        pEl.style.backgroundImage = `url("${url}")`;
        pEl.classList.remove("ph");
      }
    });
  }

  // auto-heal: if this record still has no poster / links / metadata, fetch
  // everything in the background — no manual "Fetch info" press needed
  if (!m.poster && !m.wiki && !m.imdb && !autoHealTried.has(String(id))) {
    autoHealTried.add(String(id));
    lookupForMovie(m)
      .then(async (info) => {
        if (!info.poster && !info.imdb && !info.wiki) return;
        await saveMovie({ ...m, ...info, country: normalizeCountry(info.country) || m.country });
      })
      .catch(() => { /* stays manual — the Fetch info button is still there */ });
  }

  // poster auto-heal: the record has links but no stored poster — resolve it
  // in the background and patch the record (no button press needed)
  if (!m.poster && (m.wiki || m.imdb) && !posterHealTried.has(String(id))) {
    posterHealTried.add(String(id));
    getPoster(m.wiki, "", m.imdb, m.year).then((url) => {
      if (url && AUTO_SAVE) update(ref(db, `${DB_PATH}/${id}`), { poster: url }).catch(() => {});
    });
  }

  $("#dEdit").addEventListener("click", () => { closeDetails(); openEditor(id); });
  $("#dDelete").addEventListener("click", () => {
    if (confirm(t("confirmDelete", { title: m.title, id }))) {
      closeDetails();
      deleteMovie(id);
    }
  });
  $("#dFetch").addEventListener("click", async () => {
    const btn = $("#dFetch");
    btn.disabled = true;
    btn.textContent = t("btnFetching");
    try {
      const info = await lookupForMovie(m);
      await saveMovie({ ...m, ...info, country: normalizeCountry(info.country) || m.country });
      closeDetails();
      toast(t("tInfoUpdated"), "ok");
    } catch (e) {
      toast(t("tFetchFail", { msg: e.message }), "err");
      btn.disabled = false;
      btn.textContent = t("btnFetch");
    }
  });
}

// search Wikipedia/Wikidata for a movie record and return the enriched fields
async function lookupForMovie(m) {
  const cands = await searchFilms(m.title, m.year || "");
  const films = cands.filter((c) => c.isFilm);
  if (!films.length) throw new Error("no film match on Wikipedia");
  const c = films.find((x) => m.year && String(x.year || "") === String(m.year)) || films[0];
  return getFilmDetails(c);
}

// ---------- editable detail fields (custom edits always win) ----------
// The automatic Wikipedia/IMDb lookup PRE-FILLS these inputs, but a field the
// user has touched by hand (data-dirty) is NEVER overwritten — so a custom
// Ukrainian title, corrected director, custom poster URL, etc. survives the
// lookup and is exactly what gets saved.
const DETAIL_INPUTS = ["#mTitle", "#mYear", "#mTitleEn", "#mDirector", "#mCountry", "#mGenre", "#mWiki", "#mImdb", "#mPoster"];

function fillDetailFields(scope, info) {
  if (!info || !scope) return;
  const map = {
    titleEn: "#mTitleEn", director: "#mDirector", country: "#mCountry",
    genre: "#mGenre", wiki: "#mWiki", imdb: "#mImdb", poster: "#mPoster",
  };
  Object.entries(map).forEach(([key, sel]) => {
    const el = scope.querySelector(sel);
    if (!el || el.dataset.dirty) return;
    let v = String(info[key] || "").trim();
    if (key === "country") v = normalizeCountry(v);
    if (v) el.value = v;
  });
  const y = scope.querySelector("#mYear");
  if (y && !y.value && !y.dataset.dirty && info.year) y.value = info.year;
}

function wireDetailFields(scope) {
  DETAIL_INPUTS.forEach((sel) => {
    const el = scope.querySelector(sel);
    if (el) el.addEventListener("input", () => { el.dataset.dirty = "1"; });
  });
}

function clearDirty(scope) {
  scope.querySelectorAll("[data-dirty]").forEach((el) => { delete el.dataset.dirty; });
}

// after a manual save, make sure a poster exists: resolve it from the wiki /
// imdb links in the background and patch the record — no button press needed
async function autoPoster(data) {
  if (!AUTO_SAVE || !data?.id || data.poster || (!data.wiki && !data.imdb)) return;
  try {
    const url = await getPoster(data.wiki, "", data.imdb, data.year);
    if (url) {
      await update(ref(db, `${DB_PATH}/${data.id}`), { poster: url });
      toast(t("tPosterAuto"), "ok");
    }
  } catch (e) { /* cosmetic — non-fatal */ }
}

// ---------- lookup UI inside add/edit forms ----------
function pickInfoFields(m) {
  return {
    titleEn: m.titleEn || "", year: m.year || null,
    country: m.country || "", director: m.director || "", genre: m.genre || "",
    imdb: m.imdb || "", wiki: m.wiki || "", poster: m.poster || "",
  };
}

function wireLookup(area, getQuery, opts = {}) {
  const auto = opts.auto !== false;   // false → never search on open (edit modal)
  const scopeOf = () => area.closest("form") || area.closest(".modal-body") || document;
  let token = 0;
  let timer = null;
  let pending = null;   // resolves when the current lookup chain fully settles

  const schedule = () => {
    clearTimeout(timer);
    const { title, year } = getQuery();
    if (title.length < 2 || !/^\d{4}$/.test(year)) { pending = null; return; }
    let done;
    pending = new Promise((r) => (done = r));
    timer = setTimeout(() => runSearch(++token).then(done, done), 600);
  };

  // wait (max 12 s) for an in-flight lookup so Save never persists
  // empty metadata just because the user clicked before fetch finished
  const settled = () => {
    const { title, year } = getQuery();
    const valid = title.length >= 2 && /^\d{4}$/.test(year);
    if (!pending && valid && !area._fetched) schedule(); // saved right after typing
    return Promise.race([pending || Promise.resolve(), new Promise((r) => setTimeout(r, 12000))]);
  };

  const runNow = () => {
    const { title, year } = getQuery();
    if (title.length < 2 || !/^\d{4}$/.test(year)) {
      area.innerHTML = `<p class="lookup-status">${esc(t("lkNeed"))}</p>`;
      return;
    }
    clearTimeout(timer);
    runSearch(++token);
  };

  async function runSearch(tok) {
    const { title, year } = getQuery();
    area._fetched = null;
    area.innerHTML = `<p class="lookup-status">${esc(t("lkSearching"))}</p>`;
    try {
      const all = await searchFilms(title, year);
      if (tok !== token) return;
      const films = all.filter((c) => c.isFilm);
      if (films.length) {
        const pool = films.slice(0, 5);
        renderCandidates(pool, "");
        await pick(pool.find((c) => String(c.year || "") === year) || pool[0], tok);
      } else if (all.length) {
        // only non-film pages matched — never auto-pick, let the user decide
        const pool = all.slice(0, 5);
        renderCandidates(pool, t("lkNoFilm"));
      } else {
        area.innerHTML = `<p class="lookup-status">${esc(t("lkNone"))}</p>`;
      }
    } catch (e) {
      if (tok !== token) return;
      area.innerHTML = `<p class="lookup-status">${esc(t("lkFail", { msg: e.message }))}</p>`;
    }
  }

  function renderCandidates(pool, note = "") {
    const status = area.querySelector(".lookup-status");
    const list = document.createElement("div");
    list.className = "cand-list";
    list.innerHTML = pool.map((c) => `
      <button type="button" class="cand" data-qid="${esc(c.qid)}">
        ${esc(c.pageTitle)}${c.year ? ` (${c.year})` : ""}${c.desc && c.desc !== c.pageTitle ? ` — <span class="muted">${esc(c.desc)}</span>` : ""}
      </button>`).join("");
    area.innerHTML = "";
    if (status) {
      status.textContent = note || t("lkPicks", { n: pool.length, word: pluralW(pool.length, "match") });
      area.appendChild(status);
    }
    area.appendChild(list);
    list.querySelectorAll(".cand").forEach((btn) =>
      btn.addEventListener("click", () => {
        const c = pool.find((x) => x.qid === btn.dataset.qid);
        if (c) pick(c, token).catch(() => {});
      })
    );
  }

  async function pick(c, tok) {
    area.querySelectorAll(".cand").forEach((el) => el.classList.toggle("sel", el.dataset.qid === c.qid));
    let status = area.querySelector(".lookup-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "lookup-status";
      area.prepend(status);
    }
    status.textContent = t("lkLoading");
    try {
      const info = await getFilmDetails(c);
      if (tok !== token) return;
      area._fetched = info;
      fillDetailFields(scopeOf(), info);   // editable inputs — dirty ones kept
      renderFetched(area, info, t("lkFilled"));
    } catch (e) {
      if (tok !== token) return;
      status.textContent = t("lkDetailsFail", { msg: e.message });
    }
  }

  if (auto) schedule(); // add form: trigger when fields are already valid
  return { schedule, settled, runNow };
}

function renderFetched(area, info, note) {
  let status = area.querySelector(".lookup-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "lookup-status";
    area.prepend(status);
  }
  if (note) status.textContent = note;
  const links = [];
  if (info.imdb) links.push(`<a href="${esc(info.imdb)}" target="_blank" rel="noopener">IMDb</a>`);
  if (info.wiki) links.push(`<a href="${esc(info.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);
  let box = area.querySelector(".fetched");
  if (!box) {
    box = document.createElement("div");
    box.className = "fetched";
    area.appendChild(box);
  }
  box.innerHTML = `
    <div class="fthumb" ${info.poster ? `style="background-image:url('${esc(info.poster)}')"` : ""}></div>
    <div class="fmeta">
      <b>${esc(info.titleEn || "")}</b>${info.year ? ` (${esc(info.year)})` : ""}<br>
      ${info.director ? `${esc(info.director)}` : ""}${info.country ? ` · ${esc(info.country)}` : ""}${info.genre ? ` · ${esc(info.genre)}` : ""}<br>
      ${links.join("")}
    </div>`;
}

function closeDetails() { $("#detailsModal").hidden = true; }

// ---------- posters from Wikipedia (auto, language-aware) ----------
// The wiki link may point to uk / en / ru Wikipedia. The poster is resolved
// on THAT wiki first, then cross-checked on en/uk, then via Wikidata P18 —
// so posters load automatically without the manual Fetch button.
function wikiRef(wikiUrl) {
  const m = String(wikiUrl || "").match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  let title;
  try { title = decodeURIComponent(m[2]); } catch (e) { title = m[2]; }
  return { lang: m[1].toLowerCase(), title: title.replace(/_/g, " ") };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function posterFromWiki(lang, title) {
  // 1) page image on this language wiki (REST summary)
  try {
    const data = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`);
    if (data?.type === "disambiguation") return null; // disambig pages have no poster
    let src = data?.originalimage?.source || data?.thumbnail?.source || null;
    if (src) {
      if (data.thumbnail?.source) src = src.replace(/\/\d+px-/, "/500px-");
      src = src.replace(/([?&])utm_[^&]*/g, "$1").replace(/[?&]+$/, ""); // drop tracking params
    }
    if (src) return src;
  } catch (e) { /* fall through to Wikidata */ }

  // 2) resolve the page → Wikidata item → P18 image on Commons
  try {
    const d = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`);
    const page = Object.values(d?.query?.pages || {})[0];
    const qid = page?.pageprops?.wikibase_item;
    if (qid) {
      const ent = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
      const img = ent?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (img) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(img).replace(/ /g, "_"))}?width=500`;
    }
  } catch (e) { /* give up for this wiki */ }
  return null;
}

async function getPoster(wikiUrl, manual, imdb, year) {
  if (manual) return manual;
  const w = wikiRef(wikiUrl);
  if (!w) return null;
  const key = `${w.lang}:${w.title}`;
  if (posterCache[key] !== undefined) return posterCache[key];
  if (posterInFlight[key]) return posterInFlight[key];

  posterInFlight[key] = (async () => {
    let src = await posterFromWiki(w.lang, w.title);
    if (!src && w.lang !== "en") src = await posterFromWiki("en", w.title);
    if (!src && w.lang !== "uk") src = await posterFromWiki("uk", w.title);
    // wiki link points at a disambiguation page or an imageless article —
    // search this wiki for the film article (title + release year) with an image
    if (!src) src = await posterFromWikiSearch(w.lang, w.title, year);
    // last resort: identify the film by its IMDb ID (P345) on Wikidata → P18
    if (!src) src = await posterFromImdb(imdb);
    posterCache[key] = src;
    try { localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache)); } catch (e) {}
    return src;
  })();

  try {
    return await posterInFlight[key];
  } finally {
    delete posterInFlight[key];
  }
}

// wiki search restricted to pages that actually have an image —
// disambiguation pages never do, so this skips them naturally.
// pilicense=any is required: film posters are fair-use (non-free) images.
async function posterFromWikiSearch(lang, title, year) {
  try {
    const q = [title, year ? String(year) : ""].filter(Boolean).join(" ");
    const d = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=pageimages&piprop=thumbnail&pithumbsize=500&pilicense=any&redirects=1&format=json&origin=*`);
    const pages = Object.values(d?.query?.pages || {})
      .filter((p) => p.thumbnail?.source)
      .sort((a, b) => (a.index || 99) - (b.index || 99));
    if (pages.length) return pages[0].thumbnail.source.replace(/([?&])utm_[^&]*/g, "$1");
  } catch (e) { /* no match */ }
  return null;
}

// identify the film by IMDb ID (Wikidata P345) and take its P18 poster
async function posterFromImdb(imdb) {
  const tt = (String(imdb || "").match(/tt\d{6,}/) || [])[0];
  if (!tt) return null;
  try {
    const d = await fetchJson(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P345=${tt}`)}&format=json&origin=*`);
    const qid = d?.query?.search?.[0]?.title;
    if (!qid || !/^Q\d+$/.test(qid)) return null;
    const ent = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const img = ent?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (img) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(img).replace(/ /g, "_"))}?width=500`;
  } catch (e) { /* not on Wikidata */ }
  return null;
}

// ============================================================
// Admin form (add / edit)
// ============================================================
function currentRatesFromInputs(scope = document) {
  const rates = {};
  RATERS.forEach((r) => {
    const inp = scope.querySelector(`[data-rate="${r.key}"]`);
    rates[r.key] = inp ? Math.max(0, Math.min(10, Number(inp.value) || 0)) : 0;
  });
  return rates;
}

function buildForm(container, movie) {
  const m = movie || { title: "", year: "", date: new Date().toISOString().slice(0, 10), rates: {} };
  container.innerHTML = `
    <div class="form-row">
      <div class="form-field grow"><label>${t("fTitle")} *</label><input id="mTitle" required value="${esc(m.title)}" placeholder="Фантазм 2"></div>
      <div class="form-field"><label>${t("fYear")} *</label><input id="mYear" type="number" min="1895" max="2100" required value="${esc(m.year)}" placeholder="1988"></div>
      <div class="form-field"><label>${t("fDate")} *</label><input id="mDate" type="date" required value="${esc(m.date)}"></div>
    </div>
    <div class="section-label">${t("detailsNote")}</div>
    <div class="details-fields">
      <div class="form-field"><label>${t("fTitleEn")}</label><input id="mTitleEn" value="${esc(m.titleEn || "")}" placeholder="Phantasm II"></div>
      <div class="form-field"><label>${t("fDirector")}</label><input id="mDirector" value="${esc(m.director || "")}"></div>
      <div class="form-field"><label>${t("fCountry")}</label><input id="mCountry" value="${esc(m.country || "")}" placeholder="США"></div>
      <div class="form-field"><label>${t("fGenre")}</label><input id="mGenre" value="${esc(m.genre || "")}"></div>
      <div class="form-field wide"><label>Wikipedia URL</label><input id="mWiki" type="url" value="${esc(m.wiki || "")}" placeholder="https://uk.wikipedia.org/wiki/…"></div>
      <div class="form-field wide"><label>IMDb URL</label><input id="mImdb" type="url" value="${esc(m.imdb || "")}" placeholder="https://www.imdb.com/title/…"></div>
      <div class="form-field wide"><label>${t("fPoster")}</label><input id="mPoster" type="url" value="${esc(m.poster || "")}" placeholder="https://…"></div>
    </div>
    <div class="lookup-bar">
      <div class="lookup" id="lookupArea"></div>
      <button type="button" class="btn ghost sm" data-find>${t("btnFind")}</button>
    </div>
    <div class="form-row rates-row">
      ${RATERS.map((r) => `
        <div class="form-field rate-field">
          <label>${r.name}</label>
          <select data-rate="${r.key}">
            ${Array.from({ length: 11 }, (_, v) => `<option value="${v}" ${Number(m.rates?.[r.key] || 0) === v ? "selected" : ""}>${v === 0 ? "—" : v}</option>`).join("")}
          </select>
        </div>`).join("")}
    </div>
    <div class="form-actions">
      <button type="button" class="btn primary" id="modalSave">${t("btnSave")}</button>
      <button type="button" class="btn" id="modalCancel">${t("btnCancel")}</button>
    </div>`;

  // show the stored metadata as a preview — the fields above are already
  // filled from the record; the lookup only refreshes them when the user
  // edits the title/year or presses "Find data". Manual edits always win.
  const area = container.querySelector("#lookupArea");
  if (movie && (movie.imdb || movie.wiki || movie.director || movie.titleEn)) {
    renderFetched(area, pickInfoFields(movie), t("lkCurrent"));
  }
  wireDetailFields(container);
  const lookup = wireLookup(area, () => ({
    title: container.querySelector("#mTitle").value.trim(),
    year: container.querySelector("#mYear").value.trim(),
  }), { auto: false }); // edit modal: never auto-search/auto-pick on open
  container.querySelector("#mTitle").addEventListener("input", lookup.schedule);
  container.querySelector("#mYear").addEventListener("input", lookup.schedule);
  container.querySelector("[data-find]").addEventListener("click", lookup.runNow);

  container.querySelector("#modalSave").addEventListener("click", async () => {
    await lookup.settled();
    collectAndSave(movie?.id);
  });
  container.querySelector("#modalCancel").addEventListener("click", closeEditor);
}

// build the movie record from a form scope (add form or edit modal);
// the editable inputs are the single source — the Wikipedia/IMDb lookup only
// pre-fills them, so any custom title / metadata the user typed is kept
function movieFromForm(id, scope) {
  const get = (s) => scope.querySelector(s)?.value.trim() || "";
  const date = get("#mDate");
  const info = scope.querySelector(".lookup")?._fetched || {}; // fallback for year only
  return {
    id: Number(id),
    title: get("#mTitle"),
    titleEn: get("#mTitleEn"),
    year: Number(get("#mYear")) || Number(info.year) || null,
    country: normalizeCountry(get("#mCountry")),
    director: get("#mDirector"),
    genre: get("#mGenre"),
    date,
    season: seasonFromDate(date),
    imdb: get("#mImdb"),
    wiki: get("#mWiki"),
    poster: get("#mPoster"),
    rates: currentRatesFromInputs(scope),
  };
}

function collectData(id) {
  return movieFromForm(id, $("#movieForm"));
}

function collectAndSave(existingId) {
  const modal = $("#editModal");
  const id = modal.hidden ? Number($("#mId").value) : existingId;
  const data = modal.hidden ? collectData(id) : collectDataFromModal(id);
  if (!data.title || !data.year || !data.date) { toast(t("tRequired"), "warn"); return; }
  saveMovie(data);
  autoPoster(data); // background: resolve a poster if none is stored
  closeEditor();
}

function collectDataFromModal(id) {
  return movieFromForm(id, $("#editModalBody"));
}

function openEditor(id) {
  const m = MOVIES[String(id)];
  if (!m) return;
  $("#editModalTitle").textContent = t("editTitle", { id, title: m.title });
  buildForm($("#editModalBody"), m);
  $("#editModal").hidden = false;
}

function closeEditor() { $("#editModal").hidden = true; }

// ============================================================
// Theme (light default; dark optional — icon toggle in the header)
// ============================================================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  const btn = $("#themeBtn");
  if (btn) {
    btn.title = t("themeToggle");
    btn.setAttribute("aria-label", t("themeToggle"));
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  renderStats(allMovies(), $("#chartsGrid"), $("#kpiGrid")); // re-theme charts
}

// ============================================================
// Language (Ukrainian default; EN toggle in the header)
// ============================================================
function applyLangUI() {
  const btn = $("#langBtn");
  if (btn) btn.textContent = getLang() === "uk" ? "EN" : "UA";
}

function switchLang() {
  setLang(getLang() === "uk" ? "en" : "uk");
  applyStaticLang();          // static header/toolbar/forms
  applyLangUI();              // button label shows the OTHER language
  applyTheme(document.documentElement.dataset.theme); // refresh tooltip
  if (lastSyncState) setSync(lastSyncState.online, lastSyncState.label); // re-render badge
  closeDetails();
  closeEditor();
  renderAll();                // re-render table/cards/stats with new strings
}

// ============================================================
// View switch (list default — original table look; grid with posters)
// ============================================================
function applyView(view) {
  VIEW = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
  $("#viewList").classList.toggle("active", view === "list");
  $("#viewGrid").classList.toggle("active", view === "grid");
  renderMovies();
}

// ============================================================
// Events
// ============================================================
function bindEvents() {
  // tabs
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab, .tab-panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(`#tab-${t.dataset.tab}`).classList.add("active");
    })
  );

  // view toggle
  $("#viewList").addEventListener("click", () => applyView("list"));
  $("#viewGrid").addEventListener("click", () => applyView("grid"));

  // theme + language
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#langBtn").addEventListener("click", switchLang);

  // filters
  const bind = (sel, key) => $(sel).addEventListener("input", (e) => { FILTERS[key] = e.target.value; renderMovies(); });
  const bindBoth = (sel, key) => {
    const el = $(sel);
    const handler = (e) => { FILTERS[key] = e.target.value; renderMovies(); };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  };
  bind("#fSearch", "q");
  bindBoth("#fSeason", "season"); bindBoth("#fDecade", "decade");
  bindBoth("#fCountry", "country"); bindBoth("#fDirector", "director");
  bindBoth("#fSort", "sort");

  const resetFilters = () => {
    FILTERS = { q: "", season: "", decade: "", country: "", director: "", sort: "date-desc" };
    $("#fSearch").value = ""; $("#fSeason").value = ""; $("#fDecade").value = "";
    $("#fCountry").value = ""; $("#fDirector").value = ""; $("#fSort").value = "date-desc";
    renderMovies();
  };
  $("#emptyReset").addEventListener("click", resetFilters);

  // admin add form
  const addLookupArea = $("#formLookup");
  const addLookup = wireLookup(addLookupArea, () => ({
    title: $("#mTitle").value.trim(),
    year: $("#mYear").value.trim(),
  }));
  $("#mTitle").addEventListener("input", addLookup.schedule);
  $("#mYear").addEventListener("input", addLookup.schedule);
  $("#formFindBtn").addEventListener("click", addLookup.runNow);

  $("#movieForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addLookup.settled();
    const data = collectData(Number($("#mId").value) || nextFreeId());
    if (!data.title || !data.year || !data.date) { toast(t("tRequired"), "warn"); return; }
    saveMovie(data);
    autoPoster(data); // background: resolve a poster if none is stored
    e.target.reset();
    clearDirty($("#movieForm"));
    addLookupArea._fetched = null;
    addLookupArea.innerHTML = "";
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });
  $("#clearFormBtn").addEventListener("click", () => {
    $("#movieForm").reset();
    $("#mId").value = "";
    clearDirty($("#movieForm"));
    addLookupArea._fetched = null;
    addLookupArea.innerHTML = "";
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });

  // tools
  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importFile").addEventListener("change", importJSON);
  $("#seedBtn").addEventListener("click", () => {
    if (confirm(t("confirmSeed"))) seedFirebase(true);
  });

  // modals
  $("#closeModalBtn").addEventListener("click", closeEditor);
  $("#editModal").addEventListener("click", (e) => { if (e.target === $("#editModal")) closeEditor(); });
  $("#closeDetailsBtn").addEventListener("click", closeDetails);
  $("#detailsModal").addEventListener("click", (e) => { if (e.target === $("#detailsModal")) closeDetails(); });

  // Esc closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDetails(); closeEditor(); }
  });
}

function nextFreeId() {
  const ids = Object.keys(MOVIES).map(Number);
  return (ids.length ? Math.max(...ids) : 2) + 1;
}

function buildRatesRow() {
  $("#ratesRow").innerHTML = RATERS.map((r) => `
    <div class="form-field rate-field">
      <label>${r.name}</label>
      <select data-rate="${r.key}">
        ${Array.from({ length: 11 }, (_, v) => `<option value="${v}" ${v === 0 ? "selected" : ""}>${v === 0 ? "—" : v}</option>`).join("")}
      </select>
    </div>`).join("");
}

// ---------- backup tools ----------
function exportJSON() {
  const blob = new Blob([JSON.stringify(currentSnapshot || MOVIES, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `movie_base_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t("tExported"), "ok");
}

async function importJSON(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const movies = normalizeMovies(data.movies || data);   // accept raw or wrapped format
    if (!Object.keys(movies).length) throw new Error("no movies in file");
    const payload = {};
    Object.entries(movies).forEach(([id, m]) => (payload[`${DB_PATH}/${id}`] = m));
    await update(ref(db), payload);
    toast(t("tImported"), "ok");
  } catch (err) {
    console.error(err);
    toast(t("tImportFail", { msg: err.message }), "err");
  }
}

// ============================================================
// init
// ============================================================
(function init() {
  try { posterCache = JSON.parse(localStorage.getItem(POSTER_CACHE_KEY)) || {}; } catch (e) { posterCache = {}; }

  // fast first paint from local backup, Firebase replaces it live
  const cached = loadCache();
  if (cached && Object.keys(cached).length) {
    MOVIES = cached;
  } else {
    MOVIES = Object.fromEntries(SEED_MOVIES.map((m) => [String(m.id), m]));
  }

  initLang();          // uk is the default, stored choice persists
  applyStaticLang();   // swap static texts if the stored language is EN
  applyLangUI();
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  applyView((() => { try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"; } catch (e) { return "list"; } })());

  buildRatesRow();
  wireDetailFields($("#movieForm")); // dirty-tracking for the static add form
  $("#mDate").value = new Date().toISOString().slice(0, 10);
  bindEvents();
  renderAll();
  initSync();
})();
