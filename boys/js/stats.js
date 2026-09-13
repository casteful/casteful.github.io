// ============================================================
// Stats tab — KPIs + charts (Chart.js)
// Rebuilt on every Firebase snapshot, so stats are always live.
// 8 KPI cards + 14 charts: decades, seasons, activity, release
// years, countries, genres, directors (count + avg rating),
// country/genre avg ratings, distribution, raters, top-10.
// All labels come from the i18n dictionary (uk default / en).
// ============================================================
import { RATERS, avgRate, seasonFromDate, decadeOf } from "./data.js";
import { t, pluralW } from "./i18n.js";

let charts = [];

// theme-aware chart colors — follows <html data-theme="light|dark">
function getTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  return {
    text: dark ? "#8e99b0" : "#667085",
    grid: dark ? "rgba(255,255,255,.06)" : "rgba(16,24,40,.07)",
    tooltipBg: dark ? "rgba(18,24,40,.96)" : "rgba(255,255,255,.98)",
    tooltipBorder: dark ? "#2d3954" : "#e0e4ee",
    tooltipTitle: dark ? "#e7ebf5" : "#101828",
    sliceBorder: dark ? "#121828" : "#ffffff",
    palette: [
      "#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
      "#ef4444", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
    ],
  };
}

function destroyCharts() {
  charts.forEach((c) => { try { c.destroy(); } catch (e) {} });
  charts = [];
}

function baseOpts(extra = {}) {
  const T = getTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: T.text, boxWidth: 12 } },
      tooltip: { backgroundColor: T.tooltipBg, borderColor: T.tooltipBorder, borderWidth: 1, titleColor: T.tooltipTitle, bodyColor: T.text },
      ...extra.plugins,
    },
    scales: {
      x: { ticks: { color: T.text }, grid: { color: T.grid } },
      y: { ticks: { color: T.text }, grid: { color: T.grid }, beginAtZero: true },
    },
    ...extra,
  };
}

function countBy(ms, keyFn) {
  const map = new Map();
  ms.forEach((m) => {
    const keys = keyFn(m);
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
      if (k === null || k === undefined || k === "" || k === "—") return;
      map.set(k, (map.get(k) || 0) + 1);
    });
  });
  return map;
}

function topEntries(map, n, sortNumeric = false) {
  let entries = [...map.entries()];
  entries.sort((a, b) => (sortNumeric ? Number(b[0]) - Number(a[0]) : b[1] - a[1]));
  return entries.slice(0, n);
}

// average rating per group, only over movies that have ratings
function avgBy(ms, keyFn) {
  const sums = new Map();
  ms.forEach((m) => {
    const a = avgRate(m.rates);
    if (a <= 0) return;
    const keys = keyFn(m);
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
      if (!k) return;
      const cur = sums.get(k) || { s: 0, n: 0 };
      cur.s += a; cur.n += 1;
      sums.set(k, cur);
    });
  });
  return new Map([...sums.entries()].map(([k, v]) => [k, { avg: v.s / v.n, n: v.n }]));
}

