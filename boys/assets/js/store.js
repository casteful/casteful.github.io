/* Кінобаза — data layer: state, persistence, computations, import/export */
(function () {
  'use strict';
  window.MB = window.MB || {};

  var LS_DATA = 'mb_data_v2';
  var LS_PREFS = 'mb_prefs_v2';
  var LS_GH = 'mb_gh_v2';
  var LS_UNSYNCED = 'mb_unsynced_v2';

  var REVIEWER_KEYS = ['dima', 'deni', 'yura', 'ihor'];

  var state = {
    data: null,        /* { name, version, updatedAt, reviewers, movies } */
    source: null,      /* 'file' | 'local' | 'seed' */
    unsynced: false,   /* local edits not committed to GitHub */
    lang: 'uk',
    theme: 'dark',
    view: 'auto',      /* 'auto' | 'table' | 'cards' */
    search: '',
    sort: 'date_desc',
    reviewer: 'all',
    editingId: null    /* movie being edited (null = new) */
  };

  function nowISO() { return new Date().toISOString(); }
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* ---------- persistence ---------- */
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_PREFS) || '{}');
      if (p.theme === 'dark' || p.theme === 'light') state.theme = p.theme;
      if (p.lang === 'uk' || p.lang === 'en') state.lang = p.lang;
      if (p.view === 'auto' || p.view === 'table' || p.view === 'cards') state.view = p.view;
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify({ theme: state.theme, lang: state.lang, view: state.view }));
    } catch (e) { /* ignore */ }
  }
  function loadLocalData() {
    try { return JSON.parse(localStorage.getItem(LS_DATA) || 'null'); }
    catch (e) { return null; }
  }
  function persistData() {
    state.data.updatedAt = nowISO();
    try {
      localStorage.setItem(LS_DATA, JSON.stringify(state.data));
      localStorage.setItem(LS_UNSYNCED, '1');
    } catch (e) { /* storage full / private mode */ }
    state.source = 'local';
    state.unsynced = true;
  }
  function clearLocalData() {
    try {
      localStorage.removeItem(LS_DATA);
      localStorage.removeItem(LS_UNSYNCED);
    } catch (e) { /* ignore */ }
  }
  function markSynced() {
    state.unsynced = false;
    try { localStorage.setItem(LS_UNSYNCED, '0'); } catch (e) { /* ignore */ }
  }
  function loadGhCfg() {
    try { return JSON.parse(localStorage.getItem(LS_GH) || '{}'); }
    catch (e) { return {}; }
  }
  function saveGhCfg(cfg) {
    try { localStorage.setItem(LS_GH, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  /* ---------- data selection ---------- */
  /* Choose the freshest source: fetched file vs local edits vs built-in seed */
  function pickData(fetched, local, seed) {
    var cands = [];
    if (fetched && Array.isArray(fetched.movies)) cands.push({ src: 'file', d: fetched });
    if (local && Array.isArray(local.movies)) cands.push({ src: 'local', d: local });
    if (seed && Array.isArray(seed.movies)) cands.push({ src: 'seed', d: seed });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      return String(b.d.updatedAt || '').localeCompare(String(a.d.updatedAt || ''));
    });
    return cands[0];
  }

  function reviewerKeys(data) {
    if (data && data.reviewers && data.reviewers.length) {
      return data.reviewers.map(function (r) { return r.key; });
    }
    return REVIEWER_KEYS.slice();
  }
  function reviewerNames(data) {
    var map = {};
    (data && data.reviewers || []).forEach(function (r) { map[r.key] = r.name || r.key; });
    REVIEWER_KEYS.forEach(function (k) { if (!map[k]) map[k] = k; });
    return map;
  }

  /* ---------- computations ---------- */
  function movieAvg(m) {
    var vals = REVIEWER_KEYS.map(function (k) { return m[k + '_rate'] || 0; }).filter(function (v) { return v > 0; });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function computeStats(data) {
    var movies = data.movies || [];
    var keys = reviewerKeys(data);
    var perReviewer = keys.map(function (k) {
      var rated = movies.filter(function (m) { return (m[k + '_rate'] || 0) > 0; });
      var avg = rated.length
        ? rated.reduce(function (s, m) { return s + m[k + '_rate']; }, 0) / rated.length
        : null;
      return { key: k, rated: rated.length, avg: avg };
    });
    var avgs = movies.map(movieAvg).filter(function (a) { return a != null; });
    var totalRatings = 0;
    movies.forEach(function (m) {
      REVIEWER_KEYS.forEach(function (k) { if ((m[k + '_rate'] || 0) > 0) totalRatings++; });
    });
    var best = null, bestAvg = -1;
    movies.forEach(function (m) {
      var a = movieAvg(m);
      if (a != null && a > bestAvg) { bestAvg = a; best = m; }
    });
    var dates = movies.map(function (m) { return m.date_created || ''; }).filter(Boolean).sort();
    /* distribution buckets 1..10 by rounded average */
    var dist = {};
    avgs.forEach(function (a) {
      var b = Math.min(10, Math.max(1, Math.round(a)));
      dist[b] = (dist[b] || 0) + 1;
    });
    return {
      count: movies.length,
      totalRatings: totalRatings,
      overallAvg: avgs.length ? avgs.reduce(function (a, b) { return a + b; }, 0) / avgs.length : null,
      best: best ? { title: best.title, avg: bestAvg } : null,
      spanFrom: dates.length ? dates[0] : null,
      spanTo: dates.length ? dates[dates.length - 1] : null,
      perReviewer: perReviewer,
      dist: dist
    };
  }

  /* ---------- mutations ---------- */
  function nextId(data) {
    return data.movies.reduce(function (mx, m) { return Math.max(mx, m.id || 0); }, 0) + 1;
  }
  function upsertMovie(data, movie) {
    var i = data.movies.findIndex(function (m) { return m.id === movie.id; });
    if (i >= 0) data.movies[i] = movie; else data.movies.push(movie);
    data.movies.sort(function (a, b) {
      return String(b.date_created || '').localeCompare(String(a.date_created || '')) || (b.id - a.id);
    });
  }
  function deleteMovie(data, id) {
    data.movies = data.movies.filter(function (m) { return m.id !== id; });
  }

  function normalizeMovie(raw) {
    var m = {
      id: parseInt(raw.id, 10) || 0,
      title: String(raw.title || '').trim()
    };
    REVIEWER_KEYS.forEach(function (k) {
      var v = parseInt(raw[k + '_rate'], 10);
      m[k + '_rate'] = isNaN(v) ? 0 : Math.min(10, Math.max(0, v));
    });
    m.date_created = String(raw.date_created || '').slice(0, 10) || '';
    return m;
  }

  /* ---------- import ---------- */
  function importJSON(text, mode) {
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new Error('invalid'); }
    if (!obj || !Array.isArray(obj.movies)) throw new Error('invalid');
    var imported = obj.movies.map(normalizeMovie).filter(function (m) { return m.title; });
    if (!imported.length) throw new Error('invalid');

    if (mode === 'replace') {
      state.data.movies = imported;
      if (obj.reviewers) state.data.reviewers = obj.reviewers;
    } else { /* merge by id */
      imported.forEach(function (im) {
        var i = state.data.movies.findIndex(function (m) { return m.id === im.id; });
        if (i >= 0) state.data.movies[i] = im; else state.data.movies.push(im);
      });
    }
    state.data.movies.sort(function (a, b) { return b.id - a.id; });
    return imported.length;
  }

  /* ---------- export ---------- */
  function exportJSONText() {
    return JSON.stringify(state.data, null, 2) + '\n';
  }
  function csvEscape(s) {
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function exportCSVText() {
    var head = ['id', 'title'].concat(REVIEWER_KEYS.map(function (k) { return k + '_rate'; })).concat(['date_created']);
    var lines = [head.join(',')];
    state.data.movies.forEach(function (m) {
      var row = [m.id, csvEscape(m.title)];
      REVIEWER_KEYS.forEach(function (k) { row.push(m[k + '_rate'] || 0); });
      row.push(m.date_created || '');
      lines.push(row.join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 400);
  }
  function stamp() { return todayISO(); }

  window.MB.store = {
    state: state,
    REVIEWER_KEYS: REVIEWER_KEYS,
    LS_DATA: LS_DATA, LS_GH: LS_GH,
    nowISO: nowISO, todayISO: todayISO,
    loadPrefs: loadPrefs, savePrefs: savePrefs,
    loadLocalData: loadLocalData, persistData: persistData,
    clearLocalData: clearLocalData, markSynced: markSynced,
    loadGhCfg: loadGhCfg, saveGhCfg: saveGhCfg,
    pickData: pickData,
    reviewerKeys: reviewerKeys, reviewerNames: reviewerNames,
    movieAvg: movieAvg, computeStats: computeStats,
    nextId: nextId, upsertMovie: upsertMovie, deleteMovie: deleteMovie,
    normalizeMovie: normalizeMovie,
    importJSON: importJSON,
    exportJSONText: exportJSONText, exportCSVText: exportCSVText,
    download: download, stamp: stamp
  };
})();
