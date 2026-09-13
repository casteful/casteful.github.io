/* Кінобаза — Stats tab: KPI cards, Chart.js graphs, highlight lists.
   Charts render only when Chart.js (CDN) is available; KPI + lists are pure DOM. */
(function () {
  'use strict';
  var MB = window.MB;
  var store = MB.store;
  var state = store.state;
  var t = MB.t;

  var charts = {};          /* id -> Chart instance */
  var built = false;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function rgba(hex, a) {
    hex = (hex || '#888').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- data shaping ---------- */
  function movieYear(m) {
    if (m.year && m.year > 0) return m.year;
    return parseInt(String(m.date_created || '').slice(0, 4), 10) || 0;
  }
  function decadeOf(m) {
    var y = movieYear(m);
    return y ? Math.floor(y / 10) * 10 : null;
  }
  function decadeLabel(d) {
    return state.lang === 'en' ? d + 's' : d + '-ті';
  }
  function collectDecades(movies) {
    var map = {};
    movies.forEach(function (m) {
      var d = decadeOf(m);
      if (d == null) return;
      if (!map[d]) map[d] = [];
      map[d].push(m);
    });
    return map;
  }

  /* ---------- KPI + lists (DOM) ---------- */
  function kpiCard(label, value, sub) {
    return '<div class="kpi-card"><div class="ms-label">' + MB.render.esc(label) + '</div>' +
      '<div class="ms-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + MB.render.esc(sub) + '</div>' : '') + '</div>';
  }
  function renderKpi(s, decades) {
    var movies = state.data.movies;
    var nowY = new Date().getFullYear();
    var thisYear = movies.filter(function (m) {
      return parseInt(String(m.date_created || '').slice(0, 4), 10) === nowY;
    }).length;
    var keys = Object.keys(decades).map(Number).sort();
    var topD = null, topN = -1;
    keys.forEach(function (d) {
      if (decades[d].length >= topN) { topN = decades[d].length; topD = d; }
    });
    var topDecade = topD == null ? '—' :
      decadeLabel(topD) + ' · ' + MB.moviesCount(topN);

    var g = document.getElementById('kpiGrid');
    g.innerHTML =
      kpiCard(t('statMovies'), MB.moviesCount(s.count)) +
      kpiCard(t('statRatings'), MB.ratingsCount(s.totalRatings)) +
      kpiCard(t('kpiAvg'), MB.render.fmtNum(s.overallAvg)) +
      kpiCard(t('kpiDecades'), String(keys.length),
        keys.length ? decadeLabel(keys[0]) + ' — ' + decadeLabel(keys[keys.length - 1]) : '') +
      kpiCard(t('kpiTopDecade'), '', topDecade) +
      kpiCard(t('kpiThisYear'), String(thisYear), String(nowY));

    /* top-decade card: value lives in sub line */
    var cards = g.querySelectorAll('.kpi-card');
    if (cards[4]) cards[4].querySelector('.ms-value').innerHTML =
      MB.icon('trophy', 18) || '';
  }

  function spreadInfo(m) {
    var vals = store.REVIEWER_KEYS.map(function (k) { return m[k + '_rate'] || 0; })
      .filter(function (v) { return v > 0; });
    if (vals.length < 2) return null;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    return { spread: mx - mn, mn: mn, mx: mx };
  }

  function renderLists() {
    var movies = state.data.movies.slice();
    var names = store.reviewerNames(state.data);
    var keys = store.REVIEWER_KEYS;

    var spreads = movies.map(function (m) { return { m: m, s: spreadInfo(m) }; })
      .filter(function (x) { return x.s && x.s.spread >= 4; })
      .sort(function (a, b) { return b.s.spread - a.s.spread || (store.movieAvg(b.m) || 0) - (store.movieAvg(a.m) || 0); })
      .slice(0, 5);

    var dHtml = spreads.length ? spreads.map(function (x) {
      var chips = keys.map(function (k) {
        var v = x.m[k + '_rate'] || 0;
        if (!v) return '';
        return '<span class="mini-rate"><span class="mr-name">' + MB.render.esc(names[k]) + '</span>' +
          '<span class="rate ' + rateCls(v) + '">' + v + '</span></span>';
      }).join('');
      return '<div class="hl-item"><div class="hl-top"><span class="hl-title">' + MB.render.esc(x.m.title) + '</span>' +
        '<span class="spread-pill">' + t('spreadFmt', { n: x.s.spread }) + '</span></div>' +
        '<div class="hl-chips">' + chips + '</div></div>';
    }).join('') : '<p class="hl-empty">' + t('hlNone') + '</p>';

    var recent = movies.slice().sort(function (a, b) {
      return String(b.date_created || '').localeCompare(String(a.date_created || '')) || b.id - a.id;
    }).slice(0, 5);
    var rHtml = recent.map(function (m) {
      var avg = store.movieAvg(m);
      return '<div class="hl-item"><div class="hl-top"><span class="hl-title">' + MB.render.esc(m.title) + '</span>' +
        '<span class="avg-pill ' + avgCls(avg) + '">' + (avg == null ? '—' : MB.render.fmtNum(avg)) + '</span></div>' +
        '<div class="hl-date">' + MB.render.fmtDate(m.date_created) + '</div></div>';
    }).join('');

    document.getElementById('listDisagree').innerHTML =
      '<h3 class="list-sub">' + t('hlDisagree') + '</h3>' + dHtml;
    document.getElementById('listRecent').innerHTML =
      '<h3 class="list-sub">' + t('hlRecent') + '</h3>' + rHtml;
  }
  function rateCls(v) {
    if (!v || v <= 0) return 'r0';
    if (v <= 4) return 'r1';
    if (v <= 6) return 'r2';
    if (v <= 8) return 'r3';
    return 'r4';
  }
  function avgCls(a) {
    if (a == null) return 'p0';
    if (a < 4.5) return 'p1';
    if (a < 6.5) return 'p2';
    if (a < 8.5) return 'p3';
    return 'p4';
  }

  /* ---------- charts (Chart.js) ---------- */
  function baseOpts() {
    var grid = rgba(cssVar('--border'), .9);
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar('--muted') } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: cssVar('--muted'), precision: 0 } }
      }
    };
  }

  function mkChart(id, cfg) {
    var el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (charts[id]) { charts[id].destroy(); charts[id] = null; }
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }

  function renderCharts(s, decades) {
    if (typeof Chart === 'undefined') {
      document.getElementById('chartsFallback').hidden = false;
      document.getElementById('chartArea').classList.add('no-charts');
      return;
    }
    document.getElementById('chartsFallback').hidden = true;
    document.getElementById('chartArea').classList.remove('no-charts');

    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = cssVar('--text-2');

    var accent = cssVar('--accent');
    var keys = Object.keys(decades).map(Number).sort();
    var dLabels = keys.map(decadeLabel);
    var dCounts = keys.map(function (d) { return decades[d].length; });
    var dAvgs = keys.map(function (d) {
      var list = decades[d].map(store.movieAvg).filter(function (a) { return a != null; });
      return list.length ? +(list.reduce(function (a, b) { return a + b; }, 0) / list.length).toFixed(2) : null;
    });

    /* 1. movies by decade */
    mkChart('chDecadeCount', {
      type: 'bar',
      data: {
        labels: dLabels,
        datasets: [{
          data: dCounts,
          backgroundColor: dCounts.map(function (v, i) {
            return v === Math.max.apply(null, dCounts.concat([1])) ? accent : rgba(accent, .45);
          }),
          borderRadius: 7, maxBarThickness: 54
        }]
      },
      options: Object.assign(baseOpts(), {})
    });

    /* 2. average rating by decade */
    var o2 = baseOpts();
    o2.scales.y.min = 0; o2.scales.y.max = 10;
    o2.scales.y.ticks.stepSize = 2;
    o2.plugins.tooltip = {
      callbacks: {
        afterLabel: function (ctx) {
          var n = dCounts[ctx.dataIndex];
          return t('tooltipMovies', { n: n });
        }
      }
    };
    mkChart('chDecadeAvg', {
      type: 'bar',
      data: {
        labels: dLabels,
        datasets: [{
          data: dAvgs,
          backgroundColor: dAvgs.map(function (a) {
            if (a == null) return rgba(cssVar('--r0'), .5);
            if (a < 4.5) return cssVar('--r1');
            if (a < 6.5) return cssVar('--r2');
            if (a < 8.5) return cssVar('--r3');
            return cssVar('--r4');
          }),
          borderRadius: 7, maxBarThickness: 54
        }]
      },
      options: o2
    });

    /* 3. watches per year */
    var movies = state.data.movies;
    var yMap = {};
    movies.forEach(function (m) {
      var y = parseInt(String(m.date_created || '').slice(0, 4), 10);
      if (y) yMap[y] = (yMap[y] || 0) + 1;
    });
    var years = Object.keys(yMap).map(Number).sort();
    if (years.length) {
      var span = [];
      for (var y = years[0]; y <= Math.max(years[years.length - 1], new Date().getFullYear()); y++) span.push(y);
      mkChart('chPerYear', {
        type: 'bar',
        data: {
          labels: span,
          datasets: [{
            data: span.map(function (y) { return yMap[y] || 0; }),
            backgroundColor: rgba(cssVar('--gold'), .75),
            hoverBackgroundColor: cssVar('--gold'),
            borderRadius: 6, maxBarThickness: 44
          }]
        },
        options: baseOpts()
      });
    }

    /* 4. all individual ratings 1..10 */
    var buckets = {};
    movies.forEach(function (m) {
      store.REVIEWER_KEYS.forEach(function (k) {
        var v = m[k + '_rate'] || 0;
        if (v > 0) buckets[v] = (buckets[v] || 0) + 1;
      });
    });
    var dist = [];
    for (var i = 1; i <= 10; i++) dist.push(buckets[i] || 0);
    var rateColors = [cssVar('--r1'), cssVar('--r1'), cssVar('--r1'), cssVar('--r1'),
                      cssVar('--r2'), cssVar('--r2'), cssVar('--r3'), cssVar('--r3'),
                      cssVar('--r4'), cssVar('--r4')];
    mkChart('chDist', {
      type: 'bar',
      data: {
        labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        datasets: [{ data: dist, backgroundColor: rateColors, borderRadius: 6, maxBarThickness: 38 }]
      },
      options: baseOpts()
    });

    /* 5. reviewer tastes radar (avg per decade) */
    var revKeys = store.reviewerKeys(state.data);
    var names = store.reviewerNames(state.data);
    mkChart('chRadar', {
      type: 'radar',
      data: {
        labels: dLabels,
        datasets: revKeys.map(function (k) {
          var c = MB.REVIEWER_COLORS[k] || accent;
          return {
            label: names[k],
            data: keys.map(function (d) {
              var list = decades[d].map(function (m) { return m[k + '_rate'] || 0; })
                .filter(function (v) { return v > 0; });
              return list.length ? +(list.reduce(function (a, b) { return a + b; }, 0) / list.length).toFixed(2) : null;
            }),
            borderColor: c,
            backgroundColor: rgba(c, .14),
            pointBackgroundColor: c,
            pointRadius: 3,
            borderWidth: 2,
            spanGaps: true
          };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle' } } },
        scales: {
          r: {
            min: 0, max: 10, ticks: { stepSize: 2, backdropColor: 'transparent', color: cssVar('--muted'), font: { size: 10 } },
            grid: { color: rgba(cssVar('--border'), .9) },
            angleLines: { color: rgba(cssVar('--border'), .9) },
            pointLabels: { color: cssVar('--text-2'), font: { size: 11 } }
          }
        }
      }
    });

    /* 6. top-10 by average */
    var top = movies.map(function (m) { return { m: m, avg: store.movieAvg(m) }; })
      .filter(function (x) { return x.avg != null; })
      .sort(function (a, b) { return b.avg - a.avg || a.m.title.localeCompare(b.m.title, 'uk'); })
      .slice(0, 10)
      .reverse(); /* horizontal bar draws bottom-up */
    function topLabel(x) {
      var y = movieYear(x.m);
      return x.m.title + (y ? ' · ' + y : '');
    }
    var o6 = baseOpts();
    o6.indexAxis = 'y';
    o6.scales.x.min = 0; o6.scales.x.max = 10;
    o6.plugins.tooltip = {
      callbacks: { title: function (items) { return topLabel(top[items[0].dataIndex]); } }
    };
    mkChart('chTop', {
      type: 'bar',
      data: {
        labels: top.map(function (x) {
          var lbl = topLabel(x);
          return lbl.length > 30 ? lbl.slice(0, 29) + '…' : lbl;
        }),
        datasets: [{
          data: top.map(function (x) { return +x.avg.toFixed(2); }),
          backgroundColor: top.map(function (x) {
            if (x.avg < 4.5) return cssVar('--r1');
            if (x.avg < 6.5) return cssVar('--r2');
            if (x.avg < 8.5) return cssVar('--r3');
            return cssVar('--r4');
          }),
          borderRadius: 6, maxBarThickness: 22
        }]
      },
      options: o6
    });
  }

  /* ---------- entry point ---------- */
  function render() {
    var d = state.data;
    if (!d || !d.movies) return;
    var s = store.computeStats(d);
    var decades = collectDecades(d.movies);
    renderKpi(s, decades);
    renderLists();
    renderCharts(s, decades);
    built = true;
  }

  /* called by render.renderAll() — only rebuilds when the tab is visible */
  function onDataChange() {
    if (state.tab === 'stats') render();
  }

  MB.stats = { render: render, onDataChange: onDataChange, movieYear: movieYear, decadeOf: decadeOf };
})();
