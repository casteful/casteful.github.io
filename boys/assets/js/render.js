/* Кінобаза — rendering: stats, distribution chart, table & cards views */
(function () {
  'use strict';
  var MB = window.MB;
  var store = MB.store;
  var state = store.state;
  var t = MB.t;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    try {
      return d.toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'uk-UA');
    } catch (e) { return iso; }
  }
  function fmtNum(x) {
    if (x == null) return '—';
    try {
      return x.toLocaleString(state.lang === 'en' ? 'en-US' : 'uk-UA', { maximumFractionDigits: 1 });
    } catch (e) { return String(Math.round(x * 10) / 10); }
  }
  function rateClass(v) {
    if (!v || v <= 0) return 'r0';
    if (v <= 4) return 'r1';
    if (v <= 6) return 'r2';
    if (v <= 8) return 'r3';
    return 'r4';
  }
  function avgClass(a) {
    if (a == null) return 'p0';
    if (a < 4.5) return 'p1';
    if (a < 6.5) return 'p2';
    if (a < 8.5) return 'p3';
    return 'p4';
  }

  /* ---------- header meta / footer ---------- */
  function renderBrand() {
    var d = state.data;
    var years = '';
    if (d && d.movies && d.movies.length) {
      var dates = d.movies.map(function (m) { return m.date_created || ''; }).filter(Boolean).sort();
      if (dates.length) {
        years = dates[0].slice(0, 4) + '–' + dates[dates.length - 1].slice(0, 4);
      }
    }
    document.getElementById('brandSub').textContent =
      t('tagline') + ' · Dima · Deni · Yura · Ihor · ' + years;
    document.getElementById('footerLeft').textContent =
      'Кінобаза · ' + MB.moviesCount(d ? d.movies.length : 0) + (years ? ' · ' + years : '');
    document.getElementById('footerRight').textContent = t('footerData');
  }

  /* ---------- stats ---------- */
  function renderStats() {
    var d = state.data;
    if (!d) return;
    var s = store.computeStats(d);
    var names = store.reviewerNames(d);
    var total = s.count || 1;

    document.getElementById('reviewersGrid').innerHTML = s.perReviewer.map(function (r) {
      var color = MB.REVIEWER_COLORS[r.key] || 'var(--accent)';
      return '<div class="rev-card" style="--rc:' + color + '">' +
        '<span class="rev-avatar">' + esc(names[r.key].charAt(0).toUpperCase()) + '</span>' +
        '<div><div class="rev-name">' + esc(names[r.key]) + '</div>' +
        '<div class="rev-avg">' + fmtNum(r.avg) + '</div>' +
        '<div class="rev-count">' + esc(t('ratedFmt', { n: r.rated, total: s.count })) + '</div></div></div>';
    }).join('');

    var bestLine = s.best
      ? '<span class="ms-best">' + esc(s.best.title) + ' <small>(' + fmtNum(s.best.avg) + ')</small></span>'
      : '—';
    document.getElementById('summaryCard').innerHTML =
      '<div class="mini-stat"><div class="ms-label">' + esc(t('statMovies')) + '</div>' +
        '<div class="ms-value">' + MB.moviesCount(s.count) + '</div></div>' +
      '<div class="mini-stat"><div class="ms-label">' + esc(t('statRatings')) + '</div>' +
        '<div class="ms-value">' + MB.ratingsCount(s.totalRatings) + '</div></div>' +
      '<div class="mini-stat"><div class="ms-label">' + esc(t('statOverall')) + '</div>' +
        '<div class="ms-value">' + fmtNum(s.overallAvg) + '</div></div>' +
      '<div class="mini-stat"><div class="ms-label">' + esc(t('statSpan')) + '</div>' +
        '<div class="ms-value"><small>' + fmtDate(s.spanFrom) + ' — ' + fmtDate(s.spanTo) + '</small></div></div>' +
      '<div class="mini-stat wide"><div class="ms-label">' + esc(t('statBest')) + '</div>' + bestLine + '</div>';

    /* distribution bars 1..10 */
    var max = 1;
    for (var b = 1; b <= 10; b++) max = Math.max(max, s.dist[b] || 0);
    var html = '';
    for (var i = 1; i <= 10; i++) {
      var c = s.dist[i] || 0;
      var h = Math.round((c / max) * 100);
      html += '<div class="dist-bar" title="' + i + ' — ' + c + '">' +
        '<span class="dist-num">' + (c || '') + '</span>' +
        '<div class="dist-fill" style="height:' + h + '%' + (c ? '' : ';opacity:.25') + '"></div>' +
        '<span class="dist-lbl">' + i + '</span></div>';
    }
    document.getElementById('distChart').innerHTML = html;
  }

  /* ---------- toolbar selects ---------- */
  function reviewerSortLabel(key, dir) {
    var d = state.data;
    var names = store.reviewerNames(d);
    return names[key] + (dir === 'desc' ? ' ↓' : ' ↑');
  }

  function sortOptionList() {
    var list = [
      { v: 'date_desc', label: t('sortDateDesc') },
      { v: 'date_asc', label: t('sortDateAsc') },
      { v: 'avg_desc', label: t('sortAvgDesc') },
      { v: 'avg_asc', label: t('sortAvgAsc') },
      { v: 'title_asc', label: t('sortTitleAsc') },
      { v: 'title_desc', label: t('sortTitleDesc') }
    ];
    var cur = state.sort;
    var m = cur.match(/^([a-z]+)_(asc|desc)$/);
    if (m && store.REVIEWER_KEYS.indexOf(m[1]) >= 0 && cur !== '') {
      list.unshift({ v: cur, label: reviewerSortLabel(m[1], m[2]) });
    }
    return list;
  }

  function renderToolbar() {
    var d = state.data;
    var selR = document.getElementById('reviewerFilter');
    var curR = state.reviewer;
    var opts = ['<option value="all">' + esc(t('filterAll')) + '</option>'];
    store.reviewerKeys(d).forEach(function (k) {
      opts.push('<option value="' + k + '">' + esc(t('filterWatched', { name: store.reviewerNames(d)[k] })) + '</option>');
    });
    selR.innerHTML = opts.join('');
    selR.value = Array.prototype.some.call(selR.options, function (o) { return o.value === curR; }) ? curR : 'all';

    var selS = document.getElementById('sortSelect');
    selS.innerHTML = sortOptionList().map(function (o) {
      return '<option value="' + o.v + '">' + esc(o.label) + '</option>';
    }).join('');
    selS.value = state.sort;

    var view = state.view;
    if (view === 'auto') view = window.matchMedia('(max-width: 720px)').matches ? 'cards' : 'table';
    document.getElementById('viewTableBtn').classList.toggle('active', view === 'table');
    document.getElementById('viewCardsBtn').classList.toggle('active', view === 'cards');
  }

  /* ---------- list ---------- */
  function visibleMovies() {
    var d = state.data;
    var q = state.search.trim().toLocaleLowerCase('uk');
    var rev = state.reviewer;
    var movies = d.movies.slice();

    if (rev !== 'all') {
      movies = movies.filter(function (m) { return (m[rev + '_rate'] || 0) > 0; });
    }
    if (q) {
      movies = movies.filter(function (m) {
        return m.title.toLocaleLowerCase('uk').indexOf(q) >= 0;
      });
    }
    var cmp;
    var sort = state.sort;
    if (sort === 'date_desc') cmp = function (a, b) { return String(b.date_created || '').localeCompare(String(a.date_created || '')) || b.id - a.id; };
    else if (sort === 'date_asc') cmp = function (a, b) { return String(a.date_created || '').localeCompare(String(b.date_created || '')) || a.id - b.id; };
    else if (sort === 'avg_desc') cmp = function (a, b) { return (store.movieAvg(b) || -1) - (store.movieAvg(a) || -1); };
    else if (sort === 'avg_asc') cmp = function (a, b) { return (store.movieAvg(a) == null ? 1e9 : store.movieAvg(a)) - (store.movieAvg(b) == null ? 1e9 : store.movieAvg(b)); };
    else if (sort === 'title_asc') cmp = function (a, b) { return a.title.localeCompare(b.title, 'uk'); };
    else if (sort === 'title_desc') cmp = function (a, b) { return b.title.localeCompare(a.title, 'uk'); };
    else {
      var m = sort.match(/^([a-z]+)_(asc|desc)$/);
      if (m && store.REVIEWER_KEYS.indexOf(m[1]) >= 0) {
        var k = m[1] + '_rate', dir = m[2] === 'desc' ? -1 : 1;
        cmp = function (a, b) {
          var av = a[k] || 0, bv = b[k] || 0;
          if (av === 0 && bv === 0) return 0;
          if (av === 0) return 1;   /* not-rated always last */
          if (bv === 0) return -1;
          return (av - bv) * dir;
        };
      } else cmp = function () { return 0; };
    }
    return movies.sort(cmp);
  }

  function yearTag(m) {
    return m.year ? ' <span class="year-tag">' + m.year + '</span>' : '';
  }

  function renderList() {
    var d = state.data;
    var wrap = document.getElementById('listWrap');
    var empty = document.getElementById('emptyState');
    if (!d) return;
    var movies = visibleMovies();
    var keys = store.REVIEWER_KEYS;
    var names = store.reviewerNames(d);
    var view = state.view;
    if (view === 'auto') view = window.matchMedia('(max-width: 720px)').matches ? 'cards' : 'table';

    empty.hidden = movies.length > 0;
    if (!movies.length) { empty.textContent = t('emptyState'); wrap.innerHTML = ''; return; }

    if (view === 'cards') {
      wrap.innerHTML = '<div class="cards-grid">' + movies.map(function (m) {
        var avg = store.movieAvg(m);
        return '<article class="movie-card" data-id="' + m.id + '">' +
          '<div class="card-top"><h3 class="card-title-t">' + esc(m.title) + '</h3>' +
          '<span class="avg-pill ' + avgClass(avg) + '" title="' + t('colAvg') + '">' +
          (avg == null ? '—' : MB.icon('star', 11) + fmtNum(avg)) + '</span></div>' +
          '<div class="card-rates">' + keys.map(function (k) {
            var v = m[k + '_rate'] || 0;
            return '<span class="mini-rate"><span class="mr-name">' + esc(names[k]) + '</span>' +
              '<span class="rate ' + rateClass(v) + '">' + (v > 0 ? v : '—') + '</span></span>';
          }).join('') + '</div>' +
          '<div class="card-meta"><span>' + fmtDate(m.date_created) + (m.year ? ' · ' + m.year : '') + '</span><span>#' + m.id + '</span></div>' +
          '<div class="card-actions">' + actionButtons() + '</div></article>';
      }).join('') + '</div>';
      return;
    }

    /* table */
    var sort = state.sort;
    function arrow(col) {
      var m = sort.match(/^([a-z]+)_(asc|desc)$/);
      if (m && (m[1] === col || (col === 'avg' && m[1] === 'avg'))) {
        return '<span class="sort-arrow">' + (m[2] === 'asc' ? '▲' : '▼') + '</span>';
      }
      return '';
    }
    function ariaSort(col) {
      var m = sort.match(/^([a-z]+)_(asc|desc)$/);
      if (m && m[1] === col) return m[2] === 'asc' ? 'ascending' : 'descending';
      return 'none';
    }
    wrap.innerHTML =
      '<div class="table-card"><div class="table-scroll"><table class="movie-table"><thead><tr>' +
      '<th class="th-id">#</th>' +
      '<th class="sortable" data-sortcol="title" aria-sort="' + ariaSort('title') + '">' + esc(t('colTitle')) + arrow('title') + '</th>' +
      keys.map(function (k) {
        var color = MB.REVIEWER_COLORS[k] || 'var(--muted)';
        var m = sort.match(/^([a-z]+)_(asc|desc)$/);
        var sorted = m && m[1] === k;
        return '<th class="sortable" data-sortcol="' + k + '" aria-sort="' + (sorted ? (m[2] === 'asc' ? 'ascending' : 'descending') : 'none') + '" style="--rc:' + color + '"><span class="rev-dot"></span>' + esc(names[k]) + (sorted ? '<span class="sort-arrow">' + (m[2] === 'asc' ? '▲' : '▼') + '</span>' : '') + '</th>';
      }).join('') +
      '<th class="sortable" data-sortcol="avg" aria-sort="' + ariaSort('avg') + '">' + esc(t('colAvg')) + arrow('avg') + '</th>' +
      '<th class="sortable" data-sortcol="date" aria-sort="' + ariaSort('date') + '">' + esc(t('colDate')) + arrow('date') + '</th>' +
      '<th class="th-actions"><span class="visually-hidden"></span></th>' +
      '</tr></thead><tbody>' +
      movies.map(function (m) {
        var avg = store.movieAvg(m);
        return '<tr data-id="' + m.id + '">' +
          '<td class="td-id">' + m.id + '</td>' +
          '<td class="td-title"><span class="title-text">' + esc(m.title) + '</span>' + yearTag(m) + '</td>' +
          keys.map(function (k) {
            var v = m[k + '_rate'] || 0;
            return '<td><span class="rate ' + rateClass(v) + '" title="' + esc(names[k]) + (v > 0 ? ': ' + v : ' — ' + t('notWatched')) + '">' + (v > 0 ? v : '—') + '</span></td>';
          }).join('') +
          '<td><span class="avg-pill ' + avgClass(avg) + '">' + (avg == null ? '—' : MB.icon('star', 11) + fmtNum(avg)) + '</span></td>' +
          '<td class="td-date">' + fmtDate(m.date_created) + '</td>' +
          '<td class="td-actions">' + actionButtons() + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  function actionButtons() {
    return '<button type="button" class="row-btn act-edit" title="' + esc(t('editMovie')) + '" aria-label="' + esc(t('editMovie')) + '">' + MB.icon('edit') + '</button>' +
      '<button type="button" class="row-btn danger act-del" title="' + esc(t('deleteBtn')) + '" aria-label="' + esc(t('deleteBtn')) + '">' + MB.icon('trash') + '</button>';
  }

  function renderAll() {
    MB.applyI18n();
    renderBrand();
    renderStats();
    renderToolbar();
    renderList();
    MB.updateUnsyncedDot();
    if (MB.stats) MB.stats.onDataChange();
  }

  window.MB.render = {
    renderAll: renderAll, renderStats: renderStats, renderList: renderList,
    renderToolbar: renderToolbar, renderBrand: renderBrand,
    visibleMovies: visibleMovies, fmtDate: fmtDate, fmtNum: fmtNum, esc: esc
  };
})();
