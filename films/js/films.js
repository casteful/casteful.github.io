// ============================================================
// Вкладка «Фільми»: сітка карток АБО таблиця, пошук/сортування,
// модальне вікно фільму з оцінками 1–10
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons, lockScroll, unlockScroll } from './ui.js';
import { openFormModal } from './film-form.js';

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

// Зовнішній фільтр (клік на режисера/актора/жанр у статистиці чи картці).
// Спочатку клікнуто поза вкладкою «Фільми» — просимо app.js її переключити.
export function setFilter(q) {
  query = String(q || '');
  if (!document.getElementById('filmSearch') || !container.contains(document.getElementById('filmSearch'))) {
    document.dispatchEvent(new CustomEvent('films:filter', { detail: String(q || '') }));
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
      <div class="view-toggle" role="group" aria-label="Вигляд списку">
        <button type="button" data-view-btn="grid" class="${view === 'grid' ? 'active' : ''}" title="Сітка" aria-label="Вигляд: сітка">${icons.grid}</button>
        <button type="button" data-view-btn="table" class="${view === 'table' ? 'active' : ''}" title="Таблиця" aria-label="Вигляд: таблиця">${icons.table}</button>
      </div>
      <button class="btn primary add-btn" id="addBtn">${icons.plus}<span>Додати фільм</span></button>
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

  // Кліки: заголовки-сортування в таблиці, кнопка «редагувати»,
  // швидка оцінка (кнопка на картці / своя комірка в таблиці),
  // відкриття картки/рядка
  gridEl.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      sort = th.dataset.sort;
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

// ---------- Фільтрація і сортування ----------

function filtered() {
  const q = query.trim().toLowerCase();
  let list = filmsList;
  if (q) {
    list = list.filter(f => [
      f.title, f.titleUk, f.director,
      ...(f.genres || []),
      ...(f.cast || [])
    ].some(x => String(x || '').toLowerCase().includes(q)));
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
    renderSkeleton();
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

  const userHeads = USERS.map(u => `
    <th class="u-col" scope="col" aria-label="Оцінки ${U.escapeHtml(u.name)}">
      <span class="u-head ${u.id === currentUserId ? 'mine' : ''}" style="background:${u.color}" title="${U.escapeHtml(u.name)}">${U.escapeHtml(U.initial(u.name))}</span>
    </th>`).join('');

  return `
  <table class="films-table">
    <thead><tr>
      ${thSort('title', 'Фільм')}
      ${thSort('year', 'Рік')}
      <th scope="col">Режисер</th>
      <th scope="col">Жанри</th>
      <th scope="col" class="t-num">Хв</th>
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
    <td class="t-muted" title="${U.escapeHtml(f.director || '')}">${f.director ? U.escapeHtml(U.trunc(f.director, 28)) : '—'}</td>
    <td class="t-muted t-genres" title="${U.escapeHtml((f.genres || []).join(', '))}">${f.genres && f.genres.length ? U.escapeHtml(U.trunc(f.genres.join(', '), 32)) : '—'}</td>
    <td class="t-num t-muted">${f.runtime || '—'}</td>
    <td>${a != null
      ? `<span class="avg-badge sm" style="background:${U.ratingColor(a)}" title="Середня оцінка">${U.fmtAvg(a)}</span>`
      : `<span class="t-muted">—</span>`}</td>
    ${userCells}
    <td>
      <button class="icon-btn t-edit" data-edit aria-label="Редагувати фільм" title="Редагувати">${icons.edit}</button>
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
    f.year,
    f.runtime ? `${f.runtime} хв` : '',
    ratedCount ? `${ratedCount} ${U.pluralRatings(ratedCount)}` : 'без оцінок'
  ].filter(Boolean).join(' · ');

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
      <div class="card-meta">${U.escapeHtml(metaBits)}</div>
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
// Робимо оцінювання максимально простим:
//  • десктоп — спливне вікно біля кнопки з підсвіткою шкали при наведенні
//    та живим підписом («Добре», «Шедевр»…);
//  • мобільний (≤640px) — шіт, що виїжджає знизу: великий шрифт,
//    великі кнопки, зручно великою пальцем;
//  • клавіатура: цифри 1–9, 0 (десять), стрілки ←/→, Enter, Esc.

let ratePop = null; // { el, backdrop, sheet }

const RATE_LABELS = {
  1: 'Жах', 2: 'Дуже погано', 3: 'Погано', 4: 'Слабко', 5: 'Так собі',
  6: 'Нормально', 7: 'Добре', 8: 'Дуже добре', 9: 'Чудово', 10: 'Шедевр'
};

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

function buildRatePop(film) {
  const my = (film.ratings || {})[currentUserId];
  const a = U.avg(film.ratings);
  const votes = Object.keys(film.ratings || {}).length;
  const pop = document.createElement('div');
  pop.className = 'rate-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Оцінити «${fTitle(film)}»`);
  pop.innerHTML = `
    <div class="pop-grab" aria-hidden="true"></div>
    <div class="rate-pop-title" title="${U.escapeHtml(fTitle(film))}">${U.escapeHtml(fTitle(film))}</div>
    <div class="rate-pop-sub">${
      a != null
        ? `Середня <b>${U.fmtAvg(a)}</b> · ${votes} ${U.pluralRatings(votes)}${my != null ? ` · ваша ${my}` : ''}`
        : (my != null ? `Ваша оцінка ${my}` : 'Перший відгук — ваш!')
    }</div>
    <div class="rt" role="group" aria-label="Оцінка від 1 до 10">${rateTrailHTML(my)}</div>
    ${my != null ? '<button type="button" class="remove-rating" data-pop-remove>Прибрати мою оцінку</button>' : ''}`;
  return pop;
}

// ---------- Компонент «шкала оцінки» (trail) ----------
// Єдина шкала 1–10 для спливашок, шітів і модалки: сегменти
// заливаються кольором до обраного значення (від червоного до
// зеленого), над шкалою — велике число і слово-підпис.
// Наведення показує прев'ю, клік зберігає миттєво.

function rateTrailHTML(selected) {
  const segs = Array.from({ length: 10 }, (_, i) => {
    const s = i + 1;
    const on = selected != null && s <= selected;
    return `<button type="button" class="rt-seg ${on ? 'on' : ''}" data-score="${s}" style="--c:${U.ratingColor(s)}" aria-label="${s} — ${RATE_LABELS[s]}"></button>`;
  }).join('');
  const nums = Array.from({ length: 10 }, (_, i) => `<i>${i + 1}</i>`).join('');
  return `
    <div class="rt-display">
      <span class="rt-value"${selected != null ? ` style="color:${U.ratingColor(selected)}"` : ''}>${selected != null ? selected : '—'}</span>
      <span class="rt-word">${selected != null ? RATE_LABELS[selected] : 'Оберіть оцінку'}</span>
    </div>
    <div class="rt-track">${segs}</div>
    <div class="rt-nums" aria-hidden="true">${nums}</div>`;
}

// Перемалювати шкалу в контейнері root на значення s (null — «порожньо»)
function paintTrail(root, s) {
  const track = root.querySelector('.rt-track');
  if (track) {
    track.querySelectorAll('.rt-seg').forEach(c =>
      c.classList.toggle('on', s != null && +c.dataset.score <= s));
  }
  const v = root.querySelector('.rt-value');
  const w = root.querySelector('.rt-word');
  if (!v || !w) return;
  if (s != null) {
    v.textContent = s;
    v.style.color = U.ratingColor(s);
    w.textContent = RATE_LABELS[s];
  } else {
    v.textContent = '—';
    v.style.color = '';
    w.textContent = 'Оберіть оцінку';
  }
}

// Пружний «піп» великого числа при виборі оцінки
function popValue(root) {
  const v = root.querySelector('.rt-value');
  if (v && v.animate) {
    v.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );
  }
}

// Наведення/клік для шкали у спливашці (модалка делегує події на box,
// бо refreshDetail() перестикує її вміст на кожному снапшоті)
function wireTrail(root, { selected, onPick }) {
  const track = root.querySelector('.rt-track');
  if (!track) return;
  track.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (seg) paintTrail(root, +seg.dataset.score);
  });
  track.addEventListener('mouseleave', () => paintTrail(root, selected));
  track.addEventListener('click', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (!seg) return;
    const s = +seg.dataset.score;
    paintTrail(root, s);
    popValue(root);
    onPick(s);
  });
}

