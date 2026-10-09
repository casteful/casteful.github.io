// ============================================================
// Вкладка «Статистика»: огляд, топ-10 фільмів, розподіл оцінок,
// десятиліття (к-ть і середня), роки випуску, режисери (к-ть і
// середня), жанри, країни, актори, хронометраж, рекорди, сезони
// та активність переглядів, профілі глядачів, порівняння учасників.
// Рядки з фільмами/людьми/жанрами клікабельні:
//   onFilter(name)  -> відкрити «Фільми» з пошуком за цим значенням
//   onOpenFilm(id)  -> відкрити вікно фільму (панель «Рекорди»)
// ============================================================

import { USERS } from './config.js';
import * as U from './utils.js';
import { icons } from './ui.js';

export function mount(container, filmsArr, handlers = {}) {
  if (filmsArr === null) {
    container.innerHTML = `
      <div class="state-box slim">
        <span class="state-icon">${icons.chart}</span>
        <h3>Завантаження даних…</h3>
      </div>`;
    return;
  }
  const s = compute(filmsArr);

  // Оновлення даних не має «стрибати» — зберігаємо позицію прокрутки
  const y = window.scrollY;
  container.innerHTML = template(s, handlers);
  window.scrollTo({ top: y, behavior: 'instant' });

  wire(container, handlers);
}

