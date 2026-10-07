// ============================================================
// Вкладка «Статистика»: огляд, топ фільмів, розподіл оцінок,
// десятиліття, режисери, профілі глядачів
// ============================================================

import { USERS } from './config.js';
import * as U from './utils.js';
import { icons } from './ui.js';

export function mount(container, filmsArr) {
  if (filmsArr === null) {
    container.innerHTML = `
      <div class="state-box slim">
        <span class="state-icon">${icons.chart}</span>
        <h3>Завантаження даних…</h3>
      </div>`;
    return;
  }
  const s = compute(filmsArr);
  container.innerHTML = template(s);
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
  const topFilms = [...ratedFilms].sort((x, y) => y.a - x.a || y.n - x.n).slice(0, 5);

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

  const directors = {};
  filmRows.forEach(({ f, a }) => {
    const d = String(f.director || '').trim();
    if (!d) return;
    const o = directors[d] || (directors[d] = { count: 0, sum: 0, cnt: 0 });
    o.count++;
    if (a != null) { o.sum += a; o.cnt++; }
  });
  const topDirectors = Object.entries(directors)
    .map(([name, o]) => ({ name, count: o.count, avg: o.cnt ? o.sum / o.cnt : null }))
    .sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0))
    .slice(0, 5);

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

  return {
    films, totalRatings, overallAvg, topFilms, ratedCount: ratedFilms.length,
    dist, decadeRows, topDirectors, userStats, activeUser, strict, generous
  };
}

function template(s) {
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

  const tiles = `
    <div class="tiles">
      <div class="tile"><span class="tile-value">${s.films.length}</span><span class="tile-label">${U.pluralFilms(s.films.length)}</span></div>
      <div class="tile"><span class="tile-value">${s.totalRatings}</span><span class="tile-label">${s.totalRatings} ${U.pluralRatingsGen(s.totalRatings)} поставлено</span></div>
      <div class="tile"><span class="tile-value">${U.fmtAvg(s.overallAvg)}</span><span class="tile-label">середня оцінка</span></div>
      <div class="tile"><span class="tile-value tile-user">${s.activeUser ? `<i class="ava-dot" style="background:${s.activeUser.color}"></i>${U.escapeHtml(s.activeUser.name)}` : '—'}</span><span class="tile-label">найактивніший глядач</span></div>
    </div>`;

  const topFilms = s.ratedCount === 0 ? '' : `
    <section class="panel">
      <h3 class="panel-title">Топ-${Math.min(5, s.ratedCount)} фільмів</h3>
      <div class="bars">
        ${s.topFilms.map((r, i) => `
          <div class="brow">
            <span class="brow-label" title="${U.escapeHtml(r.f.titleUk || r.f.title || '')}">${i + 1}. ${U.escapeHtml(r.f.titleUk || r.f.title || 'Без назви')}</span>
            <span class="bar"><i style="width:${(r.a * 10).toFixed(0)}%; background:${U.ratingColor(r.a)}"></i></span>
            <span class="brow-value">${U.fmtAvg(r.a)}<small> · ${r.n}</small></span>
          </div>`).join('')}
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
      <h3 class="panel-title">Топ режисерів</h3>
      <div class="bars">
        ${s.topDirectors.map(d => `
          <div class="brow">
            <span class="brow-label" title="${U.escapeHtml(d.name)}">${U.escapeHtml(d.name)}</span>
            <span class="bar"><i style="width:${Math.round(d.count / s.topDirectors[0].count * 60)}%; background:var(--accent)"></i></span>
            <span class="brow-value">${d.count} ${U.pluralFilms(d.count)}<small>${d.avg != null ? ` · сер. ${U.fmtAvg(d.avg)}` : ''}</small></span>
          </div>`).join('')}
      </div>
    </section>`;

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

  return `${tiles}${topFilms}${distPanel}${decadesPanel}${directorsPanel}${viewers}`;
}
