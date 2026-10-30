// ============================================================
// Вкладка «Ігри»: той самий дизайн і потік, що й у «Фільмів» —
// сітка карток АБО таблиця, пошук/сортування, модальне вікно гри
// з оцінками 1–10. Дані — в окремому вузлі games/.
// ============================================================

import { USERS } from './config.js?v=6.1';
import * as store from './store.js?v=6.1';
import * as U from './utils.js?v=6.1';
import * as A from './avatars.js?v=6.1';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=6.1';
import { rateTrailHTML, paintTrail, popValue, openRatePop as openRatePopShared } from './rating-ui.js?v=6.1';
import { openFormModal } from './game-form.js?v=6.1';
import { notifyGameRatingSet, notifyGameRatingRemoved, notifyGameDeleted } from './telegram.js?v=6.1';

let container = null;
let gridEl = null;
let gamesList = [];
let isLoading = true;
let loadError = null;
let query = '';
let sort = localStorage.getItem('games_sort') || 'new';
let view = localStorage.getItem('games_view') === 'table' ? 'table' : 'grid';
let friendId = localStorage.getItem('games_sortfriend') || null; // сортування «За оцінкою друга»
let friendDir = localStorage.getItem('games_sortdir') === 'asc' ? 'asc' : 'desc';
let currentUserId = null;
let detailState = null; // { overlay, box, gameId, close }

// ---------- Публічний інтерфейс ----------

export function mount(el) {
  container = el;
  buildSkeleton();
  refreshGrid();
}

export function setGames(list) {
  if (list === null) { isLoading = true; }
  else { isLoading = false; gamesList = list; loadError = null; }
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
  openFormModal({ game: null, currentUserId, allGames: gamesList });
}

// Зовнішній фільтр (клік на розробника/жанр у вікні гри)
export function setFilter(q) {
  query = String(q || '');
  const inp = document.getElementById('gameSearch');
  if (!inp || !container.contains(inp)) return;
  inp.value = query;
  if (!window.matchMedia('(pointer: coarse)').matches) inp.focus();
  refreshGrid();
}

export function openGameById(gameId) {
  if (gamesList.some(g => g.id === gameId)) openDetail(gameId);
}

// ---------- Каркас вкладки ----------

function buildSkeleton() {
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'gameSearch' && container.contains(document.activeElement);
  const caret = wasSearchFocused ? document.activeElement.selectionStart : 0;

  container.innerHTML = `
    <div class="view-head">
      <div class="search-wrap">
        ${icons.search}
        <input id="gameSearch" type="search" placeholder="Пошук за назвою або розробником…"
               value="${U.escapeHtml(query)}" aria-label="Пошук ігор">
      </div>
      <select id="gameSort" class="sort-select" aria-label="Сортування">
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
      <button class="btn primary add-btn" id="addGameBtn">${icons.plus}<span>Додати гру</span></button>
    </div>
    ${friendSortRowHTML()}
    <div id="gamesGrid" class="${view === 'table' ? 'table-wrap' : 'grid'}"></div>`;

  gridEl = container.querySelector('#gamesGrid');
  const sortEl = container.querySelector('#gameSort');
  sortEl.value = sort;
  sortEl.addEventListener('change', () => {
    sort = sortEl.value;
    localStorage.setItem('games_sort', sort);
    refreshGrid();
    updateFriendSortRow();
  });
  container.querySelector('#gameSearch').addEventListener('input', U.debounce((e) => {
    query = e.target.value;
    refreshGrid();
  }, 200));
  container.querySelector('#addGameBtn').addEventListener('click', openAdd);

  // Рядок вибору друга для сортування «За оцінкою друга»
  wireFriendSortRow();
  updateFriendSortRow();

  container.querySelectorAll('[data-view-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.viewBtn;
      if (v === view) return;
      view = v;
      try { localStorage.setItem('games_view', view); } catch (e) {}
      buildSkeleton();
      refreshGrid();
    });
  });

  // Кліки: заголовки-сортування, «редагувати», швидка оцінка, відкриття
  gridEl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      // Клік на колонці друга — сортування за оцінкою цього друга;
      // повторний клік по тій самій колонці перемикає напрямок
      if (th.dataset.friend) {
        if (sort === 'friend' && friendId === th.dataset.friend) {
          friendDir = friendDir === 'asc' ? 'desc' : 'asc';
          localStorage.setItem('games_sortdir', friendDir);
        } else {
          friendId = th.dataset.friend;
          localStorage.setItem('games_sortfriend', friendId);
        }
      }
      sort = th.dataset.sort;
      localStorage.setItem('games_sort', sort);
      const sel = container.querySelector('#gameSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const row = e.target.closest('.card, .t-row');
      const game = row && gamesList.find(g => g.id === row.dataset.id);
      if (game) openFormModal({ game, currentUserId, allGames: gamesList });
      return;
    }
    const rateBtn = e.target.closest('[data-rate]');
    if (rateBtn) {
      const row = e.target.closest('.card, .t-row');
      const game = row && gamesList.find(g => g.id === row.dataset.id);
      if (game) openRatePop(rateBtn, game);
      return;
    }
    const myCell = e.target.closest('td.u-col.mine');
    if (myCell) {
      const row = e.target.closest('.t-row');
      const game = row && gamesList.find(g => g.id === row.dataset.id);
      if (game) openRatePop(myCell, game);
      return;
    }
    const row = e.target.closest('.card, .t-row');
    if (!row) return;
    const game = gamesList.find(g => g.id === row.dataset.id);
    if (!game) return;
    openDetail(game.id);
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest('.card, .t-row');
    if (row && e.target === row) openDetail(row.dataset.id);
  });

  if (wasSearchFocused) {
    const inp = container.querySelector('#gameSearch');
    inp.focus();
    try { inp.setSelectionRange(caret, caret); } catch (e) {}
  }
}

