// ============================================================
// Movie Club app — Firebase RTDB is the SINGLE SOURCE OF TRUTH.
// localStorage is only an automatic offline backup (read fallback).
//
// Hidden settings (no UI by design — owner can flip in code):
//   AUTO_SAVE     = true   → every change is written to Firebase immediately
//   LIVE_UPDATES  = true   → onValue() keeps all open browsers in sync
//   LOCAL_BACKUP  = true   → latest snapshot cached in localStorage
// ============================================================
import { db, ref, onValue, get, update, remove } from "./firebase-config.js";
import { SEED_MOVIES, RATERS, avgRate, seasonFromDate, decadeOf } from "./data.js";
import { renderStats } from "./stats.js";

const AUTO_SAVE    = true;   // hidden param — always true
const LIVE_UPDATES = true;   // hidden param — always true
const LOCAL_BACKUP = true;   // hidden param — offline fallback

const DB_PATH = "movies";
const CACHE_KEY = "movieclub_cache_v1";
const POSTER_CACHE_KEY = "movieclub_posters_v1";

// ---------- state ----------
let MOVIES = {};           // { "<id>": movie }
let FILTERS = { q: "", season: "", decade: "", country: "", director: "", sort: "date-desc" };
let posterCache = {};      // wikiTitle -> poster URL
let currentSnapshot = null;

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rated = (v) => Number(v) > 0;

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
  return Object.values(MOVIES).map((m) => ({ ...m, id: Number(m.id) }));
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
  // connection badge
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
    text.textContent = "LIVE";
    footer.textContent = "synced with Firebase";
  } else {
    dot.className = "dot off";
    text.textContent = label || "offline · backup";
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
    toast(manual ? "♻️ Seed data restored to Firebase" : "First run: movie base uploaded to Firebase", "ok");
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
    toast(`💾 Saved: ${movie.title} (id ${movie.id})`);
  } catch (e) {
    console.error(e);
    toast("Save failed: " + e.message, "err");
  }
}

async function deleteMovie(id) {
  if (!AUTO_SAVE) return;
  try {
    await remove(ref(db, `${DB_PATH}/${id}`));
    toast(`🗑️ Deleted movie #${id}`);
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
  renderMoviesStrip();
  renderMovies();
  renderStats(allMovies(), $("#chartsGrid"), $("#kpiGrid"));
  fillDatalists();
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

  // keep current selection
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

function fillDatalists() {
  const ms = allMovies();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "uk"));
  const countries = uniq(ms.flatMap((m) => (m.country || "").split(",").map((c) => c.trim())));
  const directors = uniq(ms.flatMap((m) => (m.director || "").split(",").map((c) => c.trim())));
  const genres = uniq(ms.flatMap((m) => (m.genre || "").split(",").map((c) => c.trim())));
  const fill = (id, vals) => {
    const dl = $(id); if (!dl) return;
    dl.innerHTML = vals.map((v) => `<option value="${esc(v)}">`).join("");
  };
  fill("#countryList", countries);
  fill("#directorList", directors);
  fill("#genreList", genres);
}

