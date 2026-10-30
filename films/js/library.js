// ============================================================
// Вкладки «Альбоми», «Сингли», «Книги»: ОДИН універсальний модуль
// для трьох колекцій — той самий дизайн і потік, що й у «Фільмів»
// та «Ігор»: сітка обкладинок АБО таблиця, пошук/сортування (у
// кожної колекції СВОЇ ключі), модальне вікно з оцінками 1–10,
// швидке оцінювання, редагування й видалення. Дані — у вузлах
// albums/, singles/, books/.
// ============================================================

import { USERS } from './config.js?v=6.2';
import * as store from './store.js?v=6.2';
import * as U from './utils.js?v=6.2';
import * as A from './avatars.js?v=6.2';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=6.2';
import { rateTrailHTML, paintTrail, popValue, openRatePop as openRatePopShared } from './rating-ui.js?v=6.2';
import { openFormModal } from './media-form.js?v=6.2';
import { notifyMediaRatingSet, notifyMediaRatingRemoved, notifyMediaDeleted } from './telegram.js?v=6.2';
import { mediaCfg } from './media-kinds.js?v=6.2';

// Конфігурація колекцій (назви, вузол бази, іконки) — у media-kinds.js,
// спільно з формою додавання
const KINDS = {
  album: mediaCfg('album'),
  single: mediaCfg('single'),
  book: mediaCfg('book')
};

let container = null;
let gridEl = null;
let kind = 'album';          // album | single | book
let list = [];               // записи поточної колекції
let isLoading = true;
let loadError = null;
let query = '';
let sort = 'new';
let view = 'grid';
let friendId = null;
let friendDir = 'desc';
let currentUserId = null;
let detailState = null;      // { overlay, box, itemId, close }

// ---------- Прев'ю 30-секундних фрагментів (сингли/альбоми) ----------
// Один глобальний <audio> на застосунок: повторний клік ставить паузу,
// клік іншого запису перемикає джерело. Кнопки перемальовуємо точково
// (картки перестикуються на кожному снапшоті Firebase).
let audioEl = null;
let playingId = null;

function stopPreview() {
  if (audioEl) { try { audioEl.pause(); } catch (e) {} }
  playingId = null;
  paintPlayButtons();
}

function paintPlayButtons() {
  document.querySelectorAll('[data-play]').forEach(b => {
    const on = b.dataset.play === playingId;
    b.classList.toggle('playing', on);
    const ic = b.querySelector('.pb-icon');
    if (ic) ic.innerHTML = on ? icons.pause : icons.play;
  });
}

function togglePreview(id, url) {
  if (!url) return;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'none';
    audioEl.addEventListener('ended', () => { playingId = null; paintPlayButtons(); });
    audioEl.addEventListener('pause', () => { if (playingId) paintPlayButtons(); });
  }
  if (playingId === id && !audioEl.paused) {
    audioEl.pause();
    playingId = null;
    paintPlayButtons();
    return;
  }
  if (playingId !== id) audioEl.src = url;
  audioEl.play().catch(() => { /* мережа/автоплей — тихо */ });
  playingId = id;
  paintPlayButtons();
}

function cfg() { return KINDS[kind]; }
function lsKey(base) { return `lib_${kind}_${base}`; }

function loadKindState() {
  query = '';
  sort = localStorage.getItem(lsKey('sort')) || 'new';
  view = localStorage.getItem(lsKey('view')) === 'table' ? 'table' : 'grid';
  friendId = localStorage.getItem(lsKey('sortfriend')) || null;
  friendDir = localStorage.getItem(lsKey('sortdir')) === 'asc' ? 'asc' : 'desc';
  friendId = friendId || (USERS.find(u => u.id !== currentUserId) || USERS[0] || {}).id || null;
}

function mTitle(m) { return m.title || m.titleUk || 'Без назви'; }
function personOf(m) { return kind === 'book' ? (m.author || null) : (m.artist || null); }

// ---------- Публічний інтерфейс ----------

export function mount(el, k = 'album') {
  const kindChanged = k !== kind;
  kind = KINDS[k] ? k : 'album';
  if (kindChanged || !friendId) loadKindState();
  stopPreview(); // перехід на іншу вкладку — музика не грає з пустоти
  container = el;
  buildSkeleton();
  refreshGrid();
}

