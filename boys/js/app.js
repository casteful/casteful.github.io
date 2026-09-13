// ============================================================
// movie_base app — Firebase RTDB is the SINGLE SOURCE OF TRUTH.
// localStorage is only an automatic offline backup (read fallback).
//
// Hidden settings (no UI by design — owner can flip in code):
//   AUTO_SAVE     = true   → every change is written to Firebase immediately
//   LIVE_UPDATES  = true   → onValue() keeps all open browsers in sync
//   LOCAL_BACKUP  = true   → latest snapshot cached in localStorage
//
// Views: "list" (default — original table, no posters) | "grid" (posters).
// Click any movie (row or card) → details modal with poster, links, actions.
// Theme: light by default (original design), dark optional.
// ============================================================
import { db, ref, onValue, get, update, remove } from "./firebase-config.js";
import { SEED_MOVIES, RATERS, avgRate, seasonFromDate, decadeOf, normalizeCountry } from "./data.js";
import { renderStats } from "./stats.js";
import { searchFilms, getFilmDetails } from "./lookup.js";

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
let countryCleanupDone = false; // one-time DB normalization of country variants
const autoHealTried = new Set();   // movie ids already auto-enriched this session

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
      useBackup("Firebase read failed — using local backup");
    });
  }
}

function setSync(online, label) {
  const dot = $("#syncDot"), text = $("#syncText"), footer = $("#footerSync");
  if (online) {
    dot.className = "dot on";
    text.textContent = "live";
    footer.textContent = "live via Firebase";
  } else {
    dot.className = "dot off";
    text.textContent = label || "offline — backup";
    footer.textContent = "offline — showing local backup";
  }
}

function useBackup(msg) {
  const cached = loadCache();
  if (cached && Object.keys(cached).length) {
    MOVIES = cached;
    renderAll();
    toast(msg, "warn");
  } else {
    toast(msg + " — no backup found, loading seed data", "warn");
    MOVIES = Object.fromEntries(SEED_MOVIES.map((m) => [String(m.id), m]));
    renderAll();
  }
}

async function seedFirebase(manual = false) {
  const payload = {};
  SEED_MOVIES.forEach((m) => (payload[`${DB_PATH}/${m.id}`] = m));
  try {
    await update(ref(db), payload);
    toast(manual ? "Seed data restored to Firebase" : "First run: movie base uploaded to Firebase", "ok");
  } catch (e) {
    console.error(e);
    toast("Firebase write failed: " + e.message, "err");
  }
}

// ---------- writes (auto-save → Firebase instantly) ----------
async function saveMovie(movie) {
  if (!AUTO_SAVE) return;
  try {
    await update(ref(db, `${DB_PATH}/${movie.id}`), movie);
    toast(`Saved: ${movie.title} (id ${movie.id})`, "ok");
  } catch (e) {
    console.error(e);
    toast("Save failed: " + e.message, "err");
  }
}