function renderMoviesStrip() {
  const ms = allMovies();
  const best = ms.reduce((a, m) => (avgRate(m.rates) > avgRate(a?.rates || {}) ? m : a), null);
  const el = $("#moviesStrip");
  el.innerHTML = `
    <div class="strip-item"><b>${ms.length}</b><span>movies</span></div>
    <div class="strip-item"><b>${new Set(ms.map((m) => m.season || seasonFromDate(m.date))).size}</b><span>seasons</span></div>
    <div class="strip-item"><b>${new Set(ms.flatMap((m) => (m.country || "").split(",").map((c) => c.trim()))).size}</b><span>countries</span></div>
    <div class="strip-item"><b>${(ms.reduce((s, m) => s + avgRate(m.rates), 0) / (ms.length || 1)).toFixed(1)}</b><span>avg rating</span></div>
    <div class="strip-item best"><b>${best ? esc(best.title) : "—"}</b><span>club favourite</span></div>
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
  const grid = $("#moviesGrid");
  const ms = applyFilters(allMovies());
  $("#moviesEmpty").hidden = ms.length > 0;
  grid.innerHTML = ms.map(cardHTML).join("");
  grid.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEditor(Number(btn.dataset.edit)))
  );
  grid.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.del);
      const m = MOVIES[String(id)];
      if (confirm(`Delete "${m?.title}" (id ${id}) from the database?`)) deleteMovie(id);
    })
  );
  // lazy posters
  grid.querySelectorAll(".poster[data-wiki]").forEach(async (el) => {
    const url = await getPoster(el.dataset.wiki, el.dataset.manualPoster);
    el.style.backgroundImage = url ? `url("${url}")` : "";
    el.classList.toggle("ph", !url);
  });
}

function rateChips(rates) {
  return RATERS.map((r) => {
    const v = rates?.[r.key];
    if (!rated(v)) return `<span class="chip" style="--c:#3a4254;opacity:.55" title="${r.name}: not rated">${r.name[0]}—</span>`;
    const hue = v >= 8 ? "#90be6d" : v >= 6 ? "#f9a620" : v >= 4 ? "#ff7043" : "#e63946";
    return `<span class="chip" style="--c:${hue}" title="${r.name}: ${v}/10">${r.name[0]}${v}</span>`;
  }).join("");
}

function cardHTML(m) {
  const avg = avgRate(m.rates);
  const links = [];
  if (m.imdb) links.push(`<a href="${esc(m.imdb)}" target="_blank" rel="noopener" class="lnk imdb">IMDb</a>`);
  if (m.wiki) links.push(`<a href="${esc(m.wiki)}" target="_blank" rel="noopener" class="lnk wiki">Wiki</a>`);
  const manualPoster = m.poster ? esc(m.poster) : "";
  const wikiTitle = m.wiki ? m.wiki.split("/wiki/")[1] || "" : "";
  return `
  <article class="movie-card" data-id="${m.id}">
    <a class="poster ${wikiTitle ? "" : "ph"}" ${wikiTitle ? `data-wiki="${esc(decodeURIComponent(wikiTitle))}"` : ""}
       ${manualPoster ? `data-manual-poster="${manualPoster}"` : ""}
       href="${m.imdb ? esc(m.imdb) : m.wiki ? esc(m.wiki) : "#"}" target="_blank" rel="noopener">
      <span class="poster-fallback">🎬</span>
      <span class="year-badge">${esc(m.year || "—")}</span>
      <span class="season-badge">S·${esc(m.season || seasonFromDate(m.date) || "—")}</span>
    </a>
    <div class="card-body">
      <h3 class="title" title="${esc(m.titleEn || m.title)}">${esc(m.title)}</h3>
      <p class="orig">${esc(m.titleEn || "")}</p>
      <p class="meta">
        <span>${esc((m.country || "").split(",").map((c) => c.trim()).filter(Boolean)[0] || "—")}</span>
        ${m.director ? `<span class="dir">.dir ${esc((m.director || "").split(",")[0].trim())}</span>` : ""}
      </p>
      ${m.genre ? `<p class="genre">${esc(m.genre)}</p>` : ""}
      <div class="chips">${rateChips(m.rates)}</div>
      <div class="card-foot">
        <span class="avg" style="--h:${avg >= 8 ? 100 : avg >= 6 ? 40 : avg >= 4 ? 20 : 5}">${avg.toFixed(1)}</span>
        <span class="date">📅 ${esc(m.date || "—")}</span>
        <span class="spacer"></span>
        ${links.join("")}
        <button class="icon-btn" data-edit="${m.id}" title="Edit">✏️</button>
        <button class="icon-btn" data-del="${m.id}" title="Delete">🗑️</button>
      </div>
    </div>
  </article>`;
}

// ---------- posters from Wikipedia (auto) ----------
async function getPoster(wikiTitle, manual) {
  if (manual) return manual;
  if (!wikiTitle) return null;
  if (posterCache[wikiTitle] !== undefined) return posterCache[wikiTitle];
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}?redirect=true`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    let src = data?.originalimage?.source || data?.thumbnail?.source || null;
    // prefer a mid-size thumb (originals can be huge)
    if (src && data.thumbnail?.source) src = data.thumbnail.source.replace(/\/\d+px-/, "/500px-");
    posterCache[wikiTitle] = src;
    try { localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache)); } catch (e) {}
    return src;
  } catch (e) {
    posterCache[wikiTitle] = null;
    return null;
  }
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
  const m = movie || { title: "", titleEn: "", year: "", country: "", director: "", genre: "", date: new Date().toISOString().slice(0, 10), season: "", imdb: "", wiki: "", poster: "", rates: {} };
  container.innerHTML = `
    <div class="form-row">
      <div class="form-field grow"><label>Title (UA) *</label><input id="mTitle" required value="${esc(m.title)}"></div>
      <div class="form-field grow"><label>Original title</label><input id="mTitleEn" value="${esc(m.titleEn || "")}"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>Release year *</label><input id="mYear" type="number" min="1895" max="2100" required value="${esc(m.year)}"></div>
      <div class="form-field grow"><label>Country</label><input id="mCountry" value="${esc(m.country || "")}" list="countryList"></div>
      <div class="form-field"><label>Watched on *</label><input id="mDate" type="date" required value="${esc(m.date)}"></div>
    </div>
    <div class="form-row">
      <div class="form-field grow"><label>Director</label><input id="mDirector" value="${esc(m.director || "")}" list="directorList"></div>
      <div class="form-field grow"><label>Genre</label><input id="mGenre" value="${esc(m.genre || "")}" list="genreList"></div>
      <div class="form-field"><label>Season</label><input id="mSeason" value="${esc(m.season || "")}" placeholder="${esc(seasonFromDate(m.date))}"></div>
    </div>
    <div class="form-row rates-row">
      ${RATERS.map((r) => `
        <div class="form-field rate-field">
          <label style="color:${r.color}">${r.name}</label>
          <select data-rate="${r.key}">
            ${Array.from({ length: 11 }, (_, v) => `<option value="${v}" ${Number(m.rates?.[r.key] || 0) === v ? "selected" : ""}>${v === 0 ? "—" : v}</option>`).join("")}
          </select>
        </div>`).join("")}
    </div>
    <div class="form-row">
      <div class="form-field grow"><label>IMDb link</label><input id="mImdb" type="url" value="${esc(m.imdb || "")}"></div>
      <div class="form-field grow"><label>Wikipedia link</label><input id="mWiki" type="url" value="${esc(m.wiki || "")}"></div>
    </div>
    <div class="form-row">
      <div class="form-field grow"><label>Poster URL (auto if empty)</label><input id="mPoster" type="url" value="${esc(m.poster || "")}"></div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn primary" id="modalSave">💾 Save to Firebase</button>
      <button type="button" class="btn ghost" id="modalCancel">Cancel</button>
    </div>`;

  container.querySelector("#modalSave").addEventListener("click", () => collectAndSave(movie?.id));
  container.querySelector("#modalCancel").addEventListener("click", closeEditor);
}