export function setItems(k, items) {
  if (k !== kind) return; // оновлення чужої колекції — не наша тема
  if (items === null) { isLoading = true; }
  else { isLoading = false; list = items; loadError = null; }
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
  openFormModal({ kind, item: null, currentUserId, allItems: list });
}

// Зовнішній фільтр (клік на виконавця/автора/жанр у вікні)
export function setFilter(q) {
  query = String(q || '');
  const inp = document.getElementById('libSearch');
  if (!inp || !container.contains(inp)) return;
  inp.value = query;
  if (!window.matchMedia('(pointer: coarse)').matches) inp.focus();
  refreshGrid();
}

export function openItemById(itemId) {
  if (list.some(m => m.id === itemId)) openDetail(itemId);
}

// Аватарки (avatars/{uid}) можуть завантажитися пізніше за монтування
export function repaintAvatars() {
  updateFriendSortRow();
  if (detailState && document.body.contains(detailState.overlay)) {
    const item = list.find(m => m.id === detailState.itemId);
    const l = detailState.box && detailState.box.querySelector('.friends-list');
    if (item && l) l.innerHTML = friendRowsHTML(item.ratings);
  }
}

// ---------- Каркас вкладки ----------

function buildSkeleton() {
  const c = cfg();
  const wasSearchFocused = document.activeElement && document.activeElement.id === 'libSearch' && container.contains(document.activeElement);
  const caret = wasSearchFocused ? document.activeElement.selectionStart : 0;

  container.innerHTML = `
    <div class="view-head">
      <div class="search-wrap">
        ${icons.search}
        <input id="libSearch" type="search" placeholder="${c.searchPlaceholder}"
               value="${U.escapeHtml(query)}" aria-label="${c.searchPlaceholder}">
      </div>
      <select id="libSort" class="sort-select" aria-label="Сортування">
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
      <button class="btn primary add-btn" id="libAddBtn">${icons.plus}<span>${c.addBtn}</span></button>
    </div>
    ${friendSortRowHTML()}
    <div id="libGrid" class="${view === 'table' ? 'table-wrap' : 'grid'}"></div>`;

  gridEl = container.querySelector('#libGrid');
  const sortEl = container.querySelector('#libSort');
  sortEl.value = sort;
  sortEl.addEventListener('change', () => {
    sort = sortEl.value;
    try { localStorage.setItem(lsKey('sort'), sort); } catch (e) {}
    refreshGrid();
    updateFriendSortRow();
  });
  container.querySelector('#libSearch').addEventListener('input', U.debounce((e) => {
    query = e.target.value;
    refreshGrid();
  }, 200));
  container.querySelector('#libAddBtn').addEventListener('click', openAdd);

  wireFriendSortRow();
  updateFriendSortRow();

  container.querySelectorAll('[data-view-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.viewBtn;
      if (v === view) return;
      view = v;
      try { localStorage.setItem(lsKey('view'), view); } catch (e) {}
      buildSkeleton();
      refreshGrid();
    });
  });

  gridEl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      if (th.dataset.friend) {
        if (sort === 'friend' && friendId === th.dataset.friend) {
          friendDir = friendDir === 'asc' ? 'desc' : 'asc';
          try { localStorage.setItem(lsKey('sortdir'), friendDir); } catch (e2) {}
        } else {
          friendId = th.dataset.friend;
          try { localStorage.setItem(lsKey('sortfriend'), friendId); } catch (e2) {}
        }
      }
      sort = th.dataset.sort;
      try { localStorage.setItem(lsKey('sort'), sort); } catch (e2) {}
      const sel = container.querySelector('#libSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const row = e.target.closest('.card, .t-row');
      const item = row && list.find(m => m.id === row.dataset.id);
      if (item) openFormModal({ kind, item, currentUserId, allItems: list });
      return;
    }
    const rateBtn = e.target.closest('[data-rate]');
    if (rateBtn) {
      const row = e.target.closest('.card, .t-row');
      const item = row && list.find(m => m.id === row.dataset.id);
      if (item) openRatePop(rateBtn, item);
      return;
    }
    // Прев'ю фрагмента — перше, бо кнопка лежить на обкладинці картки
    const playBtn = e.target.closest('[data-play]');
    if (playBtn) {
      const item = list.find(m => m.id === playBtn.dataset.play);
      if (item && item.preview) togglePreview(item.id, item.preview);
      return;
    }
    const myCell = e.target.closest('td.u-col.mine');
    if (myCell) {
      const row = e.target.closest('.t-row');
      const item = row && list.find(m => m.id === row.dataset.id);
      if (item) openRatePop(myCell, item);
      return;
    }
    const row = e.target.closest('.card, .t-row');
    if (!row) return;
    const item = list.find(m => m.id === row.dataset.id);
    if (!item) return;
    openDetail(item.id);
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest('.card, .t-row');
    if (row && e.target === row) openDetail(row.dataset.id);
  });

  if (wasSearchFocused) {
    const inp = container.querySelector('#libSearch');
    inp.focus();
    try { inp.setSelectionRange(caret, caret); } catch (e) {}
  }
}