// ---------- KPI cards ----------
function renderKPIs(ms, kpiGrid) {
  const avg = ms.length ? ms.reduce((s, m) => s + avgRate(m.rates), 0) / ms.length : 0;
  const best = ms.reduce((a, m) => (avgRate(m.rates) > avgRate(a?.rates || {}) ? m : a), null);
  const seasons = new Set(ms.map((m) => m.season || seasonFromDate(m.date)));
  const thisSeason = Math.max(...[...seasons].map(Number).filter(Number.isFinite), 0);
  const thisSeasonCount = ms.filter((m) => Number(m.season || seasonFromDate(m.date)) === thisSeason).length;
  const decades = countBy(ms, (m) => (decadeOf(m.year) ? `${decadeOf(m.year)}s` : null));
  const topDecade = [...decades.entries()].sort((a, b) => b[1] - a[1])[0];
  const directors = countBy(ms, (m) => (m.director || "").split(",")[0].trim());
  const topDirector = [...directors.entries()].sort((a, b) => b[1] - a[1])[0];
  const countries = countBy(ms, (m) => (m.country || "").split(",").map((c) => c.trim()));

  const kpi = (label, value, sub = "") => `
    <div class="kpi">
      <div><b>${value}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>
    </div>`;

  kpiGrid.innerHTML = [
    kpi(t("kMovies"), ms.length, `${seasons.size} ${pluralW(seasons.size, "season")} · 2019–${thisSeason || "now"}`),
    kpi(t("kAvg"), avg.toFixed(2), t("kAvgSub")),
    kpi(t("kFav"), best ? `${avgRate(best.rates).toFixed(1)} · ${best.title}` : "—", t("kFavSub")),
    kpi(t("kSeason"), `${thisSeasonCount}`, t("kSeasonSub", { s: thisSeason || "—" })),
    kpi(t("kTopDecade"), topDecade ? `${topDecade[0]} (${topDecade[1]})` : "—", t("kTopDecadeSub")),
    kpi(t("kTopDir"), topDirector ? `${topDirector[0]} (${topDirector[1]})` : "—", t("kTopDirSub")),
    kpi(t("kDirectors"), directors.size, t("kUniqueSub")),
    kpi(t("kCountries"), countries.size, t("kUniqueSub")),
  ].join("");
}

