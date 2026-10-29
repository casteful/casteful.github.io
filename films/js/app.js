// ============================================================
// Точка входу: тема, профіль користувача, вкладки, підписка на
// Firebase та зв'язування вкладок
// ============================================================

import { USERS } from './config.js?v=5.5';
import * as store from './store.js?v=5.5';
import * as filmsView from './films.js?v=5.5';
import * as gamesView from './games.js?v=5.5';
import * as statsView from './stats.js?v=5.5';
import * as quizView from './quiz.js?v=5.5';
import * as avatars from './avatars.js?v=5.5';
import { icons, toast } from './ui.js?v=5.5';
import { escapeHtml } from './utils.js?v=5.5';
import { fetchPoster } from './wiki.js?v=5.5';
import * as settings from './settings.js?v=5.5';

const view = document.getElementById('view');
const userOverlay = document.getElementById('userOverlay');
const userList = document.getElementById('userList');
const userBadge = document.getElementById('userBadge');
const themeToggle = document.getElementById('themeToggle');
const fab = document.getElementById('fabAdd');

let filmsArr = null;      // null = ще завантажується з бази
let gamesArr = null;
let activeTab = 'films';
let mountedTab = null;    // яку вкладку зараз змонтовано у #view
let currentUser = null;
let errNotified = false;
let gamesErrNotified = false;

// ---------- Глибоке посилання: index.html?film=<id> / ?game=<id> ----------
// Telegram-сповіщення ведуть прямо на фільм або гру: щойно список прийде
// з бази — відкриваємо картку, і друг може одразу ставити свою оцінку.
// Якщо профіль ще не обрано, спершу покажеться вибір профілю, а картка
// чекатиме під ним.
let deepLinkFilmId = null;
let deepLinkGameId = null;
try {
  deepLinkFilmId = new URLSearchParams(location.search).get('film');
  deepLinkGameId = new URLSearchParams(location.search).get('game');
} catch (e) {}

// ---------- Ініціалізація ----------
initBrand();
initTheme();
initSettings();
initFab();
initUser();
initTabs();

// Клік на людину/жанр у модалці фільму чи статистиці: переключає потрібну
// вкладку (Фільми або Серіали) і фільтрує список
document.addEventListener('films:filter', (e) => {
  const d = e.detail || {};
  const q = typeof d === 'string' ? d : (d.q || '');
  const target = (typeof d === 'object' && d.mode === 'series') ? 'series' : 'films';
  if (activeTab !== target) switchTab(target);
  filmsView.setFilter(q);
});

store.onFilms((list, err) => {
  if (err) {
    console.error('[store] Помилка Firebase:', err);
    if (!errNotified) {
      errNotified = true;
      const code = err && err.code ? ` (${err.code})` : '';
      toast(`Немає доступу до бази даних${code}. Перевірте правила безпеки Firebase.`, 'err');
    }
    filmsView.setError(err);
    filmsView.setFilms(null);
    return;
  }
  filmsArr = list;
  removeSlowLoadHint(); // список прийшов — прибрати підказку про зависле завантаження
  renderTab();
  healMissingPosters(list); // тихо підтягуємо постери для фільмів без них
  migrateKinds(list);       // розкладаємо старі записи на фільми/серіали
  handleDeepLink(list);
});

// ---------- Watchdog: зависле завантаження ----------
// Якщо за 12 секунд зі списком фільмів не сталося нічого (жодного знімка
// з бази) — найімовірніше, браузер закешував стару суміш файлів під час
// останнього оновлення сайту (новий index.html + старі js-модулі).
// Показуємо м'яку підказку з кнопкою примусового оновлення: перехід на
// URL із унікальним ?_=... гарантує свіжі index.html і всі ?v=модулі.
setTimeout(() => {
  if (filmsArr !== null) return;
  showSlowLoadHint();
}, 12000);

function showSlowLoadHint() {
  if (document.getElementById('slowLoadHint')) return;
  const el = document.createElement('div');
  el.id = 'slowLoadHint';
  el.className = 'slow-hint';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <span class="sh-icon" aria-hidden="true">${icons.info}</span>
    <span class="sh-text">Фільми довго не завантажуються — можливо, браузер тримає закешовану стару версію сайту.</span>
    <button type="button" class="btn sh-btn">Оновити</button>
    <button type="button" class="sh-x" aria-label="Приховати підказку">${icons.close}</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('.sh-btn').addEventListener('click', () => {
    try {
      location.replace(location.pathname + '?_=' + Date.now());
    } catch (e) { location.reload(); }
  });
  el.querySelector('.sh-x').addEventListener('click', () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  });
}

function removeSlowLoadHint() {
  const el = document.getElementById('slowLoadHint');
  if (el) {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }
}

store.onGames((list, err) => {
  if (err) {
    console.error('[store] Помилка Firebase (games):', err);
    if (!gamesErrNotified) {
      gamesErrNotified = true;
      toast('Немає доступу до ігор у базі даних. Перевірте правила безпеки Firebase.', 'err');
    }
    gamesView.setError(err);
    gamesView.setGames(null);
    return;
  }
  gamesArr = list;
  renderTab();
  handleGameDeepLink(list);
});