// ---------- Рядок «За оцінкою друга» ----------

function friendSortRowHTML() {
  if (!friendId) {
    const other = USERS.find(u => u.id !== currentUserId) || USERS[0];
    friendId = other ? other.id : null;
  }
  return `<div class="friend-sort-row" id="libFriendSortRow" hidden>
    <span class="fs-label">Оцінка друга:</span>
    <div class="fs-chips">${USERS.map(u => `
      <button type="button" class="fs-chip ${u.id === friendId ? 'active' : ''}" data-friend-chip="${u.id}" title="Сортувати за оцінками ${U.escapeHtml(u.name)}">
        ${A.avatarHTML(u, 'sm')}<span>${U.escapeHtml(u.name)}</span>
      </button>`).join('')}</div>
    <button type="button" class="icon-btn fs-dir" id="libFriendDirBtn" aria-label="Напрямок сортування" title="Спочатку вищі оцінки"></button>
  </div>`;
}

function updateFriendSortRow() {
  const row = container && container.querySelector('#libFriendSortRow');
  if (!row) return;
  row.hidden = sort !== 'friend';
  row.querySelectorAll('[data-friend-chip]').forEach(b => {
    const u = USERS.find(x => x.id === b.dataset.friendChip);
    const av = b.querySelector('.avatar');
    if (u && av) av.outerHTML = A.avatarHTML(u, 'sm');
    b.classList.toggle('active', b.dataset.friendChip === friendId);
  });
  const dirBtn = row.querySelector('#libFriendDirBtn');
  if (dirBtn) {
    const desc = friendDir !== 'asc';
    dirBtn.innerHTML = desc ? icons.arrowDown : icons.arrowUp;
    dirBtn.title = desc ? 'Спочатку вищі оцінки' : 'Спочатку нижчі оцінки';
  }
}

function wireFriendSortRow() {
  const row = container && container.querySelector('#libFriendSortRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-friend-chip]');
    if (chip) {
      if (friendId === chip.dataset.friendChip && sort === 'friend') {
        friendDir = friendDir === 'asc' ? 'desc' : 'asc';
        try { localStorage.setItem(lsKey('sortdir'), friendDir); } catch (e2) {}
      } else {
        friendId = chip.dataset.friendChip;
        try { localStorage.setItem(lsKey('sortfriend'), friendId); } catch (e2) {}
      }
      sort = 'friend';
      try { localStorage.setItem(lsKey('sort'), sort); } catch (e2) {}
      const sel = container.querySelector('#libSort');
      if (sel) sel.value = sort;
      updateFriendSortRow();
      refreshGrid();
      return;
    }
    if (e.target.closest('#libFriendDirBtn')) {
      friendDir = friendDir === 'asc' ? 'desc' : 'asc';
      try { localStorage.setItem(lsKey('sortdir'), friendDir); } catch (e2) {}
      updateFriendSortRow();
      refreshGrid();
    }
  });
}

// ---------- Фільтрація і сортування ----------

