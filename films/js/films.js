// ============================================================
// Вкладка «Фільми»: сітка карток, пошук/сортування, модальне
// вікно фільму з оцінками 1–10
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { openFormModal } from './film-form.js';

let container = null;
let gridEl = null;
let filmsList = [];
let isLoading = true;
let loadError = null;
let query = '';
let sort = localStorage.getItem('films_sort') || 'new';
let currentUserId = null;
let detailState = null; // { overlay, box, filmId, close }

// ---------- Публічний інтерфейс ----------

export function mount(el) {
  container = el;
  buildSkeleton();
  refreshGrid();
}

export function setFilms(list) {
  if (list === null) { isLoading = true; }
  else { isLoading = false; filmsList = list; loadError = null; }
  refreshGrid();
  refreshDetail();
}

export function setError(err) {
  loadError = err;
  refreshGrid();
}

export function setUser(userId) {
  if (currentUserId === userId) return;
  currentUserId = userId;
  refreshGrid();
  refreshDetail();
}

export function openAdd() {
  openFormModal({ film: null, currentUserId, allFilms: filmsList });
}

// ---------- Каркас вкладки ----------

function buildSkeleton() {
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'filmSearch' && container.contains(document.activeElement);
  const caret = wasSearchFocused ? document.activeElement.selectionStart : 0;

  container.innerHTML = `
    <div class="view-head">
      <div class="search-wrap">
        ${icons.search}
        <input id="filmSearch" type="search" placeholder="Пошук за назвою або режисером…"
               value="${U.escapeHtml(query)}" aria-label="Пошук фільмів">
      </div>
      <select id="filmSort" class="sort-select" aria-label="Сортування">
        <option value="new">Спочатку нові</option>
        <option value="old">Спочатку старі</option>
        <option value="rating">За рейтингом</option>
        <option value="year">За роком</option>
        <option value="title">За назвою (А–Я)</option>
      </select>
      <button class="btn primary add-btn" id="addBtn">${icons.plus}<span>Додати фільм</span></button>
    </div>
    <div id="filmsGrid" class="grid"></div>`;

  gridEl = container.querySelector('#filmsGrid');
  const sortEl = container.querySelector('#filmSort');
  sortEl.value = sort;
  sortEl.addEventListener('change', () => {
    sort = sortEl.value;
    localStorage.setItem('films_sort', sort);
    refreshGrid();
  });
  container.querySelector('#filmSearch').addEventListener('input', U.debounce((e) => {
    query = e.target.value;
    refreshGrid();
  }, 200));
  container.querySelector('#addBtn').addEventListener('click', openAdd);

  gridEl.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const card = e.target.closest('.card');
    if (!card) return;
    const film = filmsList.find(f => f.id === card.dataset.id);
    if (!film) return;
    if (editBtn) {
      openFormModal({ film, currentUserId, allFilms: filmsList });
    } else {
      openDetail(film.id);
    }
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.card');
    if (card && e.target === card) openDetail(card.dataset.id);
  });

  if (wasSearchFocused) {
    const inp = container.querySelector('#filmSearch');
    inp.focus();
    try { inp.setSelectionRange(caret, caret); } catch (e) {}
  }
}

// ---------- Фільтрація і сортування ----------

