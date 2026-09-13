/* Кінобаза — Firebase Realtime Database sync (Google Cloud)
   Loads the compat SDK lazily from gstatic CDN; classic script, no bundler.
   Exposes window.MB.firebase */
(function () {
  'use strict';
  window.MB = window.MB || {};

  /* --- embedded project config (Firebase console → Project settings) --- */
  var CFG = {
    apiKey: "AIzaSyBK0qldiTkHjz6d8piyyo6m1lga8gQiNqQ",
    authDomain: "movies-93171.firebaseapp.com",
    databaseURL: "https://movies-93171-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "movies-93171",
    storageBucket: "movies-93171.firebasestorage.app",
    messagingSenderId: "510149400763",
    appId: "1:510149400763:web:485fc82054574f875df19e",
    measurementId: "G-0LK3ZDJ2S6"
  };
  var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  var LS_FB = 'mb_fb_v2';
  var DEFAULT_PATH = 'movie_base';

  var store = window.MB.store;
  var prefs = { autoPush: false, live: false, path: DEFAULT_PATH };
  var app = null, db = null, ref = null, listening = false;
  var status = 'off';           /* off | loading | ready | error */
  var statusMsg = '';
  var pushTimer = null, pushing = false;
  var onChange = null;          /* cb(status, msg) */
  var onRemote = null;          /* cb(dataset) — fresher cloud data arrived */
  var onLocalSaved = null;      /* cb() — wrapped persistData fired */

  /* ---------- prefs ---------- */
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_FB) || '{}');
      prefs.autoPush = !!p.autoPush;
      prefs.live = !!p.live;
      prefs.path = (typeof p.path === 'string' && p.path.trim().replace(/^\/+|\/+$/g, '')) || DEFAULT_PATH;
    } catch (e) { /* defaults */ }
  }
  function savePrefs() {
    try { localStorage.setItem(LS_FB, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  function setStatus(s, msg) {
    status = s;
    statusMsg = msg || '';
    if (onChange) onChange(status, statusMsg);
  }

  /* ---------- SDK loading ---------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error('timeout loading ' + src)); }, 15000);
    });
  }

  var initPromise = null;
  function ensureInit() {
    if (initPromise) return initPromise;
    setStatus('loading');
    initPromise = (async function () {
      if (typeof firebase === 'undefined') {
        await loadScript(SDK + 'firebase-app-compat.js');
        await loadScript(SDK + 'firebase-database-compat.js');
      }
      if (!app) {
        app = firebase.initializeApp(CFG);
        db = firebase.database();
      }
      setStatus('ready');
      /* analytics: optional, only in hosted (http/https) context */
      if (/^https?:$/.test(location.protocol) && !app.__analyticsTried) {
        app.__analyticsTried = true;
        loadScript(SDK + 'firebase-analytics-compat.js').then(function () {
          try { firebase.analytics(); } catch (e) { /* blocked / no consent — fine */ }
        }).catch(function () { /* offline — fine */ });
      }
    })().catch(function (e) {
      initPromise = null;
      setStatus('error', e && e.message ? e.message : String(e));
      throw e;
    });
    return initPromise;
  }

  /* ---------- data conversion ---------- */
  function dsTime(raw) {
    if (!raw) return 0;
    if (typeof raw.updatedAtMs === 'number') return raw.updatedAtMs;
    return Date.parse(raw.updatedAt) || 0;
  }
  function localTime() { return Date.parse(store.state.data.updatedAt) || 0; }

  function toDataset(raw) {
    if (!raw || !raw.movies || typeof raw.movies !== 'object') return null;
    var movies = [];
    Object.keys(raw.movies).forEach(function (k) {
      var m = raw.movies[k];
      if (!m || !m.title) return;
      if (m.id == null) m.id = parseInt(k, 10) || 0;
      movies.push(store.normalizeMovie(m));
    });
    if (!movies.length) return null;
    movies.sort(function (a, b) { return b.id - a.id; });
    return {
      name: raw.name || 'movie_base',
      version: raw.version || 2,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      updatedAtMs: typeof raw.updatedAtMs === 'number' ? raw.updatedAtMs : undefined,
      reviewers: Array.isArray(raw.reviewers) ? raw.reviewers : [],
      movies: movies
    };
  }

  function toRemotePayload() {
    var d = store.state.data;
    var movies = {};
    d.movies.forEach(function (m) { movies[String(m.id)] = m; });
    return {
      name: d.name || 'movie_base',
      version: d.version || 2,
      updatedAt: new Date().toISOString(),
      updatedAtMs: firebase.database.ServerValue.TIMESTAMP,
      reviewers: d.reviewers || [],
      movies: movies,
      meta: { movies: d.movies.length }
    };
  }

  function currentRef() {
    return db.ref(prefs.path);
  }

  /* ---------- operations ---------- */
  async function push() {
    await ensureInit();
    pushing = true;
    setStatus('loading', 'push');
    try {
      await currentRef().set(toRemotePayload());
      store.markSynced();
      setStatus('ready');
      return true;
    } catch (e) {
      setStatus('error', fbErrMsg(e));
      throw e;
    } finally {
      pushing = false;
    }
  }

  async function pull() {
    await ensureInit();
    setStatus('loading', 'pull');
    try {
      var snap = await currentRef().get();
      var ds = toDataset(snap.val());
      setStatus('ready');
      return ds;
    } catch (e) {
      setStatus('error', fbErrMsg(e));
      throw e;
    }
  }

  async function test() {
    await ensureInit();
    var snap = await currentRef().get();
    return { exists: snap.exists(), val: snap.val() };
  }

  function fbErrMsg(e) {
    var code = e && e.code || '';
    if (code.indexOf('permission_denied') >= 0) return 'permission_denied (check Realtime Database rules)';
    return (e && e.message) ? e.message : String(e);
  }

  /* ---------- auto-push (debounced, after every local save) ---------- */
  function scheduleAutoPush() {
    if (!prefs.autoPush) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      push().then(function () { if (onLocalSaved) onLocalSaved(); })
        .catch(function () { /* status already set */ });
    }, 1600);
  }

  /* wrap persistData so every local edit reaches the cloud when enabled */
  var persistWrapped = false;
  function wrapPersist() {
    if (persistWrapped) return;
    persistWrapped = true;
    var orig = store.persistData;
    store.persistData = function () {
      orig();
      if (onLocalSaved) onLocalSaved();
      scheduleAutoPush();
    };
  }

  /* ---------- live listener ---------- */
  var listenRef = null;
  function attachListener() {
    if (listening || !db) return;
    listening = true;
    listenRef = currentRef();
    listenRef.on('value', function (snap) {
      var raw = snap.val();
      if (!raw) return;
      var remote = toDataset(raw);
      if (!remote) return;
      var localMovies = store.state.data.movies;
      if (JSON.stringify(remote.movies) === JSON.stringify(localMovies)) return; /* echo */
      if (dsTime(raw) >= localTime() && !pushing) {
        if (onRemote) onRemote(remote);
      } else if (prefs.autoPush) {
        scheduleAutoPush(); /* remote is older — push local up */
      }
    }, function (err) {
      setStatus('error', fbErrMsg(err));
    });
  }
  function detachListener() {
    if (!listening || !listenRef) return;
    listening = false;
    listenRef.off('value');
    listenRef = null;
  }

  function applyAuto() {
    wrapPersist();
    if (prefs.live) { if (db) attachListener(); }
    else detachListener();
  }

  /* boot: connect only when some feature is enabled */
  async function autoBoot() {
    loadPrefs();
    if (!prefs.autoPush && !prefs.live) return;
    wrapPersist();
    try {
      await ensureInit();
      var ds = await pull();
      if (ds && dsTime({ updatedAtMs: ds.updatedAtMs, updatedAt: ds.updatedAt }) > localTime()) {
        if (onRemote) onRemote(ds);
      } else if (prefs.autoPush) {
        scheduleAutoPush();
      }
      applyAuto();
    } catch (e) { /* status already set */ }
  }

  window.MB.firebase = {
    get status() { return status; },
    get statusMsg() { return statusMsg; },
    prefs: prefs,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    ensureInit: ensureInit,
    push: push,
    pull: pull,
    test: test,
    applyAuto: applyAuto,
    autoBoot: autoBoot,
    dsTime: dsTime,
    localMs: localTime,
    set onChange(cb) { onChange = cb; if (onChange) onChange(status, statusMsg); },
    set onRemote(cb) { onRemote = cb; },
    set onLocalSaved(cb) { onLocalSaved = cb; },
    DEFAULT_PATH: DEFAULT_PATH
  };
})();