function filtered() {
  const q = query.trim().toLowerCase();
  let out = list;
  if (q) {
    const qEn = U.genreEn(q);
    out = out.filter(m => {
      const hay = [m.title, m.titleUk, personOf(m), m.publisher, ...(m.genres || []), ...(m.tracks || [])]
        .map(x => String(x || '').toLowerCase());
      if (hay.some(x => x.includes(q))) return true;
      if (qEn && qEn !== q) {
        const gEn = (m.genres || []).map(x => String(U.genreEn(x) || '').toLowerCase());
        if (gEn.some(x => x.includes(qEn))) return true;
      }
      return false;
    });
  }
  const withAvg = m => { const a = U.avg(m.ratings); return a == null ? -1 : a; };
  const withFriendAvg = m => {
    const rs = { ...(m.ratings || {}) };
    delete rs[currentUserId];
    const a = U.avg(rs);
    return a == null ? -1 : a;
  };
  switch (sort) {
    case 'old': return [...out].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case 'rating': return [...out].sort((a, b) => withAvg(b) - withAvg(a));
    case 'friends': return [...out].sort((a, b) => withFriendAvg(b) - withFriendAvg(a));
    case 'friend': {
      const val = m => {
        const v = (m.ratings || {})[friendId];
        return typeof v === 'number' ? v : null;
      };
      const rated = out.filter(m => val(m) != null)
        .sort((a, b) => friendDir === 'asc' ? val(a) - val(b) : val(b) - val(a));
      return rated.concat(out.filter(m => val(m) == null));
    }
    case 'year': return [...out].sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'title': return [...out].sort((a, b) => String(a.title || a.titleUk || '').localeCompare(String(b.title || b.titleUk || ''), 'uk'));
    default: return [...out].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

// ---------- Сітка ----------

function refreshGrid() {
  if (!gridEl) return;
  const c = cfg();

  if (loadError) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon err">${icons.alert}</span>
        <h3>Не вдалося завантажити ${kind === 'book' ? 'книги' : kind === 'single' ? 'сингли' : 'альбоми'}</h3>
        <p>Перевірте зʼєднання та правила доступу Firebase Realtime Database.</p>
        <button class="btn primary" onclick="location.reload()">Спробувати знову</button>
      </div>`;
    return;
  }

  if (isLoading) {
    renderSkeleton();
    return;
  }

  if (!list.length && !query.trim()) {
    gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon">${c.icon}</span>
        <h3>${c.emptyTitle}</h3>
        <p>${c.emptyText}</p>
        <button class="btn primary" id="libEmptyAdd">${icons.plus}<span>${c.addBtn}</span></button>
      </div>`;
    gridEl.querySelector('#libEmptyAdd').addEventListener('click', openAdd);
    return;
  }

  const shown = filtered();
  if (!shown.length) {
    gridEl.innerHTML = `
      <div class="state-box slim">
        <span class="state-icon">${icons.search}</span>
        <h3>Нічого не знайдено</h3>
        <p>Спробуйте змінити запит «${U.escapeHtml(query.trim())}».</p>
      </div>`;
    return;
  }

  gridEl.innerHTML = view === 'table'
    ? tableHTML(shown)
    : shown.map(cardHTML).join('');
  paintPlayButtons();
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
      <div class="poster ${cfg().sq ? 'sq' : ''} skeleton"></div>
      <div class="card-body">
        <div class="skeleton sk-line w-70"></div>
        <div class="skeleton sk-line w-45"></div>
        <div class="skeleton sk-line w-55"></div>
        <div class="skeleton sk-line w-80"></div>
      </div>
    </div>`).join('');
}

// ---------- Табличний вигляд ----------

function tableHTML(rows) {
  const c = cfg();
  const thSort = (key, label, extra = '') =>
    `<th class="sortable ${sort === key ? 'active' : ''} ${extra}" data-sort="${key}" scope="col" title="Сортувати">${label}</th>`;

  const userHeads = USERS.map(u => {
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
      ${thSort('title', kind === 'book' ? 'Книга' : kind === 'single' ? 'Сингл' : 'Альбом')}
      ${thSort('year', 'Рік')}
      <th scope="col">${c.person}</th>
      <th scope="col">Жанри</th>
      ${thSort('rating', 'Сер.')}
      ${userHeads}
      <th scope="col" aria-hidden="true"></th>
    </tr></thead>
    <tbody>${rows.map(rowHTML).join('')}</tbody>
  </table>`;
}

function rowHTML(m) {
  const a = U.avg(m.ratings);
  const mainTitle = mTitle(m);
  const person = personOf(m);

  const userCells = USERS.map(u => {
    const v = (m.ratings || {})[u.id];
    return `<td class="u-col ${u.id === currentUserId ? 'mine' : ''}">${v != null
      ? `<span class="t-score" style="background:${U.ratingColor(v)}" title="${U.escapeHtml(u.name)}: ${v}">${v}</span>`
      : `<span class="t-score empty" title="${U.escapeHtml(u.name)}: без оцінки">—</span>`}
    </td>`;
  }).join('');

  return `
  <tr class="t-row" data-id="${m.id}" tabindex="0" aria-label="${U.escapeHtml(mainTitle)}">
    <td>
      <div class="t-film">
        <span class="t-poster">${m.cover
          ? `<img src="${U.escapeHtml(U.posterUrl(m.cover, 80))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
          : cfg().icon}</span>
        <span class="t-titles">
          <span class="t-name">${U.escapeHtml(mainTitle)}</span>
        </span>
      </div>
    </td>
    <td class="t-num t-muted">${m.year || '—'}</td>
    <td class="t-muted" title="${U.escapeHtml(person || '')}">${person ? U.escapeHtml(U.trunc(person, 28)) : '—'}</td>
    <td class="t-muted t-genres" title="${U.escapeHtml((m.genres || []).join(', '))}">${m.genres && m.genres.length ? U.escapeHtml(U.trunc(m.genres.join(', '), 32)) : '—'}</td>
    <td>${a != null
      ? `<span class="avg-badge sm" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>`
      : `<span class="t-muted">—</span>`}</td>
    ${userCells}
    <td>
      <button class="icon-btn t-edit" data-edit aria-label="Редагувати" title="Редагувати">${icons.edit}</button>
    </td>
  </tr>`;
}

function cardHTML(m) {
  const c = cfg();
  const a = U.avg(m.ratings);
  const my = (m.ratings || {})[currentUserId];
  const mainTitle = mTitle(m);
  const person = personOf(m);
  const ratedCount = Object.keys(m.ratings || {}).length;
  const metaBits = [
    m.year,
    person ? U.trunc(person, 30) : '',
    kind === 'album' && m.tracks && m.tracks.length
      ? `${m.tracks.length} ${U.plural(m.tracks.length, ['трек', 'треки', 'треків'])}` : '',
    ratedCount ? `${ratedCount} ${U.pluralRatings(ratedCount)}` : 'без оцінок'
  ].filter(Boolean).join(' · ');

  const friendChips = USERS
    .filter(u => (m.ratings || {})[u.id] != null)
    .map(u => `<span class="fchip" title="${U.escapeHtml(u.name)}: ${m.ratings[u.id]}"><i style="background:${u.color}"></i>${m.ratings[u.id]}</span>`)
    .join('');

  return `
  <article class="card" data-id="${m.id}" tabindex="0" role="button" aria-label="${U.escapeHtml(mainTitle)}">
    <div class="poster ${c.sq ? 'sq' : ''}">
      ${m.cover ? `<img src="${U.escapeHtml(U.posterUrl(m.cover, 300))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${c.icon}
      ${a != null ? `<span class="avg-badge float" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      ${m.preview ? `<button class="play-btn" data-play="${m.id}" aria-label="Прослухати 30-секундний фрагмент" title="Прослухати 30 сек"><span class="pb-icon">${icons.play}</span></button>` : ''}
      <button class="icon-btn card-edit" data-edit aria-label="Редагувати" title="Редагувати">${icons.edit}</button>
    </div>
    <div class="card-body">
      <h3 class="card-title">${U.escapeHtml(mainTitle)}</h3>
      <div class="card-meta">${U.escapeHtml(metaBits)}</div>
      <div class="rating-row">
        <button class="rate-btn ${my != null ? 'rated' : ''}" data-rate aria-label="Оцінити" ${my != null ? `style="--my:${U.ratingColor(my)}"` : ''}>
          ${icons.star}<span>${my != null ? my : 'Оцінити'}</span>
        </button>
      </div>
      ${friendChips ? `<div class="fchips">${friendChips}</div>` : ''}
    </div>
  </article>`;
}

// ---------- Швидке оцінювання (спільна спливашка rating-ui.js) ----------

function openRatePop(anchor, item) {
  openRatePopShared({
    anchor,
    title: mTitle(item),
    ratings: item.ratings || {},
    currentUserId,
    onSave: async (next, cur) => {
      try {
        await store.setMediaRating(cfg().node, item.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyMediaRatingRemoved(currentUserId, item);
        else notifyMediaRatingSet(currentUserId, item, next, cur);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        return false;
      }
    },
    onRemove: async () => {
      try {
        await store.setMediaRating(cfg().node, item.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyMediaRatingRemoved(currentUserId, item);
        return true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
        return false;
      }
    }
  });
}

// ---------- Модальне вікно ----------

function openDetail(itemId) {
  if (detailState && document.body.contains(detailState.overlay)) {
    if (detailState.itemId === itemId) return;
    detailState.close();
    detailState = null;
  }
  const item = list.find(m => m.id === itemId);
  if (!item) return;
  const { overlay, box, close } = openModal(detailHTML(item), {
    width: 760,
    label: mTitle(item)
  });
  // Закриття вікна зупиняє й прев'ю (кнопка живе в hero)
  const closeAll = () => { stopPreview(); close(); };
  // Закриття вікна (✕, Esc, клік по фону — будь-яким шляхом) зупиняє
  // прев'ю: стежимо за самим видаленням оверлея з DOM
  const mo = new MutationObserver(() => {
    if (!document.body.contains(overlay)) { stopPreview(); mo.disconnect(); }
  });
  try { mo.observe(document.getElementById('modalRoot'), { childList: true }); } catch (e) {}
  detailState = { overlay, box, itemId, close: closeAll };
  wireDetail(box);
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

function detailHTML(m) {
  const c = cfg();
  const a = U.avg(m.ratings);
  const my = (m.ratings || {})[currentUserId];
  const person = personOf(m);
  const personTitle = kind === 'book' ? 'Твори цього автора' : (kind === 'single' ? 'Сингли цього виконавця' : 'Альбоми цього виконавця');
  const kindBadge = `<span class="kind-badge">${c.one}</span>`;
  const metaBits = [
    m.year,
    kindBadge,
    kind === 'album' && m.tracks && m.tracks.length ? `${m.tracks.length} ${U.plural(m.tracks.length, ['трек', 'треки', 'треків'])}` : '',
    kind === 'book' && m.pages ? `${m.pages} ${U.plural(m.pages, ['сторінка', 'сторінки', 'сторінок'])}` : ''
  ].filter(Boolean).join(' · ');
  const genres = (m.genres || []).map(g =>
    `<button type="button" class="genre-chip clickable" data-person="${U.escapeHtml(g)}" title="Записи цього жанру">${U.escapeHtml(g)}</button>`
  ).join('');
  const personBtn = person
    ? `<button type="button" class="person-link" data-person="${U.escapeHtml(person)}" title="${personTitle}">${U.escapeHtml(person)}</button>`
    : '';
  const pubLine = m.publisher
    ? `<p class="pub-note"><span class="pub-line">${kind === 'book' ? 'видавництво' : 'лейбл'}: <b>${U.escapeHtml(m.publisher)}</b></span></p>` : '';

  const tracks = kind === 'album' && (m.tracks || []).length
    ? `<div class="tracks-box"><span class="cast-label">Трекліст:</span><ol class="tracks">${m.tracks.map(t =>
        `<li>${U.escapeHtml(t)}</li>`).join('')}</ol></div>` : '';

  const friendRows = friendRowsHTML(m.ratings);

  const adder = USERS.find(u => u.id === m.addedBy);
  const addedLine = m.addedBy
    ? `Додав${adder ? '' : ' користувач'}: <b>${U.escapeHtml(adder ? adder.name : m.addedBy)}</b>${m.createdAt ? ' · ' + U.fmtDate(m.createdAt) : ''}`
    : '';

  return `
  <div class="detail-hero">
    ${m.cover ? `<img class="hero-bg" src="${U.escapeHtml(U.posterUrl(m.cover, 400))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="hero-shade"></div>
    <button class="icon-btn hero-close" data-close aria-label="Закрити">${icons.close}</button>
    <div class="hero-body">
      ${m.cover
        ? `<img class="hero-poster ${c.sq ? 'sq' : ''}" src="${U.escapeHtml(U.posterUrl(m.cover, 300))}" alt="Обкладинка: ${U.escapeHtml(mTitle(m))}" referrerpolicy="no-referrer" onerror="this.classList.add('broken'); this.removeAttribute('src')">`
        : `<span class="hero-poster placeholder ${c.sq ? 'sq' : ''}">${c.icon}</span>`}
      <div class="hero-text">
        <h2 class="detail-heading">${U.escapeHtml(mTitle(m))}</h2>
        <div class="detail-meta">${[person ? personBtn : '', metaBits].filter(Boolean).join(' · ')}</div>
        <div class="hero-actions">
          ${a != null ? `<span class="avg-big" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
          ${m.preview ? `<button type="button" class="play-btn lg" data-play="${m.id}" aria-label="Прослухати 30-секундний фрагмент" title="30-секундний фрагмент"><span class="pb-icon">${icons.play}</span><span>Прослухати</span></button>` : ''}
        </div>
      </div>
    </div>
  </div>
  <div class="detail-scroll">
    <div class="detail-info">
      ${genres ? `<div class="genre-row">${genres}</div>` : ''}
      ${tracks}
      ${pubLine}
      ${m.plot ? `<p class="detail-plot">${U.escapeHtml(m.plot)}</p>` : ''}
      <div class="detail-links">
        ${m.wikiUrl ? `<a class="imdb-link" href="${U.escapeHtml(m.wikiUrl)}" target="_blank" rel="noopener">${icons.link}<span>Вікіпедія</span></a>` : ''}
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
    const item0 = (detailState && document.body.contains(detailState.overlay))
      ? list.find(m => m.id === detailState.itemId) : null;
    paintTrail(box, item0 ? (item0.ratings || {})[currentUserId] : null);
  });

  box.addEventListener('click', async (e) => {
    if (!detailState || !document.body.contains(detailState.overlay)) return;
    const item = list.find(m => m.id === detailState.itemId);
    if (!item) return;

    // Клік на виконавця/автора/жанр — фільтруємо поточну колекцію
    const person = e.target.closest('[data-person]');
    if (person) {
      const q = person.dataset.person;
      detailState.close();
      setFilter(q);
      return;
    }

    // Прев'ю фрагмента прямо у вікні
    const playBtn = e.target.closest('[data-play]');
    if (playBtn) {
      if (item.preview) togglePreview(item.id, item.preview);
      return;
    }

    const seg = e.target.closest('.rt-seg');
    if (seg) {
      if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
      const score = +seg.dataset.score;
      const cur = (item.ratings || {})[currentUserId];
      const next = (cur === score) ? null : score;
      paintTrail(box, next);
      popValue(box);
      try {
        await store.setMediaRating(cfg().node, item.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyMediaRatingRemoved(currentUserId, item);
        else notifyMediaRatingSet(currentUserId, item, next, cur != null ? cur : null);
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
        paintTrail(box, cur);
      }
      return;
    }

    if (e.target.closest('[data-remove-rating]')) {
      try {
        await store.setMediaRating(cfg().node, item.id, currentUserId, null);
        toast('Оцінку прибрано');
        notifyMediaRatingRemoved(currentUserId, item);
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
      }
      return;
    }

    if (e.target.closest('[data-act="edit"]')) {
      detailState.close();
      openFormModal({ kind, item, currentUserId, allItems: list });
      return;
    }

    if (e.target.closest('[data-act="delete"]')) {
      const ok = await confirmDialog({
        title: `Видалити ${cfg().oneAcc}?`,
        text: `«${mTitle(item)}» та всі його оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteMedia(cfg().node, item.id);
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити', 'err');
        return;
      }
      toast('Видалено');
      notifyMediaDeleted(currentUserId, item);
      if (detailState) { detailState.close(); detailState = null; }
    }
  });
}

// Оновлює відкрите вікно, коли дані змінилися
function refreshDetail() {
  if (!detailState) return;
  const { overlay, box, itemId, close } = detailState;
  if (!document.body.contains(overlay)) { detailState = null; return; }
  const item = list.find(m => m.id === itemId);
  if (!item) { stopPreview(); close(); detailState = null; return; }
  box.innerHTML = detailHTML(item);
  paintPlayButtons();
}