function openRatePop(anchor, film) {
  if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }
  closeRatePop();

  const pop = buildRatePop(film);
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

  // Вибір оцінки: клік по числу. Повторний клік по тому ж числу прибирає.
  const pick = async (score) => {
    const cur = (film.ratings || {})[currentUserId];
    const next = (cur === score) ? null : score;
    try {
      await store.setRating(film.id, currentUserId, next);
      toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
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
        await store.setRating(film.id, currentUserId, null);
        toast('Оцінку прибрано');
        closeRatePop();
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати оцінку', 'err');
      }
    }
  });

  // Шкала: наведення — прев'ю, клік — миттєве збереження
  wireTrail(pop, { selected: (film.ratings || {})[currentUserId], onPick: pick });

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
      paintTrail(pop, +segs[next].dataset.score);
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

function detailHTML(f) {
  const a = U.avg(f.ratings);
  const my = (f.ratings || {})[currentUserId];
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  const metaBits = [f.year, f.runtime ? `${f.runtime} хв` : ''].filter(Boolean).join(' · ');
  const genres = (f.genres || []).map(g =>
    `<button type="button" class="genre-chip clickable" data-person="${U.escapeHtml(g)}" title="Фільми цього жанру">${U.escapeHtml(g)}</button>`
  ).join('');
  const cast = (f.cast || []).map(c =>
    `<button type="button" class="cast-chip" data-person="${U.escapeHtml(c)}" title="Фільми з цим актором">${U.escapeHtml(c)}</button>`
  ).join('');
  const directorBtn = f.director
    ? `<button type="button" class="person-link" data-person="${U.escapeHtml(f.director)}" title="Фільми цього режисера">${U.escapeHtml(f.director)}</button>`
    : '';

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
        <div class="detail-meta">${[f.director ? `реж. ${directorBtn}` : '', metaBits].filter(Boolean).join(' · ')}</div>
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

    // Клік на режисера / актора / жанр — фільтруємо список фільмів
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
      paintTrail(box, next);
      popValue(box);
      try {
        await store.setRating(film.id, currentUserId, next);
        toast(next == null ? 'Оцінку прибрано' : `Ваша оцінка: ${next}${next >= 9 ? ' ✨' : ''}`);
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