async function deleteMovie(id) {
  if (!AUTO_SAVE) return;
  try {
    await remove(ref(db, `${DB_PATH}/${id}`));
    toast(`Deleted movie #${id}`, "ok");
  } catch (e) {
    console.error(e);
    toast("Delete failed: " + e.message, "err");
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
  $("#moviesStrip").innerHTML = `
    <b>${ms.length}</b> movies ·
    <b>${new Set(ms.map((m) => m.season || seasonFromDate(m.date))).size}</b> seasons ·
    <b>${new Set(ms.flatMap((m) => (m.country || "").split(",").map((c) => c.trim())).filter(Boolean)).size}</b> countries ·
    average rating <b>${avg.toFixed(1)}</b> ·
    club favourite: <b>${best ? esc(best.title) : "—"}</b>
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
      <th>id</th><th>title</th><th>year</th><th>director</th><th>country</th>
      <th>season</th><th>watched</th>
      ${RATERS.map((r) => `<th class="c-num">${r.name}</th>`).join("")}
      <th class="c-num">avg</th>
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
    <tr data-open="${m.id}" title="Click for details">
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
  <article class="movie-card" data-open="${m.id}" title="Click for details">
    <div class="poster ${m.wiki || m.poster ? "" : "ph"}"
         ${m.wiki ? `data-wiki="${esc(m.wiki)}"` : ""}
         ${m.imdb ? `data-imdb="${esc(m.imdb)}"` : ""}
         ${m.year ? `data-year="${esc(m.year)}"` : ""}
         ${manualPoster ? `data-manual-poster="${manualPoster}"` : ""}>
      <span class="ph-text">no poster</span>
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
      <span class="ph-text">no poster</span>
    </div>
    <div class="d-info">
      <h3>${esc(m.title)}</h3>
      ${m.titleEn ? `<p class="d-orig">${esc(m.titleEn)}</p>` : `<p class="d-orig"></p>`}
      <dl class="d-rows">
        <dt>Release year</dt><dd>${esc(m.year || "—")}</dd>
        <dt>Director</dt><dd>${esc(m.director || "—")}</dd>
        <dt>Country</dt><dd>${esc(m.country || "—")}</dd>
        <dt>Genre</dt><dd>${esc(m.genre || "—")}</dd>
        <dt>Season</dt><dd>${esc(m.season || seasonFromDate(m.date) || "—")}</dd>
        <dt>Watched on</dt><dd>${esc(m.date || "—")}</dd>
      </dl>
      <div class="d-rates">${ratesHTML}</div>
      <p class="d-avg">Average: <b class="${avg > 0 ? rateClass(avg) : "r-na"}">${avg > 0 ? avg.toFixed(1) : "—"} / 10</b></p>
      ${links.length ? `<div class="d-links">${links.join("")}</div>` : ""}
      <div class="d-actions">
        <button class="btn" id="dFetch" title="Fetch metadata from Wikipedia / IMDb">Fetch info</button>
        <button class="btn" id="dEdit">Edit</button>
        <button class="btn danger" id="dDelete">Delete</button>
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

  $("#dEdit").addEventListener("click", () => { closeDetails(); openEditor(id); });
  $("#dDelete").addEventListener("click", () => {
    if (confirm(`Delete "${m.title}" (id ${id}) from the database?`)) {
      closeDetails();
      deleteMovie(id);
    }
  });
  $("#dFetch").addEventListener("click", async () => {
    const btn = $("#dFetch");
    btn.disabled = true;
    btn.textContent = "Fetching…";
    try {
      const info = await lookupForMovie(m);
      await saveMovie({ ...m, ...info });
      closeDetails();
      toast("Info updated from Wikipedia / IMDb", "ok");
    } catch (e) {
      toast("Fetch failed: " + e.message, "err");
      btn.disabled = false;
      btn.textContent = "Fetch info";
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

// ---------- lookup UI inside add/edit forms ----------
function pickInfoFields(m) {
  return {
    titleEn: m.titleEn || "", year: m.year || null,
    country: m.country || "", director: m.director || "", genre: m.genre || "",
    imdb: m.imdb || "", wiki: m.wiki || "", poster: m.poster || "",
  };
}

function wireLookup(area, getQuery) {
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

  async function runSearch(tok) {
    const { title, year } = getQuery();
    area._fetched = null;
    area.innerHTML = `<p class="lookup-status">Searching Wikipedia…</p>`;
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
        renderCandidates(pool, "No exact film match — if one of these is the film, pick it; otherwise the info will stay empty:");
      } else {
        area.innerHTML = `<p class="lookup-status">No Wikipedia match — extra info will stay empty (the movie can still be saved).</p>`;
      }
    } catch (e) {
      if (tok !== token) return;
      area.innerHTML = `<p class="lookup-status">Lookup failed: ${esc(e.message)}</p>`;
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
      status.textContent = note || `${pool.length} match${pool.length > 1 ? "es" : ""} — pick one if it is not the right film:`;
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
    status.textContent = "Loading film details…";
    try {
      const info = await getFilmDetails(c);
      if (tok !== token) return;
      area._fetched = info;
      renderFetched(area, info);
      status.remove();
    } catch (e) {
      if (tok !== token) return;
      status.textContent = "Details failed: " + e.message;
    }
  }

  schedule(); // initial trigger when fields are already valid (edit modal)
  return { schedule, settled };
}

function renderFetched(area, info) {
  const links = [];
  if (info.imdb) links.push(`<a href="${esc(info.imdb)}" target="_blank" rel="noopener">IMDb</a>`);
  if (info.wiki) links.push(`<a href="${esc(info.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);
  let box = area.querySelector(".fetched");
  if (!box) {
    box = document.createElement("div");
    box.className = "fetched";
    area.prepend(box);
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
      <div class="form-field grow"><label>Title *</label><input id="mTitle" required value="${esc(m.title)}" placeholder="Фантазм 2"></div>
      <div class="form-field"><label>Release year *</label><input id="mYear" type="number" min="1895" max="2100" required value="${esc(m.year)}" placeholder="1988"></div>
      <div class="form-field"><label>Watched on *</label><input id="mDate" type="date" required value="${esc(m.date)}"></div>
    </div>
    <div class="lookup" id="lookupArea"></div>
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
      <button type="button" class="btn primary" id="modalSave">Save to Firebase</button>
      <button type="button" class="btn" id="modalCancel">Cancel</button>
    </div>`;

  // show already-known info immediately, then allow re-fetch by editing title/year
  const area = container.querySelector("#lookupArea");
  if (movie && (movie.imdb || movie.wiki || movie.director || movie.titleEn)) {
    area._fetched = pickInfoFields(movie);
    renderFetched(area, area._fetched);
  }
  const lookup = wireLookup(area, () => ({
    title: container.querySelector("#mTitle").value.trim(),
    year: container.querySelector("#mYear").value.trim(),
  }));
  container.querySelector("#mTitle").addEventListener("input", lookup.schedule);
  container.querySelector("#mYear").addEventListener("input", lookup.schedule);

  container.querySelector("#modalSave").addEventListener("click", async () => {
    await lookup.settled();
    collectAndSave(movie?.id);
  });
  container.querySelector("#modalCancel").addEventListener("click", closeEditor);
}

// build the movie record from a form scope (add form or edit modal);
// metadata (original title, director, country, genre, links, poster) comes
// from the Wikipedia/IMDb lookup, not from manual inputs
function movieFromForm(id, scope) {
  const get = (s) => scope.querySelector(s)?.value.trim() || "";
  const date = get("#mDate");
  // the fetched metadata lives on the .lookup area INSIDE the form scope
  // (add form: #formLookup, edit modal: #lookupArea)
  const info = scope.querySelector(".lookup")?._fetched || scope._fetched || {};
  return {
    id: Number(id),
    title: get("#mTitle"),
    titleEn: info.titleEn || "",
    year: Number(info.year || get("#mYear")) || null,
    country: normalizeCountry(info.country || ""),
    director: info.director || "",
    genre: info.genre || "",
    date,
    season: seasonFromDate(date),
    imdb: info.imdb || "",
    wiki: info.wiki || "",
    poster: info.poster || "",
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
  if (!data.title || !data.year || !data.date) { toast("Title, release year and watch date are required", "warn"); return; }
  saveMovie(data);
  closeEditor();
}

function collectDataFromModal(id) {
  return movieFromForm(id, $("#editModalBody"));
}

function openEditor(id) {
  const m = MOVIES[String(id)];
  if (!m) return;
  $("#editModalTitle").textContent = `Edit movie #${id} — ${m.title}`;
  buildForm($("#editModalBody"), m);
  $("#editModal").hidden = false;
}

function closeEditor() { $("#editModal").hidden = true; }

// ============================================================
// Theme (light default — original design; dark optional)
// ============================================================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  $("#themeBtn").textContent = theme === "light" ? "Dark" : "Light";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  renderStats(allMovies(), $("#chartsGrid"), $("#kpiGrid")); // re-theme charts
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

  // theme
  $("#themeBtn").addEventListener("click", toggleTheme);

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

  $("#movieForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addLookup.settled();
    const data = collectData(Number($("#mId").value) || nextFreeId());
    saveMovie(data);
    e.target.reset();
    addLookupArea._fetched = null;
    addLookupArea.innerHTML = "";
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });
  $("#clearFormBtn").addEventListener("click", () => {
    $("#movieForm").reset();
    $("#mId").value = "";
    addLookupArea._fetched = null;
    addLookupArea.innerHTML = "";
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });

  // tools
  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importFile").addEventListener("change", importJSON);
  $("#seedBtn").addEventListener("click", () => {
    if (confirm("Restore the built-in seed dataset to Firebase? Current Firebase content will be overwritten.")) seedFirebase(true);
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
  toast("Backup downloaded", "ok");
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
    toast("Backup imported into Firebase", "ok");
  } catch (err) {
    console.error(err);
    toast("Import failed: " + err.message, "err");
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

  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  applyView((() => { try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"; } catch (e) { return "list"; } })());

  buildRatesRow();
  $("#mDate").value = new Date().toISOString().slice(0, 10);
  bindEvents();
  renderAll();
  initSync();
})();