// ---------- Фільтрація і сортування ----------

function filtered() {
  const q = query.trim().toLowerCase();
  let list = gamesList;
  if (q) {
    const qEn = U.genreEn(q);
    list = list.filter(g => {
      const hay = [g.title, g.titleUk, g.developer, g.publisher,
        ...(g.genres || []), ...(g.platforms || [])]
        .map(x => String(x || '').toLowerCase());
      if (hay.some(x => x.includes(q))) return true;
      if (qEn && qEn !== q) {
        const gEn = (g.genres || []).map(x => String(U.genreEn(x) || '').toLowerCase());
        if (gEn.some(x => x.includes(qEn))) return true;
      }
      return false;
    });
  }
  const withAvg = g => { const a = U.avg(g.ratings); return a == null ? -1 : a; };
  // Середня оцінка ДРУЗІВ (без власної) — «хто що подумав про гру»
  const withFriendAvg = g => {
    const rs = { ...(g.ratings || {}) };
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
      const val = g => {
        const v = (g.ratings || {})[friendId];
        return typeof v === 'number' ? v : null;
      };
      const rated = list.filter(g => val(g) != null)
        .sort((a, b) => friendDir === 'asc' ? val(a) - val(b) : val(b) - val(a));
      return rated.concat(list.filter(g => val(g) == null));
    }
    case 'year': return [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'title': return [...list].sort((a, b) => String(a.titleUk || a.title || '').localeCompare(String(b.titleUk || b.title || ''), 'uk'));
    default: return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

// ---------- Рядок «За оцінкою друга» (ігри) ----------

function friendSortRowHTML() {
  if (!friendId) {
    const other = USERS.find(u => u.id !== currentUserId) || USERS[0];
    friendId = other ? other.id : null;
  }
  return `<div class="friend-sort-row" id="gameFriendSortRow" hidden>
    <span class="fs-label">Оцінка друга:</span>
    <div class="fs-chips">${USERS.map(u => `
      <button type="button" class="fs-chip ${u.id === friendId ? 'active' : ''}" data-friend-chip="${u.id}" title="Сортувати за оцінками ${U.escapeHtml(u.name)}">
        ${A.avatarHTML(u, 'sm')}<span>${U.escapeHtml(u.name)}</span>
      </button>`).join('')}</div>
    <button type="button" class="icon-btn fs-dir" id="gameFriendDirBtn" aria-label="Напрямок сортування" title="Спочатку вищі оцінки"></button>
  </div>`;
}

function updateFriendSortRow() {
  const row = container && container.querySelector('#gameFriendSortRow');
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
  const dirBtn = row.querySelector('#gameFriendDirBtn');
  if (dirBtn) {
    const desc = friendDir !== 'asc';
    dirBtn.innerHTML = desc ? icons.arrowDown : icons.arrowUp;
    dirBtn.title = desc ? 'Спочатку вищі оцінки' : 'Спочатку нижчі оцінки';
  }
}

// Аватарки (avatars/{uid}) можуть завантажитися пізніше за монтування
// вкладки — app.js викликає це на кожну зміну вузла avatars.
export function repaintAvatars() {
  updateFriendSortRow();
  if (detailState && document.body.contains(detailState.overlay)) {
    const game = gamesList.find(g => g.id === detailState.gameId);
    const list = detailState.box && detailState.box.querySelector('.friends-list');
    if (game && list) list.innerHTML = friendRowsHTML(game.ratings);
  }
}

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

function wireFriendSortRow() {
  const row = container && container.querySelector('#gameFriendSortRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-friend-chip]');
    if (chip) {
      if (friendId === chip.dataset.friendChip && sort === 'friend') {
        friendDir = friendDir === 'asc' ? 'desc' : 'asc';
        localStorage.setItem('games_sortdir', friendDir);
      } else {
        friendId = chip.dataset.friendChip;
        localStorage.setItem('games_sortfriend', friendId);
      }
      sort = 'friend';
      localStorage.setItem('games_sort', sort);
      const sel = container.querySelector('#gameSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    if (e.target.closest('#gameFriendDirBtn')) {
      friendDir = friendDir === 'asc' ? 'desc' : 'asc';
      localStorage.setItem('games_sortdir', friendDir);
      updateFriendSortRow();
      refreshGrid();
    }
  });
}

// ---------- Сітка ----------

function refreshGrid() {
  if (!gridEl) return;

  if (loadError) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon err">${icons.alert}</span>
        <h3>Не вдалося завантажити ігри</h3>
        <p>Перевірте зʼєднання та правила доступу Firebase Realtime Database.</p>
        <button class="btn primary" onclick="location.reload()">Спробувати знову</button>
      </div>`;
    return;
  }

  if (isLoading) {
    renderSkeleton();
    return;
  }

  if (!gamesList.length && !query.trim()) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon">${icons.gamepad}</span>
        <h3>Поки що немає жодної гри</h3>
        <p>Додайте першу пройдену гру — почніть вводити назву, і обкладинка, рік і деталі підтягнуться з Вікіпедії.</p>
        <button class="btn primary" id="emptyAddGame">${icons.plus}<span>Додати гру</span></button>
      </div>`;
    gridEl.querySelector('#emptyAddGame').addEventListener('click', openAdd);
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

function renderSkeleton() {
  if (view === 'table') {
    const cols = 5 + USERS.length + 1;
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
      ${thSort('title', 'Гра')}
      ${thSort('year', 'Рік')}
      <th scope="col">Розробник</th>
      <th scope="col">Жанри</th>
      ${thSort('rating', 'Сер.')}
      ${userHeads}
      <th scope="col" aria-hidden="true"></th>
    </tr></thead>
    <tbody>${list.map(rowHTML).join('')}</tbody>
  </table>`;
}

function rowHTML(g) {
  const a = U.avg(g.ratings);
  const mainTitle = g.titleUk || g.title || 'Без назви';
  const orig = (g.titleUk && g.title && g.titleUk !== g.title) ? g.title : '';

  const userCells = USERS.map(u => {
    const v = (g.ratings || {})[u.id];
    return `<td class="u-col ${u.id === currentUserId ? 'mine' : ''}">${v != null
      ? `<span class="t-score" style="background:${U.ratingColor(v)}" title="${U.escapeHtml(u.name)}: ${v}">${v}</span>`
      : `<span class="t-score empty" title="${U.escapeHtml(u.name)}: без оцінки">—</span>`}
    </td>`;
  }).join('');

  return `
  <tr class="t-row" data-id="${g.id}" tabindex="0" aria-label="${U.escapeHtml(mainTitle)}">
    <td>
      <div class="t-film">
        <span class="t-poster">${g.cover
          ? `<img src="${U.escapeHtml(U.posterUrl(g.cover, 80))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
          : icons.gamepad}</span>
        <span class="t-titles">
          <span class="t-name">${U.escapeHtml(mainTitle)}</span>
          ${orig ? `<span class="t-orig">${U.escapeHtml(orig)}</span>` : ''}
        </span>
      </div>
    </td>
    <td class="t-num t-muted">${g.year || '—'}</td>
    <td class="t-muted" title="${U.escapeHtml(g.developer || '')}">${g.developer ? U.escapeHtml(U.trunc(g.developer, 28)) : '—'}</td>
    <td class="t-muted t-genres" title="${U.escapeHtml((g.genres || []).join(', '))}">${g.genres && g.genres.length ? U.escapeHtml(U.trunc(g.genres.join(', '), 32)) : '—'}</td>
    <td>${a != null
      ? `<span class="avg-badge sm" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>`
      : `<span class="t-muted">—</span>`}</td>
    ${userCells}
    <td>
      <button class="icon-btn t-edit" data-edit aria-label="Редагувати гру" title="Редагувати">${icons.edit}</button>
    </td>
  </tr>`;
}

function cardHTML(g) {
  const a = U.avg(g.ratings);
  const my = (g.ratings || {})[currentUserId];
  const mainTitle = g.titleUk || g.title || 'Без назви';
  const orig = (g.titleUk && g.title && g.titleUk !== g.title) ? g.title : '';
  const ratedCount = Object.keys(g.ratings || {}).length;
  const metaBits = [
    g.year,
    g.developer ? U.trunc(g.developer, 30) : '',
    ratedCount ? `${ratedCount} ${U.pluralRatings(ratedCount)}` : 'без оцінок'
  ].filter(Boolean).join(' · ');

  const friendChips = USERS
    .filter(u => (g.ratings || {})[u.id] != null)
    .map(u => `<span class="fchip" title="${U.escapeHtml(u.name)}: ${g.ratings[u.id]}"><i style="background:${u.color}"></i>${g.ratings[u.id]}</span>`)
    .join('');

  return `
  <article class="card" data-id="${g.id}" tabindex="0" role="button" aria-label="${U.escapeHtml(mainTitle)}">
    <div class="poster">
      ${g.cover ? `<img src="${U.escapeHtml(U.posterUrl(g.cover, 300))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${icons.gamepad}
      ${a != null ? `<span class="avg-badge float" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      <button class="icon-btn card-edit" data-edit aria-label="Редагувати гру" title="Редагувати">${icons.edit}</button>
    </div>
    <div class="card-body">
      <h3 class="card-title">${U.escapeHtml(mainTitle)}</h3>
      ${orig ? `<div class="card-sub">${U.escapeHtml(orig)}</div>` : ''}
      <div class="card-meta">${U.escapeHtml(metaBits)}</div>
      <div class="rating-row">
        <button class="rate-btn ${my != null ? 'rated' : ''}" data-rate aria-label="Оцінити гру" ${my != null ? `style="--my:${U.ratingColor(my)}"` : ''}>
          ${icons.star}<span>${my != null ? my : 'Оцінити'}</span>
        </button>
      </div>
      ${friendChips ? `<div class="fchips">${friendChips}</div>` : ''}
    </div>
  </article>`;
}

// ---------- Швидке оцінювання (спільна спливашка rating-ui.js) ----------

function openRatePop(anchor, game) {
  openRatePopShared({
    anchor,
    title: gTitle(game),
    ratings: game.ratings || {},
    currentUserId,
    onSave: async (next, cur) => {
      try {
        await store.setGameRating(game.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyGameRatingRemoved(currentUserId, game);
        else notifyGameRatingSet(currentUserId, game, next, cur);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        return false;
      }
    },
    onRemove: async () => {
      try {
        await store.setGameRating(game.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyGameRatingRemoved(currentUserId, game);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
        return false;
      }
    }
  });
}

// ---------- Модальне вікно гри ----------

function openDetail(gameId) {
  if (detailState && document.body.contains(detailState.overlay)) {
    if (detailState.gameId === gameId) return;
    detailState.close();
    detailState = null;
  }
  const game = gamesList.find(g => g.id === gameId);
  if (!game) return;
  const { overlay, box, close } = openModal(detailHTML(game), {
    width: 760,
    label: gTitle(game)
  });
  detailState = { overlay, box, gameId, close };
  wireDetail(box);
}

function gTitle(g) { return g.titleUk || g.title || 'Без назви'; }

function detailHTML(g) {
  const a = U.avg(g.ratings);
  const my = (g.ratings || {})[currentUserId];
  const orig = (g.titleUk && g.title && g.titleUk !== g.title) ? g.title : '';
  const metaBits = [g.year, ...(g.platforms || [])].filter(Boolean).join(' · ');
  const genres = (g.genres || []).map(x =>
    `<button type="button" class="genre-chip clickable" data-person="${U.escapeHtml(x)}" title="Ігри цього жанру">${U.escapeHtml(x)}</button>`
  ).join('');
  const platforms = (g.platforms || []).map(x =>
    `<span class="cast-chip">${U.escapeHtml(x)}</span>`
  ).join('');
  const devBtn = g.developer
    ? `<button type="button" class="person-link" data-person="${U.escapeHtml(g.developer)}" title="Ігри цього розробника">${U.escapeHtml(g.developer)}</button>`
    : '';
  const pubLine = g.publisher ? `<span class="pub-line">видавець: <b>${U.escapeHtml(g.publisher)}</b></span>` : '';

  const friendRows = friendRowsHTML(g.ratings);

  const adder = USERS.find(u => u.id === g.addedBy);
  const addedLine = g.addedBy
    ? `Додав${adder ? '' : ' користувач'}: <b>${U.escapeHtml(adder ? adder.name : g.addedBy)}</b>${g.createdAt ? ' · ' + U.fmtDate(g.createdAt) : ''}`
    : '';

  return `
  <div class="detail-hero">
    ${g.cover ? `<img class="hero-bg" src="${U.escapeHtml(U.posterUrl(g.cover, 400))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="hero-shade"></div>
    <button class="icon-btn hero-close" data-close aria-label="Закрити">${icons.close}</button>
    <div class="hero-body">
      ${g.cover
        ? `<img class="hero-poster" src="${U.escapeHtml(U.posterUrl(g.cover, 300))}" alt="Обкладинка: ${U.escapeHtml(gTitle(g))}" referrerpolicy="no-referrer" onerror="this.classList.add('broken'); this.removeAttribute('src')">`
        : `<span class="hero-poster placeholder">${icons.gamepad}</span>`}
      <div class="hero-text">
        <h2 class="detail-heading">${U.escapeHtml(gTitle(g))}</h2>
        ${orig ? `<div class="detail-orig">${U.escapeHtml(orig)}</div>` : ''}
        <div class="detail-meta">${[g.developer ? `розробка ${devBtn}` : '', metaBits].filter(Boolean).join(' · ')}</div>
        ${a != null ? `<span class="avg-big" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="detail-scroll">
    <div class="detail-info">
      ${genres ? `<div class="genre-row">${genres}</div>` : ''}
      ${platforms ? `<div class="cast-row"><span class="cast-label">Платформи:</span>${platforms}</div>` : ''}
      ${pubLine ? `<p class="pub-note">${pubLine}</p>` : ''}
      ${g.plot ? `<p class="detail-plot">${U.escapeHtml(g.plot)}</p>` : ''}
      <div class="detail-links">
        ${g.wikiUrl ? `<a class="imdb-link" href="${U.escapeHtml(g.wikiUrl)}" target="_blank" rel="noopener">${icons.link}<span>Вікіпедія</span></a>` : ''}
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
  // Живе прев'ю шкали в модалці (делегування на box — вміст
  // перестикується на кожному снапшоті Firebase)
  box.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (seg) paintTrail(box, +seg.dataset.score);
  });
  box.addEventListener('mouseout', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (!seg) return;
    const to = e.relatedTarget;
    if (to && box.contains(to) && to.closest('.rt-seg')) return;
    const game0 = (detailState && document.body.contains(detailState.overlay))
      ? gamesList.find(g => g.id === detailState.gameId) : null;
    paintTrail(box, game0 ? (game0.ratings || {})[currentUserId] : null);
  });

  box.addEventListener('click', async (e) => {
    if (!detailState || !document.body.contains(detailState.overlay)) return;
    const game = gamesList.find(g => g.id === detailState.gameId);
    if (!game) return;

    // Клік на розробника / жанр — фільтруємо список ігор
    const person = e.target.closest('[data-person]');
    if (person) {
      const q = person.dataset.person;
      detailState.close();
      setFilter(q);
      return;
    }

    const seg = e.target.closest('.rt-seg');
    if (seg) {
      if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
      const score = +seg.dataset.score;
      const cur = (game.ratings || {})[currentUserId];
      const next = (cur === score) ? null : score;
      paintTrail(box, next);
      popValue(box);
      try {
        await store.setGameRating(game.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyGameRatingRemoved(currentUserId, game);
        else notifyGameRatingSet(currentUserId, game, next, cur != null ? cur : null);
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        paintTrail(box, cur);
      }
      return;
    }

    if (e.target.closest('[data-remove-rating]')) {
      try {
        await store.setGameRating(game.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyGameRatingRemoved(currentUserId, game);
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
      }
      return;
    }

    if (e.target.closest('[data-act="edit"]')) {
      detailState.close();
      openFormModal({ game, currentUserId, allGames: gamesList });
      return;
    }

    if (e.target.closest('[data-act="delete"]')) {
      const ok = await confirmDialog({
        title: 'Видалити гру?',
        text: `«${gTitle(game)}» та всі її оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteGame(game.id);
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити гру', 'err');
        return;
      }
      // Снапшот Firebase міг уже закрити модалку під час видалення
      toast('Гру видалено');
      notifyGameDeleted(currentUserId, gTitle(game));
      if (detailState) { detailState.close(); detailState = null; }
    }
  });
}

// Оновлює відкрите вікно гри, коли дані змінилися
function refreshDetail() {
  if (!detailState) return;
  const { overlay, box, gameId, close } = detailState;
  if (!document.body.contains(overlay)) { detailState = null; return; }
  const game = gamesList.find(g => g.id === gameId);
  if (!game) { close(); detailState = null; return; }
  box.innerHTML = detailHTML(game);
}
