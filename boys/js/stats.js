// ============================================================
// Stats tab — KPIs + charts (Chart.js)
// Rebuilt on every Firebase snapshot, so stats are always live.
// ============================================================
import { RATERS, avgRate, seasonFromDate, decadeOf } from "./data.js";

let charts = [];

// theme-aware chart colors — follows <html data-theme="light|dark">
function getTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  return {
    text: dark ? "#93a0b4" : "#647083",
    grid: dark ? "rgba(255,255,255,.07)" : "rgba(29,39,51,.09)",
    tooltipBg: dark ? "#1c2230" : "#ffffff",
    tooltipBorder: dark ? "#2a3242" : "#d9e1ec",
    tooltipTitle: dark ? "#fff" : "#1d2733",
    sliceBorder: dark ? "#141926" : "#ffffff",
    palette: ["#e05c66", "#e89518", "#3d90d0", "#5f9e4a", "#d4217a", "#6d21a8", "#22a094", "#e06235", "#d9a916", "#5a97c9"],
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

  const kpi = (label, value, sub = "") => `
    <div class="kpi">
      <div><b>${value}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>
    </div>`;

  kpiGrid.innerHTML = [
    kpi("Movies watched", ms.length, `${seasons.size} seasons · 2019–${thisSeason || "now"}`),
    kpi("Average rating", avg.toFixed(2), "all movies, all raters"),
    kpi("Club favourite", best ? `${avgRate(best.rates).toFixed(1)} · ${best.title}` : "—", "highest rated movie"),
    kpi("This season", `${thisSeasonCount} movies`, `season ${thisSeason || "—"}`),
    kpi("Top decade", topDecade ? `${topDecade[0]} (${topDecade[1]})` : "—", "most watched"),
    kpi("Top director", topDirector ? `${topDirector[0]} (${topDirector[1]})` : "—", "most watched"),
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

  charts.push(new Chart(add("Movies by release decade", "", "chDecade"), {
    type: "bar",
    data: {
      labels: decades,
      datasets: [{ data: decadeCounts, backgroundColor: "#6495edcc", borderColor: "#6495ed", borderWidth: 1, borderRadius: 4 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  charts.push(new Chart(add("Average rating by decade", "", "chDecadeAvg"), {
    type: "bar",
    data: {
      labels: decades,
      datasets: [{ data: decadeAvg.map((v) => +v.toFixed(2)), backgroundColor: "#e89518cc", borderColor: "#e89518", borderWidth: 1, borderRadius: 4 }],
    },
    options: baseOpts({
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `${decadeCounts[c.dataIndex]} movies` } } },
      scales: { x: { ticks: { color: T.text }, grid: { color: T.grid } }, y: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } } },
    }),
  }));

  // 3) Movies by club season
  const seasonMap = countBy(ms, (m) => m.season || seasonFromDate(m.date));
  const seasons = [...seasonMap.keys()].sort();
  charts.push(new Chart(add("Movies by season", "", "chSeason"), {
    type: "bar",
    data: {
      labels: seasons,
      datasets: [{ data: seasons.map((s) => seasonMap.get(s)), backgroundColor: "#9d4eddcc", borderColor: "#9d4edd", borderWidth: 1, borderRadius: 4 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 4) Watched per year (timeline from watch dates)
  const yearMap = countBy(ms, (m) => (m.date || "").slice(0, 4));
  const watchYears = [...yearMap.keys()].sort();
  charts.push(new Chart(add("Watching activity (per year)", "", "chActivity"), {
    type: "line",
    data: {
      labels: watchYears,
      datasets: [{
        data: watchYears.map((y) => yearMap.get(y)),
        borderColor: "#22a094", backgroundColor: "#22a09433", fill: true, tension: 0.35,
        pointBackgroundColor: "#22a094", pointRadius: 4,
      }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 5) Countries (doughnut)
  const countryMap = countBy(ms, (m) => (m.country || "").split(",").map((c) => c.trim()));
  const countries = topEntries(countryMap, 9);
  const othersCount = [...countryMap.values()].reduce((a, b) => a + b, 0) - countries.reduce((a, [, v]) => a + v, 0);
  const cLabels = countries.map(([k]) => k).concat(othersCount > 0 ? ["Other"] : []);
  const cData = countries.map(([, v]) => v).concat(othersCount > 0 ? [othersCount] : []);
  charts.push(new Chart(add("Countries", "", "chCountry"), {
    type: "doughnut",
    data: { labels: cLabels, datasets: [{ data: cData, backgroundColor: T.palette, borderColor: T.sliceBorder, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: T.text, boxWidth: 12 } } }, cutout: "58%" },
  }));

  // 6) Top directors
  const dirMap = countBy(ms, (m) => (m.director || "").split(",")[0].trim());
  const dirs = topEntries(dirMap, 10);
  charts.push(new Chart(add("Top directors", "wide", "chDirectors"), {
    type: "bar",
    data: {
      labels: dirs.map(([k]) => k),
      datasets: [{ data: dirs.map(([, v]) => v), backgroundColor: "#d4217acc", borderColor: "#d4217a", borderWidth: 1, borderRadius: 4 }],
    },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: T.text, precision: 0 }, grid: { color: T.grid }, beginAtZero: true }, y: { ticks: { color: T.text }, grid: { display: false } } },
    }),
  }));

  // 7) Genres
  const genreMap = countBy(ms, (m) => (m.genre || "").split(",").map((g) => g.trim()));
  const genres = topEntries(genreMap, 8);
  charts.push(new Chart(add("Genres", "", "chGenres"), {
    type: "doughnut",
    data: { labels: genres.map(([k]) => k), datasets: [{ data: genres.map(([, v]) => v), backgroundColor: T.palette, borderColor: T.sliceBorder, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: T.text, boxWidth: 12 } } }, cutout: "58%" },
  }));

  // 8) Rating distribution (avg movie ratings 1..10)
  const dist = Array.from({ length: 10 }, () => 0);
  ms.forEach((m) => {
    const a = avgRate(m.rates);
    if (a > 0) dist[Math.min(9, Math.max(0, Math.round(a) - 1))]++;
  });
  charts.push(new Chart(add("Rating distribution", "", "chDist"), {
    type: "bar",
    data: {
      labels: dist.map((_, i) => `${i + 1}`),
      datasets: [{ data: dist, backgroundColor: dist.map((_, i) => i < 3 ? "#e05c66cc" : i < 6 ? "#e89518cc" : "#5f9e4acc"), borderWidth: 0, borderRadius: 4 }],
    },
    options: baseOpts({ plugins: { legend: { display: false } } }),
  }));

  // 9) Raters comparison
  const raterAvg = RATERS.map((r) => {
    const vals = ms.map((m) => m.rates?.[r.key]).filter((v) => Number(v) > 0);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0;
  });
  const raterCount = RATERS.map((r) => ms.filter((m) => Number(m.rates?.[r.key]) > 0).length);
  charts.push(new Chart(add("Raters comparison", "", "chRaters"), {
    type: "bar",
    data: {
      labels: RATERS.map((r) => r.name),
      datasets: [
        { label: "avg rating", data: raterAvg.map((v) => +v.toFixed(2)), backgroundColor: RATERS.map((r) => r.color + "cc"), borderRadius: 4, borderWidth: 1 },
      ],
    },
    options: baseOpts({
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `rated ${raterCount[c.dataIndex]} movies` } } },
      scales: { x: { ticks: { color: T.text }, grid: { display: false } }, y: { suggestedMin: 0, suggestedMax: 10, ticks: { color: T.text }, grid: { color: T.grid } } },
    }),
  }));

  // 10) Top 10 movies
  const top = ms.filter((m) => avgRate(m.rates) > 0).sort((a, b) => avgRate(b.rates) - avgRate(a.rates)).slice(0, 10).reverse();
  charts.push(new Chart(add("Top 10 movies", "wide", "chTop"), {
    type: "bar",
    data: {
      labels: top.map((m) => `${m.title}${m.year ? ` (${m.year})` : ""}`),
      datasets: [{ data: top.map((m) => +avgRate(m.rates).toFixed(2)), backgroundColor: "#d9a916cc", borderColor: "#d9a916", borderWidth: 1, borderRadius: 4 }],
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