// ---------- charts ----------
function renderCharts(ms, grid) {
  destroyCharts();
  grid.innerHTML = "";
  const T = getTheme();

  const add = (title, span, canvasId) => {
    const wrap = document.createElement("div");
    wrap.className = `chart-card ${span || ""}`;
    wrap.innerHTML = `<h3>${title}</h3><div class="chart-box"><canvas id="${canvasId}"></canvas></div>`;
    grid.appendChild(wrap);
    return wrap.querySelector("canvas");
  };

  // 1) Movies by decade + 2) avg rating by decade
  const decadeMap = countBy(ms, (m) => (decadeOf(m.year) ? `${decadeOf(m.year)}s` : null));
  const decades = [...decadeMap.keys()].sort((a, b) => parseInt(a) - parseInt(b));
  const decadeCounts = decades.map((d) => decadeMap.get(d));
  const decadeAvg = decades.map((d) => {
    const list = ms.filter((m) => `${decadeOf(m.year)}s` === d && avgRate(m.rates) > 0);
    return list.length ? list.reduce((s, m) => s + avgRate(m.rates), 0) / list.length : 0;
  });

  charts.push(new Chart(add(t("cDecade"), "", "chDecade"), {
    type: "bar",
    data: {
      labels: decades,
      datasets: [{ data: decadeCounts, backgroundColor: "#6366f1cc", borderColor: "#6366f1", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  charts.push(new Chart(add(t("cDecadeAvg"), "", "chDecadeAvg"), {
    type: "bar",
    data: {
      labels: decades,
      datasets: [{ data: decadeAvg.map((v) => +v.toFixed(2)), backgroundColor: "#f59e0bcc", borderColor: "#f59e0b", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => t("ttMovies", { n: decadeCounts[c.dataIndex] }) } } },
      scales: { x: { ticks: { color: T.text }, grid: { color: T.grid } }, y: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } } },
    }),
  }));

  // 3) Movies by club season
  const seasonMap = countBy(ms, (m) => m.season || seasonFromDate(m.date));
  const seasons = [...seasonMap.keys()].sort();
  charts.push(new Chart(add(t("cSeason"), "", "chSeason"), {
    type: "bar",
    data: {
      labels: seasons,
      datasets: [{ data: seasons.map((s) => seasonMap.get(s)), backgroundColor: "#8b5cf6cc", borderColor: "#8b5cf6", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 4) Watched per year (timeline from watch dates)
  const yearMap = countBy(ms, (m) => (m.date || "").slice(0, 4));
  const watchYears = [...yearMap.keys()].sort();
  charts.push(new Chart(add(t("cActivity"), "", "chActivity"), {
    type: "line",
    data: {
      labels: watchYears,
      datasets: [{
        data: watchYears.map((y) => yearMap.get(y)),
        borderColor: "#14b8a6", backgroundColor: "#14b8a633", fill: true, tension: 0.35,
        pointBackgroundColor: "#14b8a6", pointRadius: 4,
      }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 5) Movies by release year (full timeline)
  const releaseMap = countBy(ms, (m) => (m.year ? String(m.year) : null));
  const releaseYears = [...releaseMap.keys()].sort((a, b) => Number(a) - Number(b));
  charts.push(new Chart(add(t("cReleaseYears"), "wide", "chReleaseYears"), {
    type: "line",
    data: {
      labels: releaseYears,
      datasets: [{
        data: releaseYears.map((y) => releaseMap.get(y)),
        borderColor: "#ec4899", backgroundColor: "#ec489922", fill: true, tension: 0.3,
        pointBackgroundColor: "#ec4899", pointRadius: 3,
      }],
    },
    options: baseOpts({
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: T.text, maxRotation: 60, autoSkip: true, maxTicksLimit: 16 }, grid: { color: T.grid } }, y: { ticks: { color: T.text, precision: 0 }, grid: { color: T.grid }, beginAtZero: true } },
    }),
  }));

  // 6) Countries (doughnut)
  const countryMap = countBy(ms, (m) => (m.country || "").split(",").map((c) => c.trim()));
  const countries = topEntries(countryMap, 9);
  const othersCount = [...countryMap.values()].reduce((a, b) => a + b, 0) - countries.reduce((a, [, v]) => a + v, 0);
  const cLabels = countries.map(([k]) => k).concat(othersCount > 0 ? [t("other")] : []);
  const cData = countries.map(([, v]) => v).concat(othersCount > 0 ? [othersCount] : []);
  charts.push(new Chart(add(t("cCountry"), "", "chCountry"), {
    type: "doughnut",
    data: { labels: cLabels, datasets: [{ data: cData, backgroundColor: T.palette, borderColor: T.sliceBorder, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: T.text, boxWidth: 12 } } }, cutout: "58%" },
  }));

  // 7) Genres (doughnut)
  const genreMap = countBy(ms, (m) => (m.genre || "").split(",").map((g) => g.trim()));
  const genres = topEntries(genreMap, 8);
  charts.push(new Chart(add(t("cGenres"), "", "chGenres"), {
    type: "doughnut",
    data: { labels: genres.map(([k]) => k), datasets: [{ data: genres.map(([, v]) => v), backgroundColor: T.palette, borderColor: T.sliceBorder, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: T.text, boxWidth: 12 } } }, cutout: "58%" },
  }));

  // 8) Most watched directors (count)
  const dirMap = countBy(ms, (m) => (m.director || "").split(",")[0].trim());
  const dirs = topEntries(dirMap, 10);
  charts.push(new Chart(add(t("cDirectors"), "wide", "chDirectors"), {
    type: "bar",
    data: {
      labels: dirs.map(([k]) => k),
      datasets: [{ data: dirs.map(([, v]) => v), backgroundColor: "#f43f5ecc", borderColor: "#f43f5e", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: T.text, precision: 0 }, grid: { color: T.grid }, beginAtZero: true }, y: { ticks: { color: T.text }, grid: { display: false } } },
    }),
  }));

  // 9) Directors by average rating (min 2 movies)
  const dirAvg = avgBy(ms, (m) => (m.director || "").split(",")[0].trim());
  const dirsAvgTop = [...dirAvg.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => b[1].avg - a[1].avg)
    .slice(0, 10);
  charts.push(new Chart(add(t("cDirAvg"), "wide", "chDirAvg"), {
    type: "bar",
    data: {
      labels: dirsAvgTop.map(([k]) => k),
      datasets: [{ data: dirsAvgTop.map(([, v]) => +v.avg.toFixed(2)), backgroundColor: "#6366f1cc", borderColor: "#6366f1", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => t("ttMovies", { n: dirsAvgTop[c.dataIndex][1].n }) } } },
      scales: { x: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } }, y: { ticks: { color: T.text }, grid: { display: false } } },
    }),
  }));

  // 10) Average rating by country (top 8 by movie count)
  const countryAvg = avgBy(ms, (m) => (m.country || "").split(",")[0].trim());
  const countryAvgTop = [...countryAvg.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 8)
    .sort((a, b) => b[1].avg - a[1].avg);
  charts.push(new Chart(add(t("cCountryAvg"), "", "chCountryAvg"), {
    type: "bar",
    data: {
      labels: countryAvgTop.map(([k]) => k),
      datasets: [{ data: countryAvgTop.map(([, v]) => +v.avg.toFixed(2)), backgroundColor: "#06b6d4cc", borderColor: "#06b6d4", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => t("ttMovies", { n: countryAvgTop[c.dataIndex][1].n }) } } },
      scales: { x: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } }, y: { ticks: { color: T.text }, grid: { display: false } } },
    }),
  }));

  // 11) Average rating by genre (top 8 by movie count)
  const genreAvg = avgBy(ms, (m) => (m.genre || "").split(",").map((g) => g.trim()));
  const genreAvgTop = [...genreAvg.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 8)
    .sort((a, b) => b[1].avg - a[1].avg);
  charts.push(new Chart(add(t("cGenreAvg"), "", "chGenreAvg"), {
    type: "bar",
    data: {
      labels: genreAvgTop.map(([k]) => k),
      datasets: [{ data: genreAvgTop.map(([, v]) => +v.avg.toFixed(2)), backgroundColor: "#f97316cc", borderColor: "#f97316", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => t("ttMovies", { n: genreAvgTop[c.dataIndex][1].n }) } } },
      scales: { x: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } }, y: { ticks: { color: T.text }, grid: { display: false } } },
    }),
  }));

  // 12) Rating distribution (avg movie ratings 1..10)
  const dist = Array.from({ length: 10 }, () => 0);
  ms.forEach((m) => {
    const a = avgRate(m.rates);
    if (a > 0) dist[Math.min(9, Math.max(0, Math.round(a) - 1))]++;
  });
  charts.push(new Chart(add(t("cDist"), "", "chDist"), {
    type: "bar",
    data: {
      labels: dist.map((_, i) => `${i + 1}`),
      datasets: [{ data: dist, backgroundColor: dist.map((_, i) => i < 3 ? "#ef4444cc" : i < 6 ? "#f59e0bcc" : "#10b981cc"), borderWidth: 0, borderRadius: 6 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 13) Raters comparison
  const raterAvg = RATERS.map((r) => {
    const vals = ms.map((m) => m.rates?.[r.key]).filter((v) => Number(v) > 0);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0;
  });
  const raterCount = RATERS.map((r) => ms.filter((m) => Number(m.rates?.[r.key]) > 0).length);
  charts.push(new Chart(add(t("cRaters"), "", "chRaters"), {
    type: "bar",
    data: {
      labels: RATERS.map((r) => r.name),
      datasets: [
        { label: t("kAvg"), data: raterAvg.map((v) => +v.toFixed(2)), backgroundColor: RATERS.map((r) => r.color + "cc"), borderRadius: 6, borderWidth: 1 },
      ],
    },
    options: baseOpts({
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => t("ttRated", { n: raterCount[c.dataIndex] }) } } },
      scales: { x: { ticks: { color: T.text }, grid: { display: false } }, y: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } } },
    }),
  }));

  // 14) Top 10 movies
  const top = ms.filter((m) => avgRate(m.rates) > 0).sort((a, b) => avgRate(b.rates) - avgRate(a.rates)).slice(0, 10).reverse();
  charts.push(new Chart(add(t("cTop"), "wide", "chTop"), {
    type: "bar",
    data: {
      labels: top.map((m) => `${m.title}${m.year ? ` (${m.year})` : ""}`),
      datasets: [{ data: top.map((m) => +avgRate(m.rates).toFixed(2)), backgroundColor: "#f59e0bcc", borderColor: "#f59e0b", borderWidth: 1, borderRadius: 6 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } }, y: { ticks: { color: T.text, font: { size: 11 } }, grid: { display: false } } },
    }),
  }));
}

export function renderStats(ms, grid, kpiGrid) {
  if (!grid || !kpiGrid) return;
  if (typeof Chart === "undefined") {
    // Chart.js still loading (deferred script) — retry shortly
    setTimeout(() => renderStats(ms, grid, kpiGrid), 300);
    return;
  }
  renderKPIs(ms, kpiGrid);
  renderCharts(ms, grid);
}
