// ============================================================
// Фабрика вкладок-колекцій («Фільми» та «Ігри»): сітка карток АБО
// таблиця, пошук/сортування (зокрема за оцінками конкретного друга),
// швидке оцінювання, модальне вікно з оцінками 1–10.
//
// Колекції живуть у різних вузлах бази (films / games), але мають
// однакову поведінку й вигляд; усе, що відрізняється (тексти, поля,
// форма додавання), передається через конфіг у createCollectionView().
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons, lockScroll, unlockScroll, ratingTrailHTML, paintRatingTrail, wireRatingTrail, popRatingValue } from './ui.js';
import { notifyRatingSet, notifyRatingRemoved, notifyItemDeleted } from './telegram.js';
import { avatarHTML } from './avatars.js';

// Слова-підписи шкали оцінок (спільні для фільмів та ігор)
// Шкала оцінки (зорі) і її хелпери тепер у ui.js — спільні з формою
// додавання (ratingTrailHTML / paintRatingTrail / wireRatingTrail).

export function createCollectionView(cfg) {
  const node = cfg.node; // вузол бази: 'films' | 'games'
  const kind = cfg.kind; // тип запису для сповіщень: 'film' | 'game'
  const T = cfg.texts;   // усі тексти вкладки
  const eventName = kind === 'game' ? 'games:filter' : 'films:filter';
  const emptyIcon = kind === 'game' ? icons.gamepad : icons.clapper;

  let container = null;
  let gridEl = null;
  let filmsList = [];
  let isLoading = true;
  let loadError = null;
  let query = '';
  let sort = localStorage.getItem('films_sort') || 'new';
  let view = localStorage.getItem('films_view') === 'table' ? 'table' : 'grid'; // сітка або таблиця
  let currentUserId = null;
  let detailState = null; // { overlay, box, filmId, close }
  let ratePop = null;     // { el, backdrop, sheet }

  // ---------- Публічний інтерфейс ----------

  function mount(el) {
    container = el;
    buildSkeleton();
    refreshGrid();
  }

  function setList(list) {
    if (list === null) { isLoading = true; }
    else { isLoading = false; filmsList = list; loadError = null; }
    refreshGrid();
    refreshDetail();
  }

  function setError(err) {
    loadError = err;
    refreshGrid();
  }

  function setUser(userId) {
    if (currentUserId === userId) return;
    currentUserId = userId;
    refreshGrid();
    refreshDetail();
  }

  function openAdd() {
    cfg.openForm({ film: null, currentUserId, allFilms: filmsList });
  }

  // Зовнішній фільтр (клік на людину/жанр у модалці чи статистиці).
  // Якщо вкладка ще не змонтована — просимо app.js її переключити.
  function setFilter(q) {
    query = String(q || '');
    if (!document.getElementById('filmSearch') || !container.contains(document.getElementById('filmSearch'))) {
      document.dispatchEvent(new CustomEvent(eventName, { detail: String(q || '') }));
      return;
    }
    const inp = document.getElementById('filmSearch');
    inp.value = query;
    // На дотик-пристроях не фокусуємо поле програмно — інакше iOS/Android
    // розкривають клавіатуру поверх щойно відфільтрованого списку
    if (!window.matchMedia('(pointer: coarse)').matches) inp.focus();
    refreshGrid();
  }

  // Відкрити запис за id (deep-link із Telegram, «Рекорди» статистики).
  // Список актуальний — app.js оновлює його навіть поза вкладкою.
  function openItemById(itemId) {
    if (filmsList.some(f => f.id === itemId)) openDetail(itemId);
  }

  // ---------- Каркас вкладки ----------

  function buildSkeleton() {
    const wasSearchFocused = document.activeElement && document.activeElement.id === 'filmSearch' && container.contains(document.activeElement);
    const caret = wasSearchFocused ? document.activeElement.selectionStart : 0;

    container.innerHTML = `
    <div class="view-head">
      <div class="search-wrap">
        ${icons.search}
        <input id="filmSearch" type="search" placeholder="${T.searchPlaceholder}"
               value="${U.escapeHtml(query)}" aria-label="${T.searchAria}">
      </div>
      <select id="filmSort" class="sort-select" aria-label="Сортування">
        <option value="new">Спочатку нові</option>
        <option value="old">Спочатку старі</option>
        <option value="rating">За рейтингом</option>
        <option value="year">За роком</option>
        <option value="title">За назвою (А–Я)</option>
        <optgroup label="Оцінки друга">
          ${USERS.map(u => `<option value="user:${u.id}">Оцінки: ${U.escapeHtml(u.name)} ↓</option>` +
            `<option value="user-asc:${u.id}">Оцінки: ${U.escapeHtml(u.name)} ↑</option>`).join('')}
        </optgroup>
      </select>
      <div class="view-toggle" role="group" aria-label="Вигляд списку">
        <button type="button" data-view-btn="grid" class="${view === 'grid' ? 'active' : ''}" title="Сітка" aria-label="Вигляд: сітка">${icons.grid}</button>
        <button type="button" data-view-btn="table" class="${view === 'table' ? 'active' : ''}" title="Таблиця" aria-label="Вигляд: таблиця">${icons.table}</button>
      </div>
      <button class="btn primary add-btn" id="addBtn">${icons.plus}<span>${T.addBtn}</span></button>
    </div>
    <div id="filmsGrid" class="${view === 'table' ? 'table-wrap' : 'grid'}"></div>`;

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

    // Перемикання сітка ⇄ таблиця (запам'ятовується між сесіями)
    container.querySelectorAll('[data-view-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.viewBtn;
        if (v === view) return;
        view = v;
        try { localStorage.setItem('films_view', view); } catch (e) {}
        buildSkeleton(); // перебудовує каркас (зберігає фокус пошуку)
        refreshGrid();
      });
    });

    // Кліки: заголовки-сортування в таблиці (в т.ч. колонки друзів),
    // кнопка «редагувати», швидка оцінка (кнопка на картці / своя
    // комірка в таблиці), відкриття картки/рядка
    gridEl.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const k = th.dataset.sort;
        // Колонки друзів: повторний клік перемикає напрямок ↓ ⇄ ↑
        sort = (k.startsWith('user:') && sort === k) ? 'user-asc:' + k.slice(5) : k;
        localStorage.setItem('films_sort', sort);
        const sel = container.querySelector('#filmSort');
        if (sel) sel.value = sort;
        refreshGrid();
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const row = e.target.closest('.card, .t-row');
        const film = row && filmsList.find(f => f.id === row.dataset.id);
        if (film) cfg.openForm({ film, currentUserId, allFilms: filmsList });
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

  // ---------- Фільтрація і сортування ----------

  function filtered() {
    const q = query.trim().toLowerCase();
    let list = filmsList;
    if (q) {
      // Жанри в базі двомовні (старі записи укр., нові англ.) — «драма»
      // має знаходити і записи з жанром "drama", і навпаки
      const qEn = U.genreEn(q);
      list = list.filter(f => {
        const hay = cfg.searchHay(f).map(x => String(x || '').toLowerCase());
        if (hay.some(x => x.includes(q))) return true;
        if (qEn && qEn !== q) {
          const gEn = (f.genres || []).map(g => String(U.genreEn(g) || '').toLowerCase());
          if (gEn.some(x => x.includes(qEn))) return true;
        }
        return false;
      });
    }
    // Сортування за оцінками конкретного друга («user:<id>» — від вищої,
    // «user-asc:<id>» — від нижчої): оцінені — зверху, без оцінки — у кінці
    if (typeof sort === 'string' && (sort.startsWith('user:') || sort.startsWith('user-asc:'))) {
      const asc = sort.startsWith('user-asc:');
      const uid = sort.slice(asc ? 9 : 5);
      const score = f => {
        const v = (f.ratings || {})[uid];
        return v == null ? (asc ? Infinity : -1) : v; // без оцінки — завжди унизу
      };
      return [...list].sort((a, b) => asc ? score(a) - score(b) : score(b) - score(a));
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
        <h3>${T.errTitle}</h3>
        <p>Перевірте зʼєднання та правила доступу Firebase Realtime Database.</p>
        <button class="btn primary" onclick="location.reload()">Спробувати знову</button>
      </div>`;
      return;
    }

    if (isLoading) {
      renderSkeleton();
      return;
    }

    if (!filmsList.length && !query.trim()) {
      gridEl.innerHTML = `
      <div class="state-box">
        <span class="state-icon">${emptyIcon}</span>
        <h3>${T.emptyTitle}</h3>
        <p>${T.emptyText}</p>
        <button class="btn primary" id="emptyAdd">${icons.plus}<span>${T.addBtn}</span></button>
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
    const thSort = (key, label, extra = '') =>
      `<th class="sortable ${sort === key ? 'active' : ''} ${extra}" data-sort="${key}" scope="col" title="Сортувати">${label}</th>`;

    // Колонки друзів тепер теж сортовані: клік — «за оцінками друга»
    // (аватарка: фото, якщо друг його завантажив, інакше літера)
    const userHeads = USERS.map(u => {
      const desc = sort === 'user:' + u.id;
      const asc = sort === 'user-asc:' + u.id;
      return `
    <th class="u-col sortable ${desc || asc ? 'active' : ''} ${asc ? 'asc' : ''}" data-sort="user:${u.id}"
        scope="col" title="Сортувати за оцінками: ${U.escapeHtml(u.name)}">
      ${avatarHTML(u, 'u-head', u.id === currentUserId ? 'mine' : '')}
    </th>`;
    }).join('');

    return `
  <table class="films-table">
    <thead><tr>
      ${thSort('title', T.colTitle)}
      ${thSort('year', 'Рік')}
      <th scope="col">${T.colPerson}</th>
      <th scope="col">Жанри</th>
      <th scope="col" class="${T.colExtraNum ? 't-num' : ''}">${T.colExtra}</th>
      ${thSort('rating', 'Сер.')}
      ${userHeads}
      <th scope="col" aria-hidden="true"></th>
    </tr></thead>
    <tbody>${list.map(rowHTML).join('')}</tbody>
  </table>`;
  }

  function rowHTML(f) {
    const a = U.avg(f.ratings);
    const mainTitle = f.titleUk || f.title || 'Без назви';
    const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
    const person = cfg.mainPerson(f) || '';
    const extra = cfg.extraText(f) || '';

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
    <td class="t-num t-muted">${f.year || '—'}</td>
    <td class="t-muted" title="${U.escapeHtml(person)}">${person ? U.escapeHtml(U.trunc(person, 28)) : '—'}</td>
    <td class="t-muted t-genres" title="${U.escapeHtml((f.genres || []).join(', '))}">${f.genres && f.genres.length ? U.escapeHtml(U.trunc(f.genres.join(', '), 32)) : '—'}</td>
    <td class="${T.colExtraNum ? 't-num t-muted' : 't-muted'}">${U.escapeHtml(extra) || '—'}</td>
    <td>${a != null
      ? `<span class="avg-badge sm" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>`
      : `<span class="t-muted">—</span>`}</td>
    ${userCells}
    <td>
      <button class="icon-btn t-edit" data-edit aria-label="${T.editAria}" title="Редагувати">${icons.edit}</button>
    </td>
  </tr>`;
  }

  function cardHTML(f) {
    const a = U.avg(f.ratings);
    const my = (f.ratings || {})[currentUserId];
    const mainTitle = f.titleUk || f.title || 'Без назви';
    const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
    const ratedCount = Object.keys(f.ratings || {}).length;
    const metaBits = [
      ...cfg.cardMeta(f),
      ratedCount ? `${ratedCount} ${U.pluralRatings(ratedCount)}` : 'без оцінок'
    ].filter(Boolean).join(' · ');

    const friendChips = USERS
      .filter(u => (f.ratings || {})[u.id] != null)
      .map(u => `<span class="fchip" title="${U.escapeHtml(u.name)}: ${f.ratings[u.id]}" style="--c:${u.color}"><i></i>${f.ratings[u.id]}</span>`)
      .join('');

    return `
  <article class="card" data-id="${f.id}" tabindex="0" role="button" aria-label="${U.escapeHtml(mainTitle)}">
    <div class="poster">
      ${f.poster ? `<img src="${U.escapeHtml(U.posterUrl(f.poster, 300))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      ${icons.film}
      ${a != null ? `<span class="avg-badge float" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      <button class="icon-btn card-edit" data-edit aria-label="${T.editAria}" title="Редагувати">${icons.edit}</button>
    </div>
    <div class="card-body">
      <h3 class="card-title">${U.escapeHtml(mainTitle)}</h3>
      ${orig ? `<div class="card-sub">${U.escapeHtml(orig)}</div>` : ''}
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

  // ---------- Швидке оцінювання ----------
  // Робимо оцінювання максимально простим:
  //  • десктоп — спливне вікно біля кнопки з підсвіткою шкали при наведенні
  //    та живим підписом («Добре», «Шедевр»…);
  //  • мобільний (≤640px) — шіт, що виїжджає знизу: великий шрифт,
  //    великі кнопки, зручно великою пальцем;
  //  • клавіатура: цифри 1–9, 0 (десять), стрілки ←/→, Enter, Esc.

  function closeRatePop() {
    if (!ratePop) return;
    const { el, backdrop, sheet } = ratePop;
    ratePop = null;
    document.removeEventListener('mousedown', onPopOutside, true);
    document.removeEventListener('keydown', onPopKey, true);
    window.removeEventListener('scroll', onPopScroll, true);
    window.removeEventListener('resize', onPopScroll);
    if (sheet) unlockScroll(); // фоновий скрол був заблокований на час шіта
    if (backdrop) {
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 220);
    }
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }

  function onPopOutside(e) {
    if (ratePop && !ratePop.sheet && !ratePop.el.contains(e.target)) closeRatePop();
  }

  function onPopKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeRatePop(); }
  }

  function onPopScroll() {
    if (ratePop && !ratePop.sheet) closeRatePop();
  }

  function buildRatePop(item) {
    const my = (item.ratings || {})[currentUserId];
    const a = U.avg(item.ratings);
    const votes = Object.keys(item.ratings || {}).length;
    const pop = document.createElement('div');
    pop.className = 'rate-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', `Оцінити «${fTitle(item)}»`);
    pop.innerHTML = `
    <div class="pop-grab" aria-hidden="true"></div>
    <div class="rate-pop-title" title="${U.escapeHtml(fTitle(item))}">${U.escapeHtml(fTitle(item))}</div>
    <div class="rate-pop-sub">${
      a != null
        ? `Середня <b>${U.fmtAvg(a)}</b> · ${votes} ${U.pluralRatings(votes)}${my != null ? ` · ваша ${my}` : ''}`
        : (my != null ? `Ваша оцінка ${my}` : 'Перший відгук — ваш!')
    }</div>
    <div class="rt" role="group" aria-label="Оцінка від 1 до 10">${ratingTrailHTML(my)}</div>
    ${my != null ? '<button type="button" class="remove-rating" data-pop-remove>Прибрати мою оцінку</button>' : ''}`;
    return pop;
  }

  // ---------- Компонент «шкала оцінки» (зорі) ----------
  // Логіка шкали тепер у ui.js (ratingTrailHTML / paintRatingTrail /
  // wireRatingTrail) — спільна з формою додавання фільму/гри.

  function openRatePop(anchor, item) {
    if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
    closeRatePop();

    const pop = buildRatePop(item);
    const isSheet = window.matchMedia('(max-width: 640px)').matches;
    let backdrop = null;

    document.body.appendChild(pop);

    if (isSheet) {
      pop.classList.add('sheet');
      backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      lockScroll(); // iOS: сторінка не має скролитися крізь шіт
      backdrop.addEventListener('mousedown', closeRatePop);
      backdrop.addEventListener('click', closeRatePop);
    } else {
      // Позиція біля якоря, з врахуванням меж екрана
      const r = anchor.getBoundingClientRect();
      const pw = pop.offsetWidth || 300;
      const ph = pop.offsetHeight || 250;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(10, Math.min(left, vw - pw - 10));
      let top = r.bottom + 8;
      if (top + ph > vh - 10) top = r.top - ph - 8; // не влазить знизу — відкриваємо вгору
      top = Math.max(10, top);
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }

    ratePop = { el: pop, backdrop, sheet: isSheet };
    requestAnimationFrame(() => pop.classList.add('show'));

    // Вибір оцінки: клік по зірці. Повторний клік по тій самій прибирає.
    const pick = async (score) => {
      const cur = (item.ratings || {})[currentUserId];
      const next = (cur === score) ? null : score;
      try {
        await store.setRatingIn(node, item.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
        if (next == null) notifyRatingRemoved(currentUserId, fTitle(item), item.id, kind);
        else notifyRatingSet(currentUserId, fTitle(item), next, cur != null ? cur : null, item.id, kind);
        closeRatePop();
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти оцінку', 'err');
      }
    };

    pop.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-pop-remove]');
      if (rm) {
        try {
          await store.setRatingIn(node, item.id, currentUserId, null);
          toast('Оцінку прибрано');
          closeRatePop();
        } catch (err) {
          console.error(err);
          toast('Не вдалося прибрати оцінку', 'err');
        }
      }
    });

    // Шкала: наведення — прев'ю, клік — миттєве збереження
    wireRatingTrail(pop, { selected: (item.ratings || {})[currentUserId], onPick: pick });

    // Клавіатура: цифри 1–9 та 0 (=10) ставлять оцінку одразу
    pop.addEventListener('keydown', (e) => {
      if (e.key >= '1' && e.key <= '9') { e.preventDefault(); pick(+e.key); return; }
      if (e.key === '0') { e.preventDefault(); pick(10); return; }
      const segs = [...pop.querySelectorAll('.rt-seg')];
      const idx = segs.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? Math.min(idx + 1, segs.length - 1) : Math.max(idx - 1, 0);
        segs[next].focus();
        paintRatingTrail(pop, +segs[next].dataset.score);
      }
    });

    document.addEventListener('mousedown', onPopOutside, true);
    document.addEventListener('keydown', onPopKey, true);
    window.addEventListener('scroll', onPopScroll, true);
    window.addEventListener('resize', onPopScroll);

    // Фокус всередину для роботи з клавіатури
    if (!isSheet) {
      const onSegs = [...pop.querySelectorAll('.rt-seg.on')];
      const active = onSegs[onSegs.length - 1] || pop.querySelectorAll('.rt-seg')[6] || pop.querySelector('.rt-seg');
      if (active) active.focus({ preventScroll: true });
    }
  }

  // ---------- Модальне вікно запису (фільму / гри) ----------

  function openDetail(itemId) {
    // Вікно цього ж запису вже відкрите — не дублюємо (подвійний клік,
    // швидкі кліки з рекордів статистики тощо)
    if (detailState && document.body.contains(detailState.overlay)) {
      if (detailState.filmId === itemId) return;
      detailState.close();
      detailState = null;
    }
    const film = filmsList.find(f => f.id === itemId);
    if (!film) return;
    const { overlay, box, close } = openModal(detailHTML(film), {
      width: 760,
      label: fTitle(film)
    });
    detailState = { overlay, box, filmId: itemId, close };
    wireDetail(box);
  }

  function fTitle(f) { return f.titleUk || f.title || 'Без назви'; }

  function detailHTML(f) {
    const a = U.avg(f.ratings);
    const my = (f.ratings || {})[currentUserId];
    const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
    // Якщо відома повна дата прем'єри («24 вересня 2007») — показуємо її
    // замість голого року; іграм повна дата не потрібна (лише рік)
    const prem = cfg.showPremiere ? U.fmtPremiere(f.premiere) : null;
    const metaBits = [prem ? `прем'єра ${prem}` : f.year, f.runtime ? `${f.runtime} хв` : ''].filter(Boolean).join(' · ');
    const genres = (f.genres || []).map(g =>
      `<button type="button" class="genre-chip clickable" data-person="${U.escapeHtml(g)}" title="${T.genreChipTitle}">${U.escapeHtml(g)}</button>`
    ).join('');
    const extraItems = (cfg.extraList(f) || []).map(c =>
      `<button type="button" class="cast-chip" data-person="${U.escapeHtml(c)}" title="${T.extraChipTitle}">${U.escapeHtml(c)}</button>`
    ).join('');
    const person = cfg.mainPerson(f);
    const personBtn = person
      ? `<button type="button" class="person-link" data-person="${U.escapeHtml(person)}" title="${T.personChipTitle}">${U.escapeHtml(person)}</button>`
      : '';

    const friendRows = USERS.map(u => {
      const v = (f.ratings || {})[u.id];
      return `<li class="f-row">
      ${avatarHTML(u, 'avatar sm')}
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
        <div class="detail-meta">${[person ? `${T.personPrefix}${personBtn}` : '', metaBits].filter(Boolean).join(' · ')}</div>
        ${a != null ? `<span class="avg-big" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="detail-scroll">
    <div class="detail-info">
      ${genres ? `<div class="genre-row">${genres}</div>` : ''}
      ${extraItems ? `<div class="cast-row"><span class="cast-label">${T.extraLabel}</span>${extraItems}</div>` : ''}
      ${f.plot ? `<p class="detail-plot">${U.escapeHtml(f.plot)}</p>` : ''}
      <div class="detail-links">
        ${f.imdbId ? `<a class="imdb-link" href="https://www.imdb.com/title/${U.escapeHtml(f.imdbId)}/" target="_blank" rel="noopener">${icons.link}<span>Переглянути на IMDb</span></a>` : ''}
        ${addedLine ? `<span class="added-line">${addedLine}</span>` : ''}
      </div>
    </div>
    <div class="detail-ratings">
      <div class="my-rating">
        <div class="my-rating-top"><span class="my-rating-label">Ваша оцінка</span></div>
        <div class="rt" role="group" aria-label="Ваша оцінка від 1 до 10">${ratingTrailHTML(my)}</div>
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
      if (seg) paintRatingTrail(box, +seg.dataset.score);
    });
    box.addEventListener('mouseout', (e) => {
      const seg = e.target.closest('.rt-seg');
      if (!seg) return;
      const to = e.relatedTarget;
      if (to && box.contains(to) && to.closest('.rt-seg')) return; // перехід на сусідній сегмент
      const item0 = (detailState && document.body.contains(detailState.overlay))
        ? filmsList.find(f => f.id === detailState.filmId) : null;
      paintRatingTrail(box, item0 ? (item0.ratings || {})[currentUserId] : null);
    });

    box.addEventListener('click', async (e) => {
      // Модалку могли вже закрити (снапшот Firebase прибрав запис),
      // а подія кліку ще долетіла за 180 мс анімації зникнення
      if (!detailState || !document.body.contains(detailState.overlay)) return;
      const film = filmsList.find(f => f.id === detailState.filmId);
      if (!film) return;

      // Клік на режисера/розробника / актора/платформу / жанр — фільтруємо список
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
        const cur = (film.ratings || {})[currentUserId];
        const next = (cur === score) ? null : score; // повторний клік прибирає оцінку
        paintRatingTrail(box, next);
        popRatingValue(box);
        try {
          await store.setRatingIn(node, film.id, currentUserId, next);
          toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
          if (next == null) notifyRatingRemoved(currentUserId, fTitle(film), film.id, kind);
          else notifyRatingSet(currentUserId, fTitle(film), next, cur != null ? cur : null, film.id, kind);
        } catch (err) {
          console.error(err);
          toast('Не вдалося зберегти оцінку', 'err');
          paintRatingTrail(box, cur); // повертаємо попередній стан шкали
        }
        return;
      }

      if (e.target.closest('[data-remove-rating]')) {
        try {
          await store.setRatingIn(node, film.id, currentUserId, null);
          toast('Оцінку прибрано');
          notifyRatingRemoved(currentUserId, fTitle(film), film.id, kind);
        } catch (err) {
          console.error(err);
          toast('Не вдалося прибрати оцінку', 'err');
        }
        return;
      }

      if (e.target.closest('[data-act="edit"]')) {
        detailState.close();
        cfg.openForm({ film, currentUserId, allFilms: filmsList });
        return;
      }

      if (e.target.closest('[data-act="delete"]')) {
        const ok = await confirmDialog({
          title: T.delTitle,
          text: `«${fTitle(film)}» та всі його оцінки буде видалено назавжди.`,
          confirmText: 'Видалити'
        });
        if (!ok) return;
        try {
          await store.deleteFrom(node, film.id);
        } catch (err) {
          console.error(err);
          toast(T.delFailToast, 'err');
          return;
        }
        // УВАГА: поки тривало видалення, снапшот Firebase міг уже
        // оновити список і закрити модалку через refreshDetail()
        // (detailState став null). Раніше тут був detailState.close(),
        // який падав з TypeError -> показувалась і помилка, і успіх.
        toast(T.deletedToast);
        notifyItemDeleted(currentUserId, fTitle(film), kind);
        if (detailState) { detailState.close(); detailState = null; }
      }
    });
  }

  // Оновлює відкрите вікно запису, коли дані змінилися
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

  // ---------- Публічний API колекції ----------
  // rerenderAll — перемалювання без зміни даних (під час завантаження
  // аватарок: фото з'являється у сітці, таблиці та відкритій модалці)
  return { mount, setList, setError, setUser, openAdd, setFilter, openItemById, rerenderAll: () => { refreshGrid(); refreshDetail(); } };
}