// Відкрити фільм/гру з ?film=<id> / ?game=<id> (одноразово, на першому
// знімку бази). Параметр із адреси прибираємо, щоб F5 не відкривав картку
// знову.
function handleDeepLink(list) {
  if (!deepLinkFilmId) return;
  const id = deepLinkFilmId;
  deepLinkFilmId = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (Array.isArray(list) && list.some(f => f.id === id)) {
    // серіал за посиланням — відкриваємо у вкладці «Серіали», фільм — у «Фільмах»
    const item = list.find(f => f.id === id);
    const target = (item && item.kind === 'series') ? 'series' : 'films';
    if (activeTab !== target) switchTab(target);
    filmsView.openFilmById(id);
  } else {
    toast('Фільм за посиланням не знайдено — можливо, його вже видалили', 'err');
  }
}

function handleGameDeepLink(list) {
  if (!deepLinkGameId) return;
  const id = deepLinkGameId;
  deepLinkGameId = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (Array.isArray(list) && list.some(g => g.id === id)) {
    if (activeTab !== 'games') switchTab('games');
    gamesView.openGameById(id);
  } else {
    toast('Гру за посиланням не знайдено — можливо, її вже видалили', 'err');
  }
}

// ---------- Автоматичне підтягування постерів ----------
// Фільми, додані раніше (коли en.вікі ховала fair-use постери через
// дефолтний pilicense=free), могли зберегтися без постера.
// Ланцюжок: IMDb за tt-ID -> Wikidata sitelinks (en перша) -> Вікіпедія.
// Кулдаун 3 доби на фільм, щоб не спамити API після невдачі.

const HEAL_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const healingNow = new Set();

function healMissingPosters(list) {
  const need = list.filter(f => !f.poster);
  need.forEach((f, i) => setTimeout(() => healPoster(f), Math.min(i, 5) * 1200));
}

async function healPoster(film) {
  if (healingNow.has(film.id)) return;
  try {
    const last = parseInt(localStorage.getItem('posterHeal_' + film.id), 10) || 0;
    if (Date.now() - last < HEAL_COOLDOWN_MS) return;
    localStorage.setItem('posterHeal_' + film.id, String(Date.now()));
  } catch (e) { /* localStorage недоступний — працюємо без кулдауну */ }
  healingNow.add(film.id);
  try {
    const poster = await fetchPoster({
      imdbId: film.imdbId || null,
      title: film.title || null,
      titleUk: film.titleUk || null,
      year: film.year || null
    });
    if (poster) {
      await store.updateFilm(film.id, { poster });
      toast(`Постер для «${film.titleUk || film.title || ''}» підтягнуто автоматично`);
    }
  } catch (e) {
    /* тихо: постер — не критично */
  } finally {
    healingNow.delete(film.id);
  }
}

// ---------- Автоматична класифікація: фільм чи серіал ----------
// Старі записи не мають поля kind. TVMaze (безкоштовне API з відкритим CORS)
// за IMDb-ID віддає серіал (200) або 404 (фільм). Записуємо в базу ЛИШЕ
// серіали (відсутність kind = фільм), тож обсяг записів мінімальний.
// Кулдаун у localStorage — щоб не турбувати API дарма після невдачі.

const kindHealing = new Set();

function migrateKinds(list) {
  const need = list.filter(f => !f.kind && f.imdbId);
  need.forEach((f, i) => setTimeout(() => migrateKind(f), Math.min(i, 4) * 900));
}

async function migrateKind(film) {
  if (kindHealing.has(film.id)) return;
  try {
    const done = localStorage.getItem('kindMig_' + film.id);
    if (done) return; // '1' — вже класифіковано (фільм — без запису в базу)
  } catch (e) { /* без localStorage — працюємо без кулдауну */ }
  kindHealing.add(film.id);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    let isSeries = false;
    try {
      const res = await fetch('https://api.tvmaze.com/lookup/shows?imdb=' + encodeURIComponent(film.imdbId), { signal: ctrl.signal });
      isSeries = res.ok; // 200 = серіал, 404 = фільм
    } finally { clearTimeout(t); }
    if (isSeries && filmsArr && Array.isArray(filmsArr)) {
      const cur = filmsArr.find(f => f.id === film.id);
      if (cur && !cur.kind) await store.updateFilm(film.id, { kind: 'series' });
    }
    try { localStorage.setItem('kindMig_' + film.id, '1'); } catch (e) {}
  } catch (e) {
    // мережа впала — спробуємо наступного разу (без прапорця)
  } finally {
    kindHealing.delete(film.id);
  }
}

// ---------- Налаштування (Telegram + експорт/імпорт бази) ----------
function initSettings() {
  settings.init(); // шестерня у шапці: відкриває вікно налаштувань
}

// ---------- Бренд / іконки ----------
function initBrand() {
  const b1 = document.getElementById('brandIcon');
  const b2 = document.getElementById('brandIcon2');
  if (b1) b1.innerHTML = icons.clapper;
  if (b2) b2.innerHTML = icons.clapper;
}

