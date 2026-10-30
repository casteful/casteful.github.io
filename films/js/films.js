// ============================================================
// Вкладка «Фільми»: сітка карток АБО таблиця, пошук/сортування,
// модальне вікно фільму з оцінками 1–10
// ============================================================

import { USERS } from './config.js?v=6.4.1';
import * as store from './store.js?v=6.4.1';
import * as U from './utils.js?v=6.4.1';
import * as A from './avatars.js?v=6.4.1';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=6.4.1';
import { rateTrailHTML, paintTrail, popValue, openRatePop as openRatePopShared } from './rating-ui.js?v=6.4.1';
import { openFormModal } from './film-form.js?v=6.4.1';
import { notifyRatingSet, notifyRatingRemoved, notifyFilmDeleted } from './telegram.js?v=6.4.1';

let container = null;
let gridEl = null;
let filmsList = [];       // УСІ записи з бази (фільми + серіали)
let isLoading = true;
let loadError = null;
// Активний режим вкладки: 'films' — лише фільми, 'series' — лише серіали.
// Пошук/сортування/вигляд у кожного режиму СВОЇ (окремі ключі localStorage).
let mode = 'films';
let query = '';
let sort = localStorage.getItem('films_sort') || 'new';
let view = localStorage.getItem('films_view') === 'table' ? 'table' : 'grid'; // сітка або таблиця
let friendId = localStorage.getItem('films_sortfriend') || null; // сортування «За оцінкою друга»
let friendDir = localStorage.getItem('films_sortdir') === 'asc' ? 'asc' : 'desc';
let currentUserId = null;
let detailState = null; // { overlay, box, filmId, close }

// Ключі localStorage з урахуванням режиму: у «Серіалів» свій пошук,
// сортування і вигляд — незалежно від вкладки «Фільми»
function lsKey(base) { return mode === 'series' ? base + '_series' : base; }

function loadModeState() {
  query = '';
  sort = localStorage.getItem(lsKey('films_sort')) || 'new';
  view = localStorage.getItem(lsKey('films_view')) === 'table' ? 'table' : 'grid';
  friendId = localStorage.getItem(lsKey('films_sortfriend')) || null;
  friendDir = localStorage.getItem(lsKey('films_sortdir')) === 'asc' ? 'asc' : 'desc';
  friendId = friendId || (USERS.find(u => u.id !== currentUserId) || USERS[0] || {}).id || null;
}

function isSeriesItem(f) { return f && f.kind === 'series'; }

// ---------- Публічний інтерфейс ----------

export function mount(el, m = 'films') {
  const modeChanged = m !== mode;
  mode = m === 'series' ? 'series' : 'films';
  if (modeChanged) loadModeState();
  if (!friendId) {
    const other = USERS.find(u => u.id !== currentUserId) || USERS[0];
    friendId = other ? other.id : null;
  }
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
  openFormModal({ film: null, currentUserId, allFilms: filmsList, kind: mode });
}

// Зовнішній фільтр (клік на режисера/актора/жанр у статистиці чи картці).
// Спочатку клікнуто поза вкладкою «Фільми» — просимо app.js її переключити.
export function setFilter(q) {
  query = String(q || '');
  if (!document.getElementById('filmSearch') || !container.contains(document.getElementById('filmSearch'))) {
    // Вкладку ще не змонтовано — просимо app.js переключити її в ПОТОЧНОМУ
    // режимі (фільми/серіали), а потім застосувати фільтр
    document.dispatchEvent(new CustomEvent('films:filter', { detail: { q: String(q || ''), mode } }));
    return;
  }
  const inp = document.getElementById('filmSearch');
  inp.value = query;
  // На дотик-пристроях не фокусуємо поле програмно — інакше iOS/Android
  // розкривають клавіатуру поверх щойно відфільтрованого списку
  if (!window.matchMedia('(pointer: coarse)').matches) inp.focus();
  refreshGrid();
}

// Відкрити фільм за id (наприклад, з панелі «Рекорди» у статистиці).
// Список фільмів актуальний — app.js оновлює його навіть поза вкладкою.
export function openFilmById(filmId) {
  if (filmsList.some(f => f.id === filmId)) openDetail(filmId);
}