function compute(films) {
  const ratingEntries = [];
  films.forEach(f => {
    Object.entries(f.ratings || {}).forEach(([u, v]) => {
      if (typeof v === 'number' && !Number.isNaN(v)) ratingEntries.push({ u, v });
    });
  });

  const totalRatings = ratingEntries.length;
  const overallAvg = totalRatings ? ratingEntries.reduce((s, r) => s + r.v, 0) / totalRatings : null;

  const filmRows = films.map(f => ({
    f,
    a: U.avg(f.ratings),
    n: Object.keys(f.ratings || {}).length
  }));
  const ratedFilms = filmRows.filter(r => r.a != null);
  const topFilms = [...ratedFilms].sort((x, y) => y.a - x.a || y.n - x.n).slice(0, 10);

  const dist = Array(10).fill(0);
  ratingEntries.forEach(r => { dist[Math.min(10, Math.max(1, r.v)) - 1]++; });

  const decades = {};
  films.forEach(f => {
    if (f.year >= 1888 && f.year <= 2100) {
      const d = Math.floor(f.year / 10) * 10;
      decades[d] = (decades[d] || 0) + 1;
    }
  });
  const decadeRows = Object.entries(decades).map(([d, c]) => ({ d: +d, c })).sort((a, b) => a.d - b.d);

  // --- Люди та жанри: спільна агрегація (кількість + середня) ---
  const agg = (getKey) => {
    const acc = {};
    filmRows.forEach(({ f, a }) => {
      const keys = getKey(f);
      keys.forEach(k => {
        if (!k) return;
        const o = acc[k] || (acc[k] = { count: 0, sum: 0, cnt: 0 });
        o.count++;
        if (a != null) { o.sum += a; o.cnt++; }
      });
    });
    return Object.entries(acc)
      .map(([name, o]) => ({ name, count: o.count, avg: o.cnt ? o.sum / o.cnt : null }))
      .sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0));
  };

  const topDirectors = agg(f => [String(f.director || '').trim()]).slice(0, 5);
  // жанри двомовні (старі записи укр., нові англ.) — зводимо до англійської,
  // щоб «драма» і "drama" групувалися разом
  const topGenres = agg(f => (f.genres || []).map(U.genreEn)).slice(0, 6);
  const topCast = agg(f => f.cast || []).slice(0, 6);

  // --- Країни: кількість і середня оцінка (прим. P495, поле country) ---
  const countryList = f => String(f.country || '').split(',')
    .map(x => x.trim()).filter(Boolean);
  const countryRows = agg(countryList).slice(0, 8);
  const countryAvgRows = agg(countryList)
    .filter(r => r.avg != null)
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, 8);

  // --- Режисери/жанри за середньою оцінкою (потрібна хоч одна оцінка) ---
  const dirAvgRows = agg(f => [String(f.director || '').trim()])
    .filter(r => r.avg != null)
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, 8);
  const genreAvgRows = agg(f => (f.genres || []).map(U.genreEn))
    .filter(r => r.avg != null)
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, 8);

  // --- Середня оцінка за десятиліттями ---
  const decadeAgg = {};
  filmRows.forEach(({ f, a }) => {
    if (f.year < 1888 || f.year > 2100) return;
    const d = Math.floor(f.year / 10) * 10;
    const o = decadeAgg[d] || (decadeAgg[d] = { count: 0, sum: 0, cnt: 0 });
    o.count++;
    if (a != null) { o.sum += a; o.cnt++; }
  });
  const decadeAvgRows = Object.entries(decadeAgg)
    .map(([d, o]) => ({ d: +d, count: o.count, avg: o.cnt ? o.sum / o.cnt : null }))
    .filter(r => r.avg != null)
    .sort((a, b) => a.d - b.d);

  // --- Фільми за роком випуску (кожен рік окремо) ---
  const yearMap = {};
  films.forEach(f => {
    if (f.year >= 1888 && f.year <= 2100) yearMap[f.year] = (yearMap[f.year] || 0) + 1;
  });
  const yearRows = Object.entries(yearMap)
    .map(([y, c]) => ({ y: +y, c }))
    .sort((a, b) => a.y - b.y);

  // --- Коли ми дивилися: дата = момент додавання до списку ---
  const watchTs = f => f.createdAt || f.updatedAt || null;
  const SEASONS = [
    { name: 'Зима', months: [11, 0, 1] },
    { name: 'Весна', months: [2, 3, 4] },
    { name: 'Літо', months: [5, 6, 7] },
    { name: 'Осінь', months: [8, 9, 10] }
  ];
  const seasonRows = SEASONS.map(s => ({
    name: s.name,
    c: films.filter(f => {
      const ts = watchTs(f);
      return ts != null && s.months.includes(new Date(ts).getMonth());
    }).length
  })).filter(r => r.c > 0);

  const activityMap = {};
  films.forEach(f => {
    const ts = watchTs(f);
    if (!ts) return;
    const y = new Date(ts).getFullYear();
    if (y >= 2000 && y <= 2100) activityMap[y] = (activityMap[y] || 0) + 1;
  });
  const activityRows = Object.entries(activityMap)
    .map(([y, c]) => ({ y: +y, c }))
    .sort((a, b) => a.y - b.y);

  // --- Хронометраж ---
  const withRt = films.filter(f => f.runtime > 0 && f.runtime <= 1200);
  const totalMin = withRt.reduce((s, f) => s + f.runtime, 0);
  const avgRt = withRt.length ? totalMin / withRt.length : null;
  const longest = withRt.length ? withRt.reduce((m, f) => f.runtime > m.runtime ? f : m) : null;

  // --- Рекорди ---
  const byAvgDesc = [...ratedFilms].sort((x, y) => y.a - x.a || y.n - x.n);
  const best = byAvgDesc[0] || null;
  const worst = byAvgDesc.length > 1 ? byAvgDesc[byAvgDesc.length - 1] : null;
  const mostRated = [...filmRows].sort((x, y) => y.n - x.n).find(r => r.n > 0) || null;
  // «Найсуперечливіший»: найбільший розкид оцінок (макс - мін), потрібно ≥3 голоси
  let controversy = null;
  filmRows.forEach(r => {
    const vals = Object.values(r.f.ratings || {}).filter(v => typeof v === 'number');
    if (vals.length < 3) return;
    const spread = Math.max(...vals) - Math.min(...vals);
    if (!controversy || spread > controversy.spread) controversy = { f: r.f, spread, a: r.a };
  });
  const dated = films.filter(f => f.year >= 1888 && f.year <= 2100);
  const oldest = dated.length ? { f: dated.reduce((m, f) => f.year < m.year ? f : m) } : null;
  const newest = dated.length ? { f: dated.reduce((m, f) => f.year > m.year ? f : m) } : null;

  // --- Глядачі ---
  const userStats = USERS.map(u => {
    const rs = ratingEntries.filter(r => r.u === u.id);
    const n = rs.length;
    const avgR = n ? rs.reduce((s, r) => s + r.v, 0) / n : null;
    const favRow = filmRows
      .filter(r => typeof (r.f.ratings || {})[u.id] === 'number')
      .sort((x, y) => y.f.ratings[u.id] - x.f.ratings[u.id])[0];
    return { ...u, n, avg: avgR, fav: favRow ? favRow.f : null };
  });

  const activeUser = [...userStats].filter(u => u.n > 0).sort((a, b) => b.n - a.n)[0] || null;
  const withTwo = userStats.filter(u => u.n >= 2 && u.avg != null);
  const strict = withTwo.length >= 2 ? [...withTwo].sort((a, b) => a.avg - b.avg)[0] : null;
  const generous = withTwo.length >= 2 ? [...withTwo].sort((a, b) => b.avg - a.avg)[0] : null;

  // --- Порівняння учасників: середня оцінка + розбіжність із групою.
  // Розбіжність (dev) — середнє |оцінка учасника − сер. фільму| лише по
  // фільмах із щонайменше двома оцінками (інакше «спільної» немає).
  const compareRows = userStats.map(u => {
    let devSum = 0, devCnt = 0;
    filmRows.forEach(({ f, a }) => {
      const v = (f.ratings || {})[u.id];
      if (a == null || typeof v !== 'number') return;
      if (Object.keys(f.ratings || {}).length < 2) return;
      devSum += Math.abs(v - a);
      devCnt++;
    });
    return { id: u.id, name: u.name, color: u.color, n: u.n, avg: u.avg,
             dev: devCnt ? devSum / devCnt : null };
  }).sort((a, b) => (b.avg != null) - (a.avg != null) || b.avg - a.avg || b.n - a.n);

  return {
    films, totalRatings, overallAvg, topFilms, ratedCount: ratedFilms.length,
    dist, decadeRows, topDirectors, topGenres, topCast,
    countryRows, countryAvgRows, dirAvgRows, genreAvgRows,
    decadeAvgRows, yearRows, seasonRows, activityRows, compareRows,
    totalMin, avgRt, longest,
    best, worst, mostRated, controversy, oldest, newest,
    userStats, activeUser, strict, generous
  };
}