function filtered() {
  const q = query.trim().toLowerCase();
  let list = filmsList;
  if (q) {
    list = list.filter(f => [f.title, f.titleUk, f.director]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }
  const withAvg = f => { const a = U.avg(f.ratings); return a == null ? -1 : a; };
  switch (sort) {
    case 'old': return [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case 'rating': return [...list].sort((a, b) => withAvg(b) - withAvg(a));
    case 'year': return [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'title': return [...list].sort((a, b) => String(a.titleUk || a.title || '').localeCompare(String(b.titleUk || b.title || ''), 'uk'));
    default: return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

// ---------- Сітка ----------

function refreshGrid() {
  if (!gridEl) return;

  if (loadError) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon err">${icons.alert}</span>
        <h3>Не вдалося завантажити фільми</h3>
        <p>Перевірте зʼєднання та правила доступу Firebase Realtime Database.</p>
        <button class="btn primary" onclick="location.reload()">Спробувати знову</button>
      </div>`;
    return;
  }

  if (isLoading) {
    gridEl.innerHTML = Array.from({ length: 6 }, () => `
      <div class="card skeleton-card">
        <div class="poster skeleton"></div>
        <div class="card-body">
          <div class="skeleton sk-line w-70"></div>
          <div class="skeleton sk-line w-45"></div>
          <div class="skeleton sk-line w-55"></div>
          <div class="skeleton sk-line w-80"></div>
        </div>
      </div>`).join('');
    return;
  }

  if (!filmsList.length && !query.trim()) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon">${icons.clapper}</span>
        <h3>Поки що немає жодного фільму</h3>
        <p>Додайте перший фільм — почніть вводити назву, і ми підтягнемо постер та деталі з IMDb.</p>
        <button class="btn primary" id="emptyAdd">${icons.plus}<span>Додати фільм</span></button>
      </div>`;
    gridEl.querySelector('#emptyAdd').addEventListener('click', openAdd);
    return;
  }

  const list = filtered();
  if (!list.length) {
    gridEl.innerHTML = `
      <div class="state-box slim">
        <span class="state-icon">${icons.search}</span>
        <h3>Нічого не знайдено</h3>
        <p>Спробуйте змінити запит «${U.escapeHtml(query.trim())}».</p>
      </div>`;
    return;
  }

  gridEl.innerHTML = list.map(cardHTML).join('');
}

function cardHTML(f) {
  const a = U.avg(f.ratings);
  const my = (f.ratings || {})[currentUserId];
  const mainTitle = f.titleUk || f.title || 'Без назви';
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  const metaBits = [f.year, f.runtime ? `${f.runtime} хв` : ''].filter(Boolean).join(' · ');
  const dir = f.director ? `реж. ${f.director}` : '';
  const metaLine = [dir, metaBits].filter(Boolean).join(' · ');

  const ratedCount = Object.keys(f.ratings || {}).length;
  const votes = ratedCount
    ? `<span class="votes">${ratedCount} ${U.pluralRatings(ratedCount)}</span>`
    : `<span class="votes none">без оцінок</span>`;

  const friendChips = USERS
    .filter(u => (f.ratings || {})[u.id] != null)
    .map(u => `<span class="fchip" title="${U.escapeHtml(u.name)}: ${f.ratings[u.id]}"><i style="background:${u.color}"></i>${f.ratings[u.id]}</span>`)
    .join('');

  return `
  <article class="card" data-id="${f.id}" tabindex="0" role="button" aria-label="${U.escapeHtml(mainTitle)}">
    <div class="poster">
      ${f.poster ? `<img src="${U.escapeHtml(U.posterUrl(f.poster, 240))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${icons.film}
      ${f.year ? `<span class="year-badge">${f.year}</span>` : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${U.escapeHtml(mainTitle)}</h3>
      ${orig ? `<div class="card-sub">${U.escapeHtml(orig)}</div>` : ''}
      ${metaLine ? `<div class="card-meta">${U.escapeHtml(metaLine)}</div>` : ''}
      <div class="rating-row">
        ${a != null
          ? `<span class="avg-badge" style="background:${U.ratingColor(a)}">${U.fmtAvg(a)}</span>${votes}`
          : votes}
        <button class="rate-btn ${my != null ? 'rated' : ''}" data-rate aria-label="Оцінити фільм">
          ${icons.star}<span>${my != null ? my : 'Оцінити'}</span>
        </button>
      </div>
      ${friendChips ? `<div class="fchips">${friendChips}</div>` : ''}
    </div>
    <button class="icon-btn card-edit" data-edit aria-label="Редагувати фільм" title="Редагувати">${icons.edit}</button>
  </article>`;
}

// ---------- Модальне вікно фільму ----------

function openDetail(filmId) {
  const film = filmsList.find(f => f.id === filmId);
  if (!film) return;
  const { overlay, box, close } = openModal(detailHTML(film), {
    width: 780,
    label: fTitle(film)
  });
  detailState = { overlay, box, filmId, close };
  wireDetail(box);
}

function fTitle(f) { return f.titleUk || f.title || 'Без назви'; }

function detailHTML(f) {
  const a = U.avg(f.ratings);
  const my = (f.ratings || {})[currentUserId];
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  const metaBits = [f.year, f.runtime ? `${f.runtime} хв` : '', f.director ? `реж. ${f.director}` : ''].filter(Boolean).join(' · ');
  const genres = (f.genres || []).map(g => `<span class="genre-chip">${U.escapeHtml(g)}</span>`).join('');

  const chips = Array.from({ length: 10 }, (_, i) => {
    const s = i + 1;
    return `<button class="rate-chip ${my === s ? 'active' : ''}" data-score="${s}" style="--c:${U.ratingColor(s)}" aria-label="Оцінка ${s}">${s}</button>`;
  }).join('');

  const friendRows = USERS.map(u => {
    const v = (f.ratings || {})[u.id];
    return `<li class="f-row">
      <span class="avatar sm" style="background:${u.color}">${U.escapeHtml(U.initial(u.name))}</span>
      <span class="f-name">${U.escapeHtml(u.name)}</span>
      ${v != null
        ? `<span class="f-score" style="background:${U.ratingColor(v)}">${v}</span>`
        : `<span class="f-score empty">—</span>`}
    </li>`;
  }).join('');

  const adder = USERS.find(u => u.id === f.addedBy);
  const addedLine = f.addedBy
    ? `Додав${adder ? '' : ' користувач'}: <b>${U.escapeHtml(adder ? adder.name : f.addedBy)}</b>${f.createdAt ? ' · ' + U.fmtDate(f.createdAt) : ''}`
    : '';

  return `
  <div class="modal-head">
    <h2 class="detail-heading">${U.escapeHtml(fTitle(f))}</h2>
    <button class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
  </div>
  <div class="detail-grid">
    <div class="detail-poster">
      ${f.poster ? `<img src="${U.escapeHtml(U.posterUrl(f.poster, 400))}" alt="Постер: ${U.escapeHtml(fTitle(f))}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${icons.film}
    </div>
    <div class="detail-info">
      ${orig ? `<div class="detail-orig">${U.escapeHtml(orig)}</div>` : ''}
      ${metaBits ? `<div class="detail-meta">${U.escapeHtml(metaBits)}</div>` : ''}
      ${genres ? `<div class="genre-row">${genres}</div>` : ''}
      ${f.plot ? `<p class="detail-plot">${U.escapeHtml(f.plot)}</p>` : ''}
      <div class="detail-links">
        ${f.imdbId ? `<a class="imdb-link" href="https://www.imdb.com/title/${U.escapeHtml(f.imdbId)}/" target="_blank" rel="noopener">${icons.link}<span>Переглянути на IMDb</span></a>` : ''}
        ${addedLine ? `<span class="added-line">${addedLine}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="detail-ratings">
    <div class="dr-head">
      <h3>Оцінки</h3>
      ${a != null ? `<span class="avg-big" style="background:${U.ratingColor(a)}">${U.fmtAvg(a)}</span>` : ''}
    </div>
    <div class="my-rating">
      <span class="my-rating-label">Ваша оцінка:</span>
      <div class="chips-row" role="group" aria-label="Ваша оцінка від 1 до 10">${chips}</div>
      ${my != null ? `<button class="remove-rating" data-remove-rating>Прибрати мою оцінку</button>` : ''}
    </div>
    <ul class="friends-list">${friendRows}</ul>
  </div>
  <div class="modal-footer between">
    <button class="btn danger-ghost" data-act="delete">${icons.trash}<span>Видалити</span></button>
    <button class="btn" data-act="edit">${icons.edit}<span>Редагувати</span></button>
  </div>`;
}

function wireDetail(box) {
  box.addEventListener('click', async (e) => {
    const film = filmsList.find(f => f.id === detailState.filmId);
    if (!film) return;

    const chip = e.target.closest('.rate-chip');
    if (chip) {
      if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
      const score = +chip.dataset.score;
      const cur = (film.ratings || {})[currentUserId];
      const next = (cur === score) ? null : score; // повторний клік прибирає оцінку
      try {
        await store.setRating(film.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}`);
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
      }
      return;
    }

    if (e.target.closest('[data-remove-rating]')) {
      try {
        await store.setRating(film.id, currentUserId, null);
        toast('Оцінку прибрано');
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
      }
      return;
    }

    if (e.target.closest('[data-act="edit"]')) {
      detailState.close();
      openFormModal({ film, currentUserId, allFilms: filmsList });
      return;
    }

    if (e.target.closest('[data-act="delete"]')) {
      const ok = await confirmDialog({
        title: 'Видалити фільм?',
        text: `«${fTitle(film)}» та всі його оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteFilm(film.id);
        toast('Фільм видалено');
        detailState.close();
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити фільм', 'err');
      }
    }
  });
}

// Оновлює відкрите вікно фільму, коли дані змінилися
// (хтось оцінив, змінився профіль тощо). Слухач подій на box
// живе до закриття, тож повторно навішувати його не треба.
function refreshDetail() {
  if (!detailState) return;
  const { overlay, box, filmId, close } = detailState;
  if (!document.body.contains(overlay)) { detailState = null; return; }
  const film = filmsList.find(f => f.id === filmId);
  if (!film) { close(); detailState = null; return; }
  box.innerHTML = detailHTML(film);
}