// ---------- Каркас вкладки ----------

function buildSkeleton() {
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'filmSearch' && container.contains(document.activeElement);
  const caret = wasSearchFocused ? document.activeElement.selectionStart : 0;
  const isSeries = mode === 'series';
  const noun = isSeries ? 'серіал' : 'фільм';
  const nounAcc = isSeries ? 'серіал' : 'фільм'; // родовий/знахідний для кнопок

  container.innerHTML = `
    <div class="view-head">
      <div class="search-wrap">
        ${icons.search}
        <input id="filmSearch" type="search" placeholder="${isSeries ? 'Пошук серіалів' : 'Пошук фільмів'} за назвою, режисером або актором…"
               value="${U.escapeHtml(query)}" aria-label="${isSeries ? 'Пошук серіалів' : 'Пошук фільмів'}">
      </div>
      <select id="filmSort" class="sort-select" aria-label="Сортування">
        <option value="new">Спочатку нові</option>
        <option value="old">Спочатку старі</option>
        <option value="rating">За рейтингом</option>
        <option value="friends">За оцінкою друзів</option>
        <option value="friend">За оцінкою друга</option>
        <option value="year">За роком</option>
        <option value="title">За назвою (А–Я)</option>
      </select>
      <div class="view-toggle" role="group" aria-label="Вигляд списку">
        <button type="button" data-view-btn="grid" class="${view === 'grid' ? 'active' : ''}" title="Сітка" aria-label="Вигляд: сітка">${icons.grid}</button>
        <button type="button" data-view-btn="table" class="${view === 'table' ? 'active' : ''}" title="Таблиця" aria-label="Вигляд: таблиця">${icons.table}</button>
      </div>
      <button class="btn primary add-btn" id="addBtn">${icons.plus}<span>Додати ${nounAcc}</span></button>
    </div>
    ${friendSortRowHTML()}
    <div id="filmsGrid" class="${view === 'table' ? 'table-wrap' : 'grid'}"></div>`;

  gridEl = container.querySelector('#filmsGrid');
  const sortEl = container.querySelector('#filmSort');
  sortEl.value = sort;
  sortEl.addEventListener('change', () => {
    sort = sortEl.value;
    localStorage.setItem(lsKey('films_sort'), sort);
    refreshGrid();
    updateFriendSortRow();
  });
  container.querySelector('#filmSearch').addEventListener('input', U.debounce((e) => {
    query = e.target.value;
    refreshGrid();
  }, 200));
  container.querySelector('#addBtn').addEventListener('click', openAdd);

  // Рядок вибору друга + напрямку для сортування «За оцінкою друга»
  wireFriendSortRow();
  updateFriendSortRow();

  // Перемикання сітка ⇄ таблиця (запам'ятовується між сесіями)
  container.querySelectorAll('[data-view-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.viewBtn;
      if (v === view) return;
      view = v;
      try { localStorage.setItem(lsKey('films_view'), view); } catch (e) {}
      buildSkeleton(); // перебудовує каркас (зберігає фокус пошуку)
      refreshGrid();
    });
  });

  // Кліки: заголовки-сортування в таблиці, кнопка «редагувати»,
  // швидка оцінка (кнопка на картці / своя комірка в таблиці),
  // відкриття картки/рядка
  gridEl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      // Клік на колонці друга — сортування за оцінкою цього друга;
      // повторний клік по тій самій колонці перемикає напрямок
      if (th.dataset.friend) {
        if (sort === 'friend' && friendId === th.dataset.friend) {
          friendDir = friendDir === 'asc' ? 'desc' : 'asc';
          localStorage.setItem(lsKey('films_sortdir'), friendDir);
        } else {
          friendId = th.dataset.friend;
          localStorage.setItem(lsKey('films_sortfriend'), friendId);
        }
      }
      sort = th.dataset.sort;
      localStorage.setItem(lsKey('films_sort'), sort);
      const sel = container.querySelector('#filmSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const row = e.target.closest('.card, .t-row');
      const film = row && filmsList.find(f => f.id === row.dataset.id);
      if (film) openFormModal({ film, currentUserId, allFilms: filmsList });
      return;
    }
    // Швидке оцінювання: кнопка на картці АБО своя комірка в таблиці
    const rateBtn = e.target.closest('[data-rate]');
    if (rateBtn) {
      const row = e.target.closest('.card, .t-row');
      const film = row && filmsList.find(f => f.id === row.dataset.id);
      if (film) openRatePop(rateBtn, film);
      return;
    }
    const myCell = e.target.closest('td.u-col.mine');
    if (myCell) {
      const row = e.target.closest('.t-row');
      const film = row && filmsList.find(f => f.id === row.dataset.id);
      if (film) openRatePop(myCell, film);
      return;
    }
    const row = e.target.closest('.card, .t-row');
    if (!row) return;
    const film = filmsList.find(f => f.id === row.dataset.id);
    if (!film) return;
    openDetail(film.id);
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest('.card, .t-row');
    if (row && e.target === row) openDetail(row.dataset.id);
  });

  if (wasSearchFocused) {
    const inp = container.querySelector('#filmSearch');
    inp.focus();
    try { inp.setSelectionRange(caret, caret); } catch (e) {}
  }
}