function template(s, handlers) {
  if (!s.films.length && !s.totalRatings) {
    return `
      <div class="state-box">
        <span class="state-icon">${icons.chart}</span>
        <h3>Статистики ще немає</h3>
        <p>Тут зʼявиться статистика, коли ви додасте фільми та поставите оцінки.</p>
      </div>`;
  }

  const maxDist = Math.max(...s.dist, 1);
  const maxDecade = Math.max(...s.decadeRows.map(r => r.c), 1);
  const maxYear = Math.max(...s.yearRows.map(r => r.c), 1);
  const maxSeason = Math.max(...s.seasonRows.map(r => r.c), 1);
  const maxActivity = Math.max(...s.activityRows.map(r => r.c), 1);

  const tile = (icon, value, label, extraCls = '') => `
    <div class="tile">
      <span class="tile-icon">${icon}</span>
      <span class="tile-value ${extraCls}">${value}</span>
      <span class="tile-label">${label}</span>
    </div>`;

  const tiles = `
    <div class="tiles">
      ${tile(icons.clapper, s.films.length, U.pluralFilms(s.films.length))}
      ${tile(icons.star, s.totalRatings, `${s.totalRatings} ${U.pluralRatingsGen(s.totalRatings)} поставлено`)}
      ${tile(icons.chart, U.fmtAvg(s.overallAvg), 'середня оцінка')}
      ${tile(icons.clock, `${s.totalMin ? Math.round(s.totalMin / 60) : '—'}<small class="tile-unit">год</small>`, 'спільного кіночасу')}
      ${tile(icons.users, s.activeUser ? `<i class="ava-dot" style="background:${s.activeUser.color}"></i>${U.escapeHtml(s.activeUser.name)}` : '—', 'найактивніший глядач', 'tile-user')}
    </div>`;

  // Клікабельний рядок барами
  const browBtn = ({ label, sub, width, color, value, filter, title }) => `
    <button type="button" class="brow clickable" data-filter="${U.escapeHtml(filter || '')}" ${title ? `title="${U.escapeHtml(title)}"` : ''}>
      <span class="brow-label">${label}</span>
      <span class="bar"><i style="width:${width}%; ${color ? `background:${color};` : ''}"></i></span>
      <span class="brow-value">${value}</span>
    </button>`;

  const topFilms = s.ratedCount === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Топ-${Math.min(10, s.ratedCount)} фільмів</h3>
      <div class="bars">
        ${s.topFilms.map((r, i) => `
          <button type="button" class="brow clickable" data-open-film="${r.f.id}" title="${U.escapeHtml(r.f.titleUk || r.f.title || '')}">
            <span class="brow-label">${i + 1}. ${U.escapeHtml(r.f.titleUk || r.f.title || 'Без назви')}</span>
            <span class="bar"><i style="width:${(r.a * 10).toFixed(0)}%; background:${U.ratingColor(r.a)}"></i></span>
            <span class="brow-value">${U.fmtAvg(r.a)}<small> · ${r.n}</small></span>
          </button>`).join('')}
      </div>
    </section>`;

  const distPanel = s.totalRatings === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Розподіл оцінок</h3>
      <div class="hist">
        ${s.dist.map((c, i) => `
          <div class="hist-col" title="Оцінка ${i + 1}: ${c}">
            <span class="hist-count">${c || ''}</span>
            <i style="height:${c ? Math.max(6, Math.round(c / maxDist * 100)) : 2}%; background:${U.ratingColor(i + 1)}"></i>
            <span class="hist-num">${i + 1}</span>
          </div>`).join('')}
      </div>
    </section>`;

  const decadesPanel = s.decadeRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Фільми за десятиліттями</h3>
      <div class="bars">
        ${s.decadeRows.map(r => `
          <div class="brow">
            <span class="brow-label">${U.decadeLabel(r.d)}</span>
            <span class="bar"><i style="width:${Math.round(r.c / maxDecade * 100)}%"></i></span>
            <span class="brow-value">${r.c}</span>
          </div>`).join('')}
      </div>
    </section>`;

  const directorsPanel = s.topDirectors.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Топ режисерів <span class="panel-hint">— клікніть, щоб побачити фільми</span></h3>
      <div class="bars">
        ${s.topDirectors.map(d => browBtn({
          label: U.escapeHtml(d.name),
          title: `${d.name}: ${d.count} ${U.pluralFilms(d.count)}`,
          width: Math.round(d.count / s.topDirectors[0].count * 60),
          color: 'var(--accent)',
          value: `${d.count} ${U.pluralFilms(d.count)}<small>${d.avg != null ? ` · сер. ${U.fmtAvg(d.avg)}` : ''}</small>`,
          filter: d.name
        })).join('')}
      </div>
    </section>`;

  const genresPanel = s.topGenres.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Улюблені жанри</h3>
      <div class="bars">
        ${s.topGenres.map(g => browBtn({
          label: U.escapeHtml(g.name),
          title: `${g.name}: ${g.count} ${U.pluralFilms(g.count)}`,
          width: Math.round(g.count / s.topGenres[0].count * 60),
          color: 'var(--accent-2, var(--accent))',
          value: `${g.count}<small>${g.avg != null ? ` · сер. ${U.fmtAvg(g.avg)}` : ''}</small>`,
          filter: g.name
        })).join('')}
      </div>
    </section>`;

  const castPanel = s.topCast.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Найчастіші актори <span class="panel-hint">— клікніть, щоб побачити фільми</span></h3>
      <div class="bars">
        ${s.topCast.map(c => browBtn({
          label: U.escapeHtml(c.name),
          title: `${c.name}: ${c.count} ${U.pluralFilms(c.count)}`,
          width: Math.round(c.count / s.topCast[0].count * 60),
          color: 'var(--accent-2, var(--accent))',
          value: `${c.count}<small>${c.avg != null ? ` · сер. ${U.fmtAvg(c.avg)}` : ''}</small>`,
          filter: c.name
        })).join('')}
      </div>
    </section>`;

  // --- Нові панелі: країни, середні оцінки, роки/сезони, порівняння ---

  const countriesPanel = s.countryRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Країни <span class="panel-hint">— клікніть, щоб побачити фільми</span></h3>
      <div class="bars">
        ${s.countryRows.map(c => browBtn({
          label: U.escapeHtml(c.name),
          title: `${c.name}: ${c.count} ${U.pluralFilms(c.count)}`,
          width: Math.round(c.count / s.countryRows[0].count * 60),
          color: 'var(--accent-2, var(--accent))',
          value: `${c.count}<small>${c.avg != null ? ` · сер. ${U.fmtAvg(c.avg)}` : ''}</small>`,
          filter: c.name
        })).join('')}
      </div>
    </section>`;

  const avgBars = (rows, { filterable = false } = {}) => `
    <div class="bars">
      ${rows.map(r => {
        const inner = `
          <span class="brow-label">${U.escapeHtml(r.name)}</span>
          <span class="bar"><i style="width:${(r.avg * 10).toFixed(0)}%; background:${U.ratingColor(r.avg)}"></i></span>
          <span class="brow-value">${U.fmtAvg(r.avg)}<small> · ${r.count}</small></span>`;
        return filterable
          ? `<button type="button" class="brow clickable" data-filter="${U.escapeHtml(r.name)}" title="${U.escapeHtml(r.name)}: сер. ${U.fmtAvg(r.avg)} за ${r.count} ${U.pluralFilms(r.count)}">${inner}</button>`
          : `<div class="brow">${inner}</div>`;
      }).join('')}
    </div>`;

  const genreAvgPanel = s.genreAvgRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Середня оцінка за жанром</h3>
      ${avgBars(s.genreAvgRows, { filterable: true })}
    </section>`;

  const countryAvgPanel = s.countryAvgRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Середня оцінка за країною</h3>
      ${avgBars(s.countryAvgRows)}
    </section>`;

  const dirAvgPanel = s.dirAvgRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Режисери за середньою оцінкою</h3>
      ${avgBars(s.dirAvgRows, { filterable: true })}
    </section>`;

  const decadeAvgPanel = s.decadeAvgRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Середня оцінка за десятиліттями</h3>
      <div class="bars">
        ${s.decadeAvgRows.map(r => `
          <div class="brow">
            <span class="brow-label">${U.decadeLabel(r.d)}</span>
            <span class="bar"><i style="width:${(r.avg * 10).toFixed(0)}%; background:${U.ratingColor(r.avg)}"></i></span>
            <span class="brow-value">${U.fmtAvg(r.avg)}<small> · ${r.count}</small></span>
          </div>`).join('')}
      </div>
    </section>`;

  const yearPanel = s.yearRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Фільми за роком випуску</h3>
      <div class="bars scrollable">
        ${s.yearRows.map(r => `
          <div class="brow">
            <span class="brow-label">${r.y}</span>
            <span class="bar"><i style="width:${Math.round(r.c / maxYear * 100)}%"></i></span>
            <span class="brow-value">${r.c}</span>
          </div>`).join('')}
      </div>
    </section>`;

  const seasonsPanel = s.seasonRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Фільми за сезонами <span class="panel-hint">— коли ми їх дивилися</span></h3>
      <div class="bars">
        ${s.seasonRows.map(r => `
          <div class="brow">
            <span class="brow-label">${r.name}</span>
            <span class="bar"><i style="width:${Math.round(r.c / maxSeason * 60)}%"></i></span>
            <span class="brow-value">${r.c}</span>
          </div>`).join('')}
      </div>
    </section>`;

  const activityPanel = s.activityRows.length === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Активність переглядів <span class="panel-hint">— за роками</span></h3>
      <div class="bars">
        ${s.activityRows.map(r => `
          <div class="brow">
            <span class="brow-label">${r.y}</span>
            <span class="bar"><i style="width:${Math.round(r.c / maxActivity * 100)}%"></i></span>
            <span class="brow-value">${r.c}</span>
          </div>`).join('')}
      </div>
    </section>`;

  const comparePanel = s.compareRows.some(r => r.n > 0) ? `
    <section class="panel">
      <h3 class="panel-title">Порівняння учасників</h3>
      <div class="bars">
        ${s.compareRows.filter(r => r.n > 0).map(r => `
          <div class="brow">
            <span class="brow-label"><i class="ava-dot" style="background:${r.color}"></i>${U.escapeHtml(r.name)}</span>
            <span class="bar"><i style="width:${(r.avg * 10).toFixed(0)}%; background:${U.ratingColor(r.avg)}"></i></span>
            <span class="brow-value">${U.fmtAvg(r.avg)}<small>${r.dev != null ? ` · ±${U.fmtAvg(r.dev)}` : ''}</small></span>
          </div>`).join('')}
      </div>
      <p class="duo-note">± — середня розбіжність із спільною оцінкою фільму: менше значення — частіше згодні з групою.</p>
    </section>` : '';

  const runtimePanel = `
    <section class="panel">
      <h3 class="panel-title">Хронометраж</h3>
      <div class="mini-tiles">
        <div class="mini-tile"><span class="mt-value">${s.avgRt ? Math.round(s.avgRt) : '—'}<small> хв</small></span><span class="mt-label">середня тривалість</span></div>
        <div class="mini-tile"><span class="mt-value">${s.longest ? s.longest.runtime : '—'}<small> хв</small></span><span class="mt-label">найдовший${s.longest ? ` — «${U.escapeHtml(U.trunc(s.longest.titleUk || s.longest.title || '', 26))}»` : ''}</span></div>
        <div class="mini-tile"><span class="mt-value">${s.totalMin ? Math.round(s.totalMin / 60) : '—'}<small> год</small></span><span class="mt-label">разом переглянуто</span></div>
      </div>
    </section>`;

  const rec = (label, row, extra = '') => row
    ? `<button type="button" class="rec-row clickable" data-open-film="${row.f.id}">
         <span class="rec-icon">${extra}</span>
         <span class="rec-text"><b>${label}:</b> «${U.escapeHtml(U.trunc(row.f.titleUk || row.f.title || '', 40))}»<small>${recSub(label, row)}</small></span>
       </button>`
    : '';
  const recSub = (label, row) => {
    switch (label) {
      case 'Найкращий': return `сер. ${U.fmtAvg(row.a)} · ${row.n} ${U.pluralRatingsGen(row.n)}`;
      case 'Найгірший': return `сер. ${U.fmtAvg(row.a)} · ${row.n} ${U.pluralRatingsGen(row.n)}`;
      case 'Найсуперечливіший': return `розкид оцінок ${row.spread} балів`;
      case 'Найдавніший': return row.f.year || '';
      case 'Найновіший': return row.f.year || '';
      case 'Найбільше обговорений': return `${row.n} ${U.pluralRatingsGen(row.n)}`;
      default: return '';
    }
  };

  const records = [s.best, s.mostRated, s.controversy, s.oldest, s.newest, s.worst].some(Boolean) ? `
    <section class="panel">
      <h3 class="panel-title">Рекорди нашого клубу</h3>
      <div class="rec-list">
        ${rec('Найкращий', s.best, icons.trophy)}
        ${rec('Найгірший', s.worst, icons.thumbDown)}
        ${rec('Найсуперечливіший', s.controversy, icons.flame)}
        ${rec('Найбільше обговорений', s.mostRated, icons.users)}
        ${rec('Найдавніший', s.oldest, icons.clock)}
        ${rec('Найновіший', s.newest, icons.spark)}
      </div>
    </section>` : '';

  const viewers = `
    <section class="panel">
      <h3 class="panel-title">Наші глядачі</h3>
      <div class="u-cards">
        ${s.userStats.map(u => `
          <div class="u-card ${u.n === 0 ? 'inactive' : ''}">
            <span class="avatar lg" style="background:${u.color}">${U.escapeHtml(U.initial(u.name))}</span>
            <span class="u-name">${U.escapeHtml(u.name)}</span>
            <span class="u-avg" style="color:${u.avg != null ? U.ratingColor(u.avg) : 'inherit'}">${u.avg != null ? U.fmtAvg(u.avg) : '—'}</span>
            <span class="u-sub">${u.n ? `${u.n} ${U.pluralRatingsGen(u.n)}` : 'ще не оцінював'}</span>
            <span class="u-fav" title="${u.fav ? U.escapeHtml(u.fav.titleUk || u.fav.title || '') : ''}">
              ${u.fav ? `Улюблений: «${U.escapeHtml(U.trunc(u.fav.titleUk || u.fav.title || '', 34))}»` : ''}
            </span>
          </div>`).join('')}
      </div>
      ${s.strict && s.generous && s.strict.id !== s.generous.id ? `
        <p class="duo-note">
          Найсуворіший критик — <b>${U.escapeHtml(s.strict.name)}</b> (сер. ${U.fmtAvg(s.strict.avg)}) ·
          Найщедріший глядач — <b>${U.escapeHtml(s.generous.name)}</b> (сер. ${U.fmtAvg(s.generous.avg)})
        </p>` : ''}
    </section>`;

  return `${tiles}${records}${topFilms}${genresPanel}${genreAvgPanel}${countriesPanel}${countryAvgPanel}${directorsPanel}${dirAvgPanel}${castPanel}${distPanel}${decadesPanel}${decadeAvgPanel}${yearPanel}${seasonsPanel}${activityPanel}${runtimePanel}${viewers}${comparePanel}`;
}

// Клікабельні рядки: фільтр за людиною/жанром або відкриття фільму.
// ВАЖЛИВО: mount() викликається на кожне оновлення даних з бази,
// тому слухач вішаємо РІВНО ОДИН раз — інакше кліки накопичувались
// і вікно фільму відкривалось кілька разів підряд (баг «треба 3 рази
// закрити»). Контейнер завжди один і той самий (#view).
function wire(container, handlers) {
  if (container._statsWired) return;
  container._statsWired = true;
  container.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open-film]');
    if (openBtn && typeof handlers.onOpenFilm === 'function') {
      handlers.onOpenFilm(openBtn.dataset.openFilm);
      return;
    }
    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn && typeof handlers.onFilter === 'function') {
      const q = filterBtn.dataset.filter;
      if (q) handlers.onFilter(q);
    }
  });
}