function collectData(id) {
  const get = (s) => $(s)?.value.trim() || "";
  const date = get("#mDate");
  return {
    id: Number(id),
    title: get("#mTitle"),
    titleEn: get("#mTitleEn"),
    year: Number(get("#mYear")) || null,
    country: get("#mCountry"),
    director: get("#mDirector"),
    genre: get("#mGenre"),
    date,
    season: get("#mSeason") || seasonFromDate(date),
    imdb: get("#mImdb"),
    wiki: get("#mWiki"),
    poster: get("#mPoster"),
    rates: currentRatesFromInputs(),
  };
}

function collectAndSave(existingId) {
  const modal = $("#editModal");
  const id = modal.hidden ? Number($("#mId").value) : existingId;
  const data = modal.hidden ? collectData(id) : collectDataFromModal(id);
  if (!data.title || !data.year || !data.date) { toast("Title, release year and watch date are required", "warn"); return; }
  saveMovie(data);
  closeEditor();
}

// collect from the edit modal (ids duplicated → scope to modal)
function collectDataFromModal(id) {
  const scope = $("#editModalBody");
  const get = (s) => scope.querySelector(s)?.value.trim() || "";
  const date = get("#mDate");
  return {
    id: Number(id),
    title: get("#mTitle"),
    titleEn: get("#mTitleEn"),
    year: Number(get("#mYear")) || null,
    country: get("#mCountry"),
    director: get("#mDirector"),
    genre: get("#mGenre"),
    date,
    season: get("#mSeason") || seasonFromDate(date),
    imdb: get("#mImdb"),
    wiki: get("#mWiki"),
    poster: get("#mPoster"),
    rates: currentRatesFromInputs(scope),
  };
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
  $("#resetFilters").addEventListener("click", () => {
    FILTERS = { q: "", season: "", decade: "", country: "", director: "", sort: "date-desc" };
    $("#fSearch").value = ""; $("#fSeason").value = ""; $("#fDecade").value = "";
    $("#fCountry").value = ""; $("#fDirector").value = ""; $("#fSort").value = "date-desc";
    renderMovies();
  });

  // admin add form
  $("#movieForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = collectData(Number($("#mId").value) || nextFreeId());
    saveMovie(data);
    e.target.reset();
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });
  $("#clearFormBtn").addEventListener("click", () => {
    $("#movieForm").reset();
    $("#mId").value = "";
    $("#mDate").value = new Date().toISOString().slice(0, 10);
    buildRatesRow();
  });

  // tools
  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importFile").addEventListener("change", importJSON);
  $("#seedBtn").addEventListener("click", () => {
    if (confirm("Restore the built-in seed dataset (53 movies) to Firebase? Current Firebase content will be overwritten.")) seedFirebase(true);
  });

  // modal
  $("#closeModalBtn").addEventListener("click", closeEditor);
  $("#editModal").addEventListener("click", (e) => { if (e.target === $("#editModal")) closeEditor(); });
}

function nextFreeId() {
  const ids = Object.keys(MOVIES).map(Number);
  return (ids.length ? Math.max(...ids) : 2) + 1;
}

function buildRatesRow() {
  $("#ratesRow").innerHTML = RATERS.map((r) => `
    <div class="form-field rate-field">
      <label style="color:${r.color}">${r.name}</label>
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
  toast("⬇️ Backup downloaded");
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
    toast("⬆️ Backup imported into Firebase");
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

  buildRatesRow();
  $("#mDate").value = new Date().toISOString().slice(0, 10);
  bindEvents();
  renderAll();
  initSync();
})();