function initFab() {
  fab.innerHTML = icons.plus;
  fab.addEventListener('click', () => {
    if (activeTab === 'games') {
      gamesView.openAdd();
      return;
    }
    if (activeTab !== 'films') switchTab('films');
    filmsView.openAdd();
  });
}

// ---------- Тема ----------
function initTheme() {
  const apply = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeToggle.innerHTML = dark ? icons.sun : icons.moon;
  };
  apply();
  themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('films_theme', next); } catch (e) {}
    apply();
  });
}

// ---------- Профіль користувача ----------
function initUser() {
  try {
    const id = localStorage.getItem('films_user');
    currentUser = USERS.find(u => u.id === id) || null;
  } catch (e) { currentUser = null; }

  renderUserList();

  userList.addEventListener('click', (e) => {
    const btn = e.target.closest('.u-btn');
    if (!btn) return;
    currentUser = USERS.find(u => u.id === btn.dataset.uid) || null;
    try { localStorage.setItem('films_user', currentUser.id); } catch (e2) {}
    hideUserPicker();
    renderUserBadge();
    filmsView.setUser(currentUser.id);
    gamesView.setUser(currentUser.id);
    quizView.setUser(currentUser.id);
    toast(`Вітаємо, ${currentUser.name}!`);
  });

  // Клік по фону: mousedown (швидше) + click (надійніше на тач-пристроях)
  const overlayOutside = (e) => {
    if (e.target === userOverlay && currentUser) hideUserPicker();
  };
  userOverlay.addEventListener('mousedown', overlayOutside);
  userOverlay.addEventListener('click', overlayOutside);

  userBadge.addEventListener('click', showUserPicker);
  renderUserBadge();
  if (!currentUser) showUserPicker();
}

function renderUserList() {
  userList.innerHTML = USERS.map(u => `
    <button class="u-btn" data-uid="${u.id}" aria-label="Обрати профіль ${u.name}">
      ${avatars.avatarHTML(u, 'xl')}
      <span class="u-btn-name">${escapeHtml(u.name)}</span>
    </button>`).join('');
}

function renderUserBadge() {
  userBadge.innerHTML = currentUser
    ? `${avatars.avatarHTML(currentUser)}
       <span class="ub-name">${escapeHtml(currentUser.name)}</span>`
    : `<span class="avatar ghost">${icons.users}</span><span class="ub-name">Обрати профіль</span>`;
}

function showUserPicker() { userOverlay.hidden = false; requestAnimationFrame(() => userOverlay.classList.add('show')); }
function hideUserPicker() { userOverlay.classList.remove('show'); setTimeout(() => { userOverlay.hidden = true; }, 200); }

// ---------- Вкладки ----------
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  renderTab();
  // Аватарки живуть у базі: хтось завантажив/прибрав фото — перемалюємо
  // бейдж, вибір профілю й активну вкладку
  avatars.onChange(() => {
    renderUserList();
    renderUserBadge();
    renderTab();
    // Чипи «Оцінка друга» та відкриті вікна деталей малюються один раз при
    // монтуванні — аватарки могли підтягнутися пізніше, перемалюємо
    filmsView.repaintAvatars();
    gamesView.repaintAvatars();
  });
  avatars.initAvatars();
}

function switchTab(name) {
  if (activeTab === name) return;
  activeTab = name;
  renderTab();
}

function renderTab() {
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === activeTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  if (activeTab === 'films' || activeTab === 'series') {
    // Каркас монтуємо лише при переключенні вкладки — оновлення даних
    // із бази просто перемальовують сітку, не смикаючи інтерфейс.
    // «Серіали» — та сама view-модуль в іншому режимі (свій пошук/сортування)
    if (mountedTab !== activeTab) {
      filmsView.mount(view, activeTab);
      mountedTab = activeTab;
    }
    if (currentUser) filmsView.setUser(currentUser.id);
    filmsView.setFilms(filmsArr);
  } else if (activeTab === 'games') {
    if (mountedTab !== 'games') {
      gamesView.mount(view);
      mountedTab = 'games';
    }
    if (currentUser) gamesView.setUser(currentUser.id);
    gamesView.setGames(gamesArr);
  } else if (activeTab === 'quiz') {
    // Гра читає ті самі дані; mount() ідемпотентний — снапшот бази
    // лише перемальовує поточний стан, не ламаючи рахунок
    filmsView.setFilms(filmsArr); // тримаємо список живим і поза вкладкою
    quizView.mount(view);
    quizView.setUser(currentUser ? currentUser.id : null);
    quizView.setFilms(filmsArr);
    mountedTab = 'quiz';
  } else {
    // Список фільмів тримаємо актуальним навіть поза вкладкою —
    // щоб «Рекорди» у статистиці могли відкрити вікно фільму
    filmsView.setFilms(filmsArr);
    statsView.mount(view, filmsArr, {
      onFilter: (q) => { switchTab('films'); filmsView.setFilter(q); },
      onOpenFilm: (id) => filmsView.openFilmById(id)
    });
    mountedTab = 'stats';
  }
}