// ---------- Рядок «За оцінкою друга»: вибір друга + напрямок ----------

function friendSortRowHTML() {
  return `<div class="friend-sort-row" id="friendSortRow" hidden>
    <span class="fs-label">Оцінка друга:</span>
    <div class="fs-chips">${USERS.map(u => `
      <button type="button" class="fs-chip ${u.id === friendId ? 'active' : ''}" data-friend-chip="${u.id}" title="Сортувати за оцінками ${U.escapeHtml(u.name)}">
        ${A.avatarHTML(u, 'sm')}<span>${U.escapeHtml(u.name)}</span>
      </button>`).join('')}</div>
    <button type="button" class="icon-btn fs-dir" id="friendDirBtn" aria-label="Напрямок сортування" title="Спочатку вищі оцінки"></button>
  </div>`;
}

function updateFriendSortRow() {
  const row = container && container.querySelector('#friendSortRow');
  if (!row) return;
  row.hidden = sort !== 'friend';
  row.querySelectorAll('[data-friend-chip]').forEach(b => {
    const u = USERS.find(x => x.id === b.dataset.friendChip);
    const av = b.querySelector('.avatar');
    // Аватарки живуть в окремому вузлі бази й можуть прийти пізніше за
    // монтування — щоразу перемальовуємо свіжим HTML (фото або ініціал)
    if (u && av) av.outerHTML = A.avatarHTML(u, 'sm');
    b.classList.toggle('active', b.dataset.friendChip === friendId);
  });
  const dirBtn = row.querySelector('#friendDirBtn');
  if (dirBtn) {
    const desc = friendDir !== 'asc';
    dirBtn.innerHTML = desc ? icons.arrowDown : icons.arrowUp;
    dirBtn.title = desc ? 'Спочатку вищі оцінки' : 'Спочатку нижчі оцінки';
  }
}

function wireFriendSortRow() {
  const row = container && container.querySelector('#friendSortRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-friend-chip]');
    if (chip) {
      if (friendId === chip.dataset.friendChip && sort === 'friend') {
        // клік по активному другу — міняємо напрямок
        friendDir = friendDir === 'asc' ? 'desc' : 'asc';
        localStorage.setItem(lsKey('films_sortdir'), friendDir);
      } else {
        friendId = chip.dataset.friendChip;
        localStorage.setItem(lsKey('films_sortfriend'), friendId);
      }
      sort = 'friend';
      localStorage.setItem(lsKey('films_sort'), sort);
      const sel = container.querySelector('#filmSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    if (e.target.closest('#friendDirBtn')) {
      friendDir = friendDir === 'asc' ? 'desc' : 'asc';
      localStorage.setItem(lsKey('films_sortdir'), friendDir);
      updateFriendSortRow();
      refreshGrid();
    }
  });
}

// ---------- Фільтрація і сортування ----------

