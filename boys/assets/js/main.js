/* Кінобаза — main controller: boot, events, modals, editor, sync UI */
(function () {
  'use strict';
  var MB = window.MB;
  var store = MB.store;
  var state = store.state;
  var t = MB.t;
  var $ = function (id) { return document.getElementById(id); };

  /* ================= i18n apply ================= */
  MB.applyI18n = function () {
    document.documentElement.lang = state.lang;
    document.title = t('appTitle') + ' — ' + t('tagline');
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    $('themeToggle').innerHTML = MB.icon(state.theme === 'dark' ? 'sun' : 'moon');
    $('themeToggle').setAttribute('aria-label', state.theme === 'dark' ? 'Light theme' : 'Dark theme');
    $('viewTableBtn').innerHTML = MB.icon('list');
    $('viewCardsBtn').innerHTML = MB.icon('grid');
    $('viewTableBtn').title = t('viewTable');
    $('viewCardsBtn').title = t('viewCards');
    $('langUa').classList.toggle('active', state.lang === 'uk');
    $('langEn').classList.toggle('active', state.lang === 'en');
    $('brandLogo').innerHTML = MB.icon('clapper', 22);
    $('searchIcon').innerHTML = MB.icon('search');
    $('dataBtnIcon').innerHTML = MB.icon('database');
    $('addBtnIcon').innerHTML = MB.icon('plus');
    $('movieModalClose').innerHTML = MB.icon('x');
    $('dataModalClose').innerHTML = MB.icon('x');
    $('delBtnIcon').innerHTML = MB.icon('trash');
    $('resetBtnIcon').innerHTML = MB.icon('reset');
    $('expJsonIcon').innerHTML = MB.icon('download');
    $('expCsvIcon').innerHTML = MB.icon('download');
    $('impIcon').innerHTML = MB.icon('upload');
    $('ghSaveIcon').innerHTML = MB.icon('github');
    $('searchInput').setAttribute('aria-label', t('searchPlaceholder'));
  };

  MB.updateUnsyncedDot = function () {
    $('unsyncedDot').hidden = !state.unsynced;
  };

  /* ================= toasts ================= */
  function toast(msg, type) {
    var host = $('toastHost');
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'err' ? ' err' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 2800);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* ================= modals ================= */
  var OPEN_CLASS = 'open';
  function openModal(el) { el.hidden = false; }
  function closeModal(el) { el.hidden = true; }

  document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
    bd.addEventListener('mousedown', function (e) {
      if (e.target === bd) closeModal(bd);
    });
  });
  document.querySelectorAll('[id$="ModalClose"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeModal(btn.closest('.modal-backdrop'));
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    ['confirmModal', 'movieModal', 'dataModal'].some(function (id) {
      var el = $(id);
      if (!el.hidden) { closeModal(el); return true; }
      return false;
    });
  });

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var bd = $('confirmModal');
      $('confirmTitle').textContent = opts.title;
      $('confirmBody').textContent = opts.body;
      $('confirmYes').textContent = opts.yes;
      $('confirmNo').textContent = opts.no;
      openModal(bd);
      function done(v) {
        closeModal(bd);
        $('confirmYes').removeEventListener('click', onYes);
        $('confirmNo').removeEventListener('click', onNo);
        resolve(v);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      $('confirmYes').addEventListener('click', onYes);
      $('confirmNo').addEventListener('click', onNo);
    });
  }

  /* ================= editor modal ================= */
  function rateRowHTML(key, name, color, rate) {
    var seen = rate > 0;
    return '<div class="rate-row" style="--rc:' + color + '" data-key="' + key + '">' +
      '<span class="rev-dot"></span>' +
      '<label class="rate-seen"><input type="checkbox" class="seen-cb"' + (seen ? ' checked' : '') + '><span>' + MB.render.esc(name) + '</span></label>' +
      '<input type="range" class="rate-range" min="1" max="10" value="' + (seen ? rate : 5) + '"' + (seen ? '' : ' disabled') + '>' +
      '<output class="rate-val' + (seen ? '' : ' zero') + '">' + (seen ? rate : '—') + '</output></div>';
  }

  function buildRateRows(movie) {
    var d = state.data;
    var names = store.reviewerNames(d);
    $('rateRows').innerHTML = store.REVIEWER_KEYS.map(function (k) {
      var rate = movie ? (movie[k + '_rate'] || 0) : 0;
      return rateRowHTML(k, names[k], MB.REVIEWER_COLORS[k] || 'var(--accent)', rate);
    }).join('');
  }

  function openEditor(movie) {
    state.editingId = movie ? movie.id : null;
    $('movieModalTitle').textContent = movie ? t('editMovie') : t('newMovie');
    $('movieTitle').value = movie ? movie.title : '';
    $('movieDate').value = movie && movie.date_created ? movie.date_created : store.todayISO();
    $('titleErr').hidden = true;
    $('movieDeleteBtn').hidden = !movie;
    buildRateRows(movie);
    openModal($('movieModal'));
    setTimeout(function () { $('movieTitle').focus(); }, 60);
  }

  function collectEditor() {
    var movie = {
      id: state.editingId != null ? state.editingId : store.nextId(state.data),
      title: $('movieTitle').value.trim(),
      date_created: $('movieDate').value || store.todayISO()
    };
    document.querySelectorAll('#rateRows .rate-row').forEach(function (row) {
      var key = row.getAttribute('data-key');
      var seen = row.querySelector('.seen-cb').checked;
      movie[key + '_rate'] = seen ? parseInt(row.querySelector('.rate-range').value, 10) : 0;
    });
    return movie;
  }

  $('movieForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var movie = collectEditor();
    if (!movie.title) { $('titleErr').hidden = false; $('movieTitle').focus(); return; }
    store.upsertMovie(state.data, movie);
    store.persistData();
    closeModal($('movieModal'));
    MB.render.renderAll();
    toast(t('savedLocal'));
  });
  $('movieCancelBtn').addEventListener('click', function () { closeModal($('movieModal')); });
  $('movieDeleteBtn').addEventListener('click', async function () {
    var m = state.data.movies.find(function (x) { return x.id === state.editingId; });
    if (!m) return;
    var ok = await confirmDialog({
      title: t('confirmDeleteTitle'),
      body: t('confirmDeleteBody', { title: m.title }),
      yes: t('deleteBtn'), no: t('cancel')
    });
    if (!ok) return;
    store.deleteMovie(state.data, state.editingId);
    store.persistData();
    closeModal($('movieModal'));
    MB.render.renderAll();
    toast(t('deleted'));
  });
  $('addBtn').addEventListener('click', function () { openEditor(null); });

  /* rating row interactions */
  $('rateRows').addEventListener('input', function (e) {
    if (e.target.classList.contains('rate-range')) {
      var out = e.target.parentElement.querySelector('.rate-val');
      out.textContent = e.target.value;
      out.classList.remove('zero');
    }
  });
  $('rateRows').addEventListener('change', function (e) {
    if (!e.target.classList.contains('seen-cb')) return;
    var row = e.target.closest('.rate-row');
    var range = row.querySelector('.rate-range');
    var out = row.querySelector('.rate-val');
    range.disabled = !e.target.checked;
    if (e.target.checked) { out.textContent = range.value; out.classList.remove('zero'); }
    else { out.textContent = '—'; out.classList.add('zero'); }
  });

  /* ================= data modal ================= */
  function sourceBadge() {
    var b = $('dataSource');
    if (state.source === 'local') { b.textContent = t('sourceLocal'); b.className = 'badge warn'; }
    else if (state.source === 'file') { b.textContent = t('sourceFile'); b.className = 'badge ok'; }
    else { b.textContent = t('sourceSeed'); b.className = 'badge accent'; }
  }
  function syncBadge() {
    var b = $('dataSynced');
    if (state.unsynced) { b.textContent = t('syncedNo'); b.className = 'badge warn'; }
    else { b.textContent = t('syncedYes'); b.className = 'badge ok'; }
  }
  function refreshDataModal() {
    sourceBadge();
    syncBadge();
    $('dataUpdated').textContent = state.data && state.data.updatedAt
      ? MB.render.fmtDate(String(state.data.updatedAt).slice(0, 10)) + ' ' + String(state.data.updatedAt).slice(11, 16)
      : '—';
    fillGhForm();
  }

  $('dataBtn').addEventListener('click', function () { refreshDataModal(); openModal($('dataModal')); });

  /* export / import */
  $('exportJsonBtn').addEventListener('click', function () {
    store.download('movie-base-' + store.stamp() + '.json', store.exportJSONText(), 'application/json;charset=utf-8');
  });
  $('exportCsvBtn').addEventListener('click', function () {
    store.download('movie-base-' + store.stamp() + '.csv', store.exportCSVText(), 'text/csv;charset=utf-8');
  });
  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var mode = document.querySelector('input[name="importMode"]:checked').value;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var n = store.importJSON(String(reader.result), mode);
        store.persistData();
        MB.render.renderAll();
        refreshDataModal();
        toast(t('imported', { n: n }));
      } catch (e) {
        toast(t('errInvalidJson'), 'err');
      }
    };
    reader.readAsText(file, 'utf-8');
  });
  $('resetLocalBtn').addEventListener('click', async function () {
    var ok = await confirmDialog({
      title: t('resetConfirmTitle'), body: t('resetConfirmBody'),
      yes: t('resetLocal'), no: t('cancel')
    });
    if (!ok) return;
    store.clearLocalData();
    location.reload();
  });

  /* ================= GitHub sync UI ================= */
  function fillGhForm() {
    var cfg = store.loadGhCfg();
    if (!cfg.owner) {
      var s = MB.github.suggestCfg();
      if (s) cfg = Object.assign(cfg, s);
    }
    $('ghOwner').value = cfg.owner || '';
    $('ghRepo').value = cfg.repo || '';
    $('ghBranch').value = cfg.branch || 'main';
    $('ghPath').value = cfg.path || 'data/movies.json';
    $('ghToken').value = cfg.token || '';
    $('ghMsg').value = cfg.msg || '';
  }
  function readGhForm() {
    var cfg = {
      owner: $('ghOwner').value.trim(),
      repo: $('ghRepo').value.trim(),
      branch: $('ghBranch').value.trim() || 'main',
      path: $('ghPath').value.trim().replace(/^\/+/, ''),
      token: $('ghToken').value.trim(),
      msg: $('ghMsg').value.trim()
    };
    store.saveGhCfg(cfg);
    return cfg;
  }
  function ghStatus(msg, cls) {
    var el = $('ghStatus');
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'gh-status' + (cls ? ' ' + cls : '');
  }

  $('ghTestBtn').addEventListener('click', async function () {
    var cfg = readGhForm();
    if (!cfg.owner || !cfg.repo || !cfg.path || !cfg.token) {
      ghStatus(t('errGeneric', { msg: 'owner / repo / path / token' }), 'err');
      return;
    }
    ghStatus(t('ghTesting'), 'busy');
    try {
      var r = await MB.github.ghTest(cfg);
      ghStatus(t('ghOk', {
        date: r.commit && r.commit.date ? r.commit.date.slice(0, 10) : '—',
        msg: r.commit && r.commit.msg ? r.commit.msg.slice(0, 60) : ''
      }), 'ok');
    } catch (e) {
      ghStatus(t('errGeneric', { msg: e.message }), 'err');
    }
  });

  $('ghSaveBtn').addEventListener('click', async function () {
    var cfg = readGhForm();
    if (!cfg.owner || !cfg.repo || !cfg.path || !cfg.token) {
      ghStatus(t('errGeneric', { msg: 'owner / repo / path / token' }), 'err');
      return;
    }
    var btn = this;
    btn.disabled = true;
    ghStatus(t('ghSaving'), 'busy');
    try {
      var msg = cfg.msg || t('ghCommitDefault', { n: state.data.movies.length });
      await MB.github.ghPut(cfg, store.exportJSONText(), msg);
      store.markSynced();
      MB.updateUnsyncedDot();
      syncBadge();
      ghStatus(t('ghSaved'), 'ok');
      toast(t('ghSaved'));
    } catch (e) {
      ghStatus(t('errGeneric', { msg: e.message }), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ================= toolbar events ================= */
  var searchTimer = null;
  $('searchInput').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var v = this.value;
    searchTimer = setTimeout(function () {
      state.search = v;
      MB.render.renderList();
    }, 130);
  });
  $('reviewerFilter').addEventListener('change', function () {
    state.reviewer = this.value;
    MB.render.renderList();
  });
  $('sortSelect').addEventListener('change', function () {
    state.sort = this.value;
    MB.render.renderList();
  });
  $('viewTableBtn').addEventListener('click', function () { setView('table'); });
  $('viewCardsBtn').addEventListener('click', function () { setView('cards'); });
  function setView(v) {
    state.view = v;
    store.savePrefs();
    MB.render.renderToolbar();
    MB.render.renderList();
  }
  window.matchMedia('(max-width: 720px)').addEventListener('change', function () {
    if (state.view === 'auto') { MB.render.renderToolbar(); MB.render.renderList(); }
  });

  /* sort by clicking table headers + row actions (delegated) */
  $('listWrap').addEventListener('click', function (e) {
    var th = e.target.closest('th.sortable');
    if (th) {
      var col = th.getAttribute('data-sortcol');
      var m = state.sort.match(/^([a-z]+)_(asc|desc)$/);
      var dir;
      if (m && m[1] === col) dir = m[2] === 'asc' ? 'desc' : 'asc';
      else dir = (col === 'title') ? 'asc' : 'desc';
      state.sort = col + '_' + dir;
      MB.render.renderToolbar();
      MB.render.renderList();
      return;
    }
    var editBtn = e.target.closest('.act-edit');
    if (editBtn) {
      var id = parseInt(editBtn.closest('[data-id]').getAttribute('data-id'), 10);
      var mov = state.data.movies.find(function (x) { return x.id === id; });
      if (mov) openEditor(mov);
      return;
    }
    var delBtn = e.target.closest('.act-del');
    if (delBtn) {
      var id2 = parseInt(delBtn.closest('[data-id]').getAttribute('data-id'), 10);
      var mov2 = state.data.movies.find(function (x) { return x.id === id2; });
      if (!mov2) return;
      confirmDialog({
        title: t('confirmDeleteTitle'),
        body: t('confirmDeleteBody', { title: mov2.title }),
        yes: t('deleteBtn'), no: t('cancel')
      }).then(function (ok) {
        if (!ok) return;
        store.deleteMovie(state.data, id2);
        store.persistData();
        MB.render.renderAll();
        toast(t('deleted'));
      });
    }
  });

  /* ================= theme / language ================= */
  $('themeToggle').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    store.savePrefs();
    MB.applyI18n();
  });
  $('langUa').addEventListener('click', function () { setLang('uk'); });
  $('langEn').addEventListener('click', function () { setLang('en'); });
  function setLang(lang) {
    if (state.lang === lang) return;
    state.lang = lang;
    store.savePrefs();
    MB.render.renderAll();
    if (!$('dataModal').hidden) refreshDataModal();
  }

  /* ================= boot ================= */
  async function boot() {
    store.loadPrefs();
    document.documentElement.dataset.theme = state.theme;

    var seed = null;
    try { seed = JSON.parse($('seed-data').textContent || 'null'); }
    catch (e) { seed = null; }

    var fetched = null;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        var res = await fetch('data/movies.json', { cache: 'no-store' });
        if (res.ok) fetched = await res.json();
      } catch (e) { fetched = null; }
    }

    var local = store.loadLocalData();
    var pick = store.pickData(fetched, local, seed);
    if (pick) {
      state.data = pick.d;
      state.source = pick.src;
    } else {
      state.data = { name: 'movie_base', version: 2, updatedAt: store.nowISO(), reviewers: [], movies: [] };
      state.source = 'seed';
    }
    state.unsynced = state.source === 'local' &&
      (function () { try { return localStorage.getItem('mb_unsynced_v2') === '1'; } catch (e) { return false; } })();

    MB.applyI18n();
    MB.render.renderAll();

    if (state.source === 'seed') {
      var banner = $('sourceBanner');
      banner.innerHTML = MB.icon('alert', 16) + '<span></span>';
      banner.querySelector('span').textContent = t('sourceBannerSeed');
      banner.hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