function filtered() {
  const q = query.trim().toLowerCase();
  // Розділення бібліотеки: вкладка «Фільми» — усе, крім серіалів;
  // вкладка «Серіали» — тільки kind === 'series'
  let list = filmsList.filter(f => mode === 'series' ? isSeriesItem(f) : !isSeriesItem(f));
  if (q) {
    // Жанри в базі двомовні (старі записи укр., нові англ.) — «драма»
    // має знаходити і фільми з жанром "drama", і навпаки
    const qEn = U.genreEn(q);
    list = list.filter(f => {
      const hay = [f.title, f.titleUk, f.director, f.country,
        ...(f.genres || []), ...(f.cast || [])]
        .map(x => String(x || '').toLowerCase());
      if (hay.some(x => x.includes(q))) return true;
      if (qEn && qEn !== q) {
        const gEn = (f.genres || []).map(g => String(U.genreEn(g) || '').toLowerCase());
        if (gEn.some(x => x.includes(qEn))) return true;
      }
      return false;
    });
  }
  const withAvg = f => { const a = U.avg(f.ratings); return a == null ? -1 : a; };
  // Середня оцінка ДРУЗІВ (без власної) — «як фільм сприйняла команда»
  const withFriendAvg = f => {
    const rs = { ...(f.ratings || {}) };
    delete rs[currentUserId];
    const a = U.avg(rs);
    return a == null ? -1 : a;
  };
  switch (sort) {
    case 'old': return [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case 'rating': return [...list].sort((a, b) => withAvg(b) - withAvg(a));
    case 'friends': return [...list].sort((a, b) => withFriendAvg(b) - withFriendAvg(a));
    case 'friend': {
      // Оцінка КОНКРЕТНОГО друга (вгору/вниз), без оцінки — у кінець
      const val = f => {
        const v = (f.ratings || {})[friendId];
        return typeof v === 'number' ? v : null;
      };
      const rated = list.filter(f => val(f) != null)
        .sort((a, b) => friendDir === 'asc' ? val(a) - val(b) : val(b) - val(a));
      return rated.concat(list.filter(f => val(f) == null));
    }
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
    renderSkeleton();
    return;
  }

  if (!filmsList.filter(f => mode === 'series' ? isSeriesItem(f) : !isSeriesItem(f)).length && !query.trim()) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon">${mode === 'series' ? icons.film : icons.clapper}</span>
        <h3>${mode === 'series' ? 'Поки що немає жодного серіалу' : 'Поки що немає жодного фільму'}</h3>
        <p>${mode === 'series'
          ? 'Додайте перший серіал — почніть вводити назву, і ми підтягнемо постер та деталі. Серіали не впливають на статистику фільмів.'
          : 'Додайте перший фільм — почніть вводити назву, і ми підтягнемо постер та деталі з IMDb.'}</p>
        <button class="btn primary" id="emptyAdd">${icons.plus}<span>${mode === 'series' ? 'Додати серіал' : 'Додати фільм'}</span></button>
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

  gridEl.innerHTML = view === 'table'
    ? tableHTML(list)
    : list.map(cardHTML).join('');
}

// ---------- Скелетон завантаження (під поточний вигляд) ----------

function renderSkeleton() {
  if (view === 'table') {
    const cols = 6 + USERS.length + 1;
    const line = i => `<div class="skeleton sk-line ${['w-70', 'w-45', 'w-55', 'w-80'][i % 4]}"></div>`;
    gridEl.innerHTML = `
      <table class="films-table">
        <thead><tr>${'<th></th>'.repeat(cols)}</tr></thead>
        <tbody>${Array.from({ length: 5 }, () =>
          `<tr class="skeleton-row">${Array.from({ length: cols }, (_, i) => `<td>${line(i)}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>`;
    return;
  }
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
}

// ---------- Табличний вигляд ----------

function tableHTML(list) {
  const isSeries = mode === 'series';
  const thSort = (key, label, extra = '') =>
    `<th class="sortable ${sort === key ? 'active' : ''} ${extra}" data-sort="${key}" scope="col" title="Сортувати">${label}</th>`;

  const userHeads = USERS.map(u => {
    // Клік на колонці друга = сортування за його оцінками (повторний клік — напрямок)
    const active = sort === 'friend' && friendId === u.id;
    const arrow = active ? `<span class="th-arrow">${friendDir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `
    <th class="u-col sortable ${active ? 'active' : ''}" scope="col" data-sort="friend" data-friend="${u.id}"
        aria-label="Сортувати за оцінками ${U.escapeHtml(u.name)}" title="Сортувати за оцінками ${U.escapeHtml(u.name)}">
      <span class="u-head ${u.id === currentUserId ? 'mine' : ''}" style="background:${u.color}">${A.inner(u)}</span>${arrow}
    </th>`;
  }).join('');

  return `
  <table class="films-table">
    <thead><tr>
      ${thSort('title', isSeries ? 'Серіал' : 'Фільм')}
      ${thSort('year', 'Рік')}
      ${isSeries ? '' : '<th scope="col">Режисер</th>'}
      <th scope="col">Жанри</th>
      ${isSeries ? '' : '<th scope="col" class="t-num">Хв</th>'}
      ${thSort('rating', 'Сер.')}
      ${userHeads}
      <th scope="col" aria-hidden="true"></th>
    </tr></thead>
    <tbody>${list.map(rowHTML).join('')}</tbody>
  </table>`;
}

function rowHTML(f) {
  const a = U.avg(f.ratings);
  const isSeries = isSeriesItem(f);
  const mainTitle = f.titleUk || f.title || 'Без назви';
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';

  const userCells = USERS.map(u => {
    const v = (f.ratings || {})[u.id];
    return `<td class="u-col ${u.id === currentUserId ? 'mine' : ''}">${v != null
      ? `<span class="t-score" style="background:${U.ratingColor(v)}" title="${U.escapeHtml(u.name)}: ${v}">${v}</span>`
      : `<span class="t-score empty" title="${U.escapeHtml(u.name)}: без оцінки">—</span>`}
    </td>`;
  }).join('');

  return `
  <tr class="t-row" data-id="${f.id}" tabindex="0" aria-label="${U.escapeHtml(mainTitle)}">
    <td>
      <div class="t-film">
        <span class="t-poster">${f.poster
          ? `<img src="${U.escapeHtml(U.posterUrl(f.poster, 80))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
          : icons.film}</span>
        <span class="t-titles">
          <span class="t-name">${U.escapeHtml(mainTitle)}</span>
          ${orig ? `<span class="t-orig">${U.escapeHtml(orig)}</span>` : ''}
        </span>
      </div>
    </td>
    <td class="t-num t-muted">${f.year || '—'}${isSeries ? '<span class="t-kind">серіал</span>' : ''}</td>
    ${isSeries ? '' : `<td class="t-muted" title="${U.escapeHtml(f.director || '')}">${f.director ? U.escapeHtml(U.trunc(f.director, 28)) : '—'}</td>`}
    <td class="t-muted t-genres" title="${U.escapeHtml((f.genres || []).join(', '))}">${f.genres && f.genres.length ? U.escapeHtml(U.trunc(f.genres.join(', '), 32)) : '—'}</td>
    ${isSeries ? '' : `<td class="t-num t-muted">${f.runtime || '—'}</td>`}
    <td>${a != null
      ? `<span class="avg-badge sm" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>`
      : `<span class="t-muted">—</span>`}</td>
    ${userCells}
    <td>
      <button class="icon-btn t-edit" data-edit aria-label="Редагувати" title="Редагувати">${icons.edit}</button>
    </td>
  </tr>`;
}

function cardHTML(f) {
  const a = U.avg(f.ratings);
  const my = (f.ratings || {})[currentUserId];
  const isSeries = isSeriesItem(f);
  const mainTitle = f.titleUk || f.title || 'Без назви';
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  const ratedCount = Object.keys(f.ratings || {}).length;
  // Тип — кольоровою пігулкою праворуч від року (фільм або серіал);
  // у серіалів тривалості немає — час перегляду рахувати неможливо
  const metaParts = [
    f.year ? U.escapeHtml(String(f.year)) : '',
    `<span class="t-kind">${isSeries ? 'серіал' : 'фільм'}</span>`,
    !isSeries && f.runtime ? `${f.runtime} хв` : '',
    ratedCount ? `${ratedCount} ${U.pluralRatings(ratedCount)}` : 'без оцінок'
  ].filter(Boolean);

  const friendChips = USERS
    .filter(u => (f.ratings || {})[u.id] != null)
    .map(u => `<span class="fchip" title="${U.escapeHtml(u.name)}: ${f.ratings[u.id]}"><i style="background:${u.color}"></i>${f.ratings[u.id]}</span>`)
    .join('');

  return `
  <article class="card" data-id="${f.id}" tabindex="0" role="button" aria-label="${U.escapeHtml(mainTitle)}">
    <div class="poster">
      ${f.poster ? `<img src="${U.escapeHtml(U.posterUrl(f.poster, 300))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${icons.film}
      ${a != null ? `<span class="avg-badge float" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      <button class="icon-btn card-edit" data-edit aria-label="Редагувати фільм" title="Редагувати">${icons.edit}</button>
    </div>
    <div class="card-body">
      <h3 class="card-title">${U.escapeHtml(mainTitle)}</h3>
      ${orig ? `<div class="card-sub">${U.escapeHtml(orig)}</div>` : ''}
      <div class="card-meta">${metaParts.join(' · ')}</div>
      <div class="rating-row">
        <button class="rate-btn ${my != null ? 'rated' : ''}" data-rate aria-label="Оцінити фільм" ${my != null ? `style="--my:${U.ratingColor(my)}"` : ''}>
          ${icons.star}<span>${my != null ? my : 'Оцінити'}</span>
        </button>
      </div>
      ${friendChips ? `<div class="fchips">${friendChips}</div>` : ''}
    </div>
  </article>`;
}

// ---------- Швидке оцінювання ----------
// Спливашка/шіт і шкала живуть у спільному модулі rating-ui.js
// (одна реалізація для фільмів та ігор). Тут лише адаптер: що робити
// при виборі оцінки — зберегти й розіслати сповіщення Telegram.

function openRatePop(anchor, film) {
  openRatePopShared({
    anchor,
    title: fTitle(film),
    ratings: film.ratings || {},
    currentUserId,
    onSave: async (next, cur) => {
      try {
        await store.setRating(film.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyRatingRemoved(currentUserId, film);
        else notifyRatingSet(currentUserId, film, next, cur);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        return false;
      }
    },
    onRemove: async () => {
      try {
        await store.setRating(film.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyRatingRemoved(currentUserId, film);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
        return false;
      }
    }
  });
}



// ---------- Модальне вікно фільму ----------

function openDetail(filmId) {
  // Вікно цього ж фільму вже відкрите — не дублюємо (подвійний клік,
  // швидкі кліки з рекордів статистики тощо)
  if (detailState && document.body.contains(detailState.overlay)) {
    if (detailState.filmId === filmId) return;
    detailState.close();
    detailState = null;
  }
  const film = filmsList.find(f => f.id === filmId);
  if (!film) return;
  const { overlay, box, close } = openModal(detailHTML(film), {
    width: 760,
    label: fTitle(film)
  });
  detailState = { overlay, box, filmId, close };
  wireDetail(box);
}

function fTitle(f) { return f.titleUk || f.title || 'Без назви'; }

function friendRowsHTML(ratings) {
  return USERS.map(u => {
    const v = (ratings || {})[u.id];
    return `<li class="f-row">
      ${A.avatarHTML(u, 'sm')}
      <span class="f-name">${U.escapeHtml(u.name)}</span>
      ${v != null
        ? `<span class="f-score" style="background:${U.ratingColor(v)}">${v}</span>`
        : `<span class="f-score empty">—</span>`}
    </li>`;
  }).join('');
}

// Аватарки (avatars/{uid}) можуть завантажитися пізніше за монтування
// вкладки — app.js викликає це на кожну зміну вузла avatars.
export function repaintAvatars() {
  updateFriendSortRow();
  if (detailState && document.body.contains(detailState.overlay)) {
    const film = filmsList.find(f => f.id === detailState.filmId);
    const list = detailState.box && detailState.box.querySelector('.friends-list');
    if (film && list) list.innerHTML = friendRowsHTML(film.ratings);
  }
}

function detailHTML(f) {
  const a = U.avg(f.ratings);
  const my = (f.ratings || {})[currentUserId];
  const isSeries = isSeriesItem(f);
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  // Якщо відома повна дата прем'єри («24 вересня 2007») — показуємо її
  // замість голого року; інакше — рік, як раніше
  const prem = U.fmtPremiere(f.premiere);
  // Тип («фільм»/«серіал») — праворуч від року/премʼєри; далі — кольорова
  // позначка власної оцінки (той самий стиль пігулки, колір як в avg/t-score)
  const kindBadge = `<span class="kind-badge">${isSeries ? 'серіал' : 'фільм'}</span>`;
  const myBadge = my != null
    ? `<span class="my-badge" style="background:${U.ratingColor(my)}" title="Ваша оцінка">ваша ${my}</span>`
    : '';
  const metaBits = [
    // країна — клікабельна (фільтрує список), тому поза metaBits
    f.country ? `<button type="button" class="person-link" data-person="${U.escapeHtml(f.country)}" title="Фільми цієї країни">${U.escapeHtml(f.country)}</button>` : '',
    prem ? `прем'єра ${prem}` : f.year,
    kindBadge,
    myBadge,
    isSeries ? '' : (f.runtime ? `${f.runtime} хв` : '')
  ].filter(Boolean).join(' · ');
  const genres = (f.genres || []).map(g =>
    `<button type="button" class="genre-chip clickable" data-person="${U.escapeHtml(g)}" title="Фільми цього жанру">${U.escapeHtml(g)}</button>`
  ).join('');
  const cast = (f.cast || []).map(c =>
    `<button type="button" class="cast-chip" data-person="${U.escapeHtml(c)}" title="Фільми з цим актором">${U.escapeHtml(c)}</button>`
  ).join('');
  const directorBtn = f.director
    ? `<button type="button" class="person-link" data-person="${U.escapeHtml(f.director)}" title="${isSeries ? 'Серіали цього автора' : 'Фільми цього режисера'}">${U.escapeHtml(f.director)}</button>`
    : '';

  const friendRows = friendRowsHTML(f.ratings);

  const adder = USERS.find(u => u.id === f.addedBy);
  const addedLine = f.addedBy
    ? `Додав${adder ? '' : ' користувач'}: <b>${U.escapeHtml(adder ? adder.name : f.addedBy)}</b>${f.createdAt ? ' · ' + U.fmtDate(f.createdAt) : ''}`
    : '';

  return `
  <div class="detail-hero">
    ${f.poster ? `<img class="hero-bg" src="${U.escapeHtml(U.posterUrl(f.poster, 400))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="hero-shade"></div>
    <button class="icon-btn hero-close" data-close aria-label="Закрити">${icons.close}</button>
    <div class="hero-body">
      ${f.poster
        ? `<img class="hero-poster" src="${U.escapeHtml(U.posterUrl(f.poster, 300))}" alt="Постер: ${U.escapeHtml(fTitle(f))}" referrerpolicy="no-referrer" onerror="this.classList.add('broken'); this.removeAttribute('src')">`
        : `<span class="hero-poster placeholder">${icons.film}</span>`}
      <div class="hero-text">
        <h2 class="detail-heading">${U.escapeHtml(fTitle(f))}</h2>
        ${orig ? `<div class="detail-orig">${U.escapeHtml(orig)}</div>` : ''}
        <div class="detail-meta">${[f.director ? `${isSeries ? 'авт.' : 'реж.'} ${directorBtn}` : '', metaBits].filter(Boolean).join(' · ')}</div>
        ${a != null ? `<span class="avg-big" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="detail-scroll">
    <div class="detail-info">
      ${genres ? `<div class="genre-row">${genres}</div>` : ''}
      ${cast ? `<div class="cast-row"><span class="cast-label">У ролях:</span>${cast}</div>` : ''}
      ${f.plot ? `<p class="detail-plot">${U.escapeHtml(f.plot)}</p>` : ''}
      <div class="detail-links">
        ${f.imdbId ? `<a class="imdb-link" href="https://www.imdb.com/title/${U.escapeHtml(f.imdbId)}/" target="_blank" rel="noopener">${icons.link}<span>Переглянути на IMDb</span></a>` : ''}
        ${addedLine ? `<span class="added-line">${addedLine}</span>` : ''}
      </div>
    </div>
    <div class="detail-ratings">
      <div class="my-rating">
        <div class="my-rating-top"><span class="my-rating-label">Ваша оцінка</span></div>
        <div class="rt" role="group" aria-label="Ваша оцінка від 1 до 10">${rateTrailHTML(my)}</div>
        ${my != null ? `<button class="remove-rating" data-remove-rating>Прибрати мою оцінку</button>` : ''}
      </div>
      <ul class="friends-list">${friendRows}</ul>
    </div>
    <div class="modal-footer between">
      <button class="btn danger-ghost" data-act="delete">${icons.trash}<span>Видалити</span></button>
      <button class="btn" data-act="edit">${icons.edit}<span>Редагувати</span></button>
    </div>
  </div>`;
}

function wireDetail(box) {
  // Живе прев'ю шкали в модалці. Делегуємо на box (а не на .rt):
  // refreshDetail() перестикує вміст на кожному снапшоті Firebase,
  // тож слухач на box переживає будь-які ре-рендери.
  box.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (seg) paintTrail(box, +seg.dataset.score);
  });
  box.addEventListener('mouseout', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (!seg) return;
    const to = e.relatedTarget;
    if (to && box.contains(to) && to.closest('.rt-seg')) return; // перехід на сусідній сегмент
    const film0 = (detailState && document.body.contains(detailState.overlay))
      ? filmsList.find(f => f.id === detailState.filmId) : null;
    paintTrail(box, film0 ? (film0.ratings || {})[currentUserId] : null);
  });

  box.addEventListener('click', async (e) => {
    // Модалку могли вже закрити (снапшот Firebase прибрав фільм),
    // а подія кліку ще долетіла за 180 мс анімації зникнення
    if (!detailState || !document.body.contains(detailState.overlay)) return;
    const film = filmsList.find(f => f.id === detailState.filmId);
    if (!film) return;

    // Клік на режисера / актора / жанр — фільтруємо список. Якщо це серіал —
    // фільтруємо вкладку «Серіали», інакше друзі бачили б «нічого не знайдено»
    const person = e.target.closest('[data-person]');
    if (person) {
      const q = person.dataset.person;
      const m = isSeriesItem(film) ? 'series' : 'films';
      detailState.close();
      if (mode !== m) {
        document.dispatchEvent(new CustomEvent('films:filter', { detail: { q, mode: m } }));
      } else {
        setFilter(q);
      }
      return;
    }

    const seg = e.target.closest('.rt-seg');
    if (seg) {
      if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
      const score = +seg.dataset.score;
      const cur = (film.ratings || {})[currentUserId];
      const next = (cur === score) ? null : score; // повторний клік прибирає оцінку
      paintTrail(box, next);
      popValue(box);
      try {
        await store.setRating(film.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyRatingRemoved(currentUserId, film);
        else notifyRatingSet(currentUserId, film, next, cur != null ? cur : null);
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        paintTrail(box, cur); // повертаємо попередній стан шкали
      }
      return;
    }

    if (e.target.closest('[data-remove-rating]')) {
      try {
        await store.setRating(film.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyRatingRemoved(currentUserId, film);
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
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити фільм', 'err');
        return;
      }
      // УВАГА: поки тривало видалення, снапшот Firebase міг уже
      // оновити список і закрити модалку через refreshDetail()
      // (detailState став null). Раніше тут був detailState.close(),
      // який падав з TypeError -> показувалась і помилка, і успіх.
      toast('Фільм видалено');
      // передаємо сам запис (а не лише назву) — щоб пуш розрізняв фільм/серіал
      notifyFilmDeleted(currentUserId, film);
      if (detailState) { detailState.close(); detailState = null; }
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
