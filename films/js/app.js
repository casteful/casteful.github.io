// ============================================================
// Точка входу: тема, профіль користувача, вкладки, підписка на
// Firebase та зв'язування вкладок
// ============================================================

import { USERS } from './config.js?v=6.4.1';
import * as store from './store.js?v=6.4.1';
import * as filmsView from './films.js?v=6.4.1';
import * as gamesView from './games.js?v=6.4.1';
import * as libraryView from './library.js?v=6.4.1';
import { MEDIA_KINDS } from './media-kinds.js?v=6.4.1';
import * as statsView from './stats.js?v=6.4.1';
import * as quizView from './quiz.js?v=6.4.1';
import * as avatars from './avatars.js?v=6.4.1';
import { icons, toast } from './ui.js?v=6.4.1';
import { escapeHtml } from './utils.js?v=6.4.1';
import { fetchPoster } from './wiki.js?v=6.4.1';
import * as settings from './settings.js?v=6.4.1';
import { TABS, tabsNavHTML } from './tabs.js?v=6.4.1';
import * as catalog from './catalog.js?v=6.4.1';
import * as palette from './palette.js?v=6.4.1';

const view = document.getElementById('view');
const userOverlay = document.getElementById('userOverlay');
const userList = document.getElementById('userList');
const userBadge = document.getElementById('userBadge');
const themeToggle = document.getElementById('themeToggle');
const fab = document.getElementById('fabAdd');

let filmsArr = null;      // null = ще завантажується з бази
let gamesArr = null;
const mediaArr = { albums: null, singles: null, books: null, comics: null };
// Вкладки бібліотеки мають множинні назви (albums/…), колекції —
// од ones (album/…): єдина мапа, щоб не роз'їжджалося ніде
const TAB2KIND = { albums: 'album', singles: 'single', books: 'book', comics: 'comic' };
// Панель вкладок рендериться з реєстру (tabs.js) ДО відновлення
// останньої вкладки — щоб перевірка «така вкладка існує» була чесною
try { document.getElementById('tabsNav').innerHTML = tabsNavHTML(); } catch (e) {}
let activeTab = 'films';
// Повертаємось на останню відкриту вкладку (глибокі лінки все одно
// перекриють), щоб застосунок відкривався там, де користувач зупинився
try {
  const savedTab = localStorage.getItem('films_last_tab');
  if (savedTab && TABS[savedTab]) activeTab = savedTab;
} catch (e) {}
let mountedTab = null;    // яку вкладку зараз змонтовано у #view
let currentUser = null;
let errNotified = false;
let gamesErrNotified = false;
const mediaErrNotified = {};

// ---------- Глибоке посилання: ?film=<id> / ?game=<id> / ?album= ?single= ?book= ----------
// Telegram-сповіщення ведуть прямо на запис: щойно список прийде
// з бази — відкриваємо картку, і друг може одразу ставити свою оцінку.
// Якщо профіль ще не обрано, спершу покажеться вибір профілю, а картка
// чекатиме під ним.
let deepLinkFilmId = null;
let deepLinkGameId = null;
const deepLinkMedia = { album: null, single: null, book: null, comic: null };
try {
  const params = new URLSearchParams(location.search);
  deepLinkFilmId = params.get('film');
  deepLinkGameId = params.get('game');
  for (const k of Object.keys(deepLinkMedia)) deepLinkMedia[k] = params.get(k);
} catch (e) {}

// ---------- Ініціалізація ----------
initBrand();
initTheme();
initSettings();
initFab();
initUser();
initTabs();
initChrome();

// Дрібниці, що роблять щоденне користування приємнішим:
//  1) sticky-тулбар списків (пошук/сортування) їде під шапкою —
//     її висоту (на вузьких екранах вона дворядна) міряємо наживо;
//  2) «/» фокусує пошук активної вкладки з клавіатури.
function initChrome() {
  const tb = document.querySelector('.topbar');
  if (tb && window.ResizeObserver) {
    const setTbH = () => document.documentElement.style
      .setProperty('--tb-h', Math.round(tb.getBoundingClientRect().height) + 'px');
    try { new ResizeObserver(setTbH).observe(tb); } catch (e) {}
    setTbH();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const inp = document.querySelector('#view .search-wrap input');
    if (inp && document.activeElement !== inp) {
      e.preventDefault();
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e2) {}
    }
  });
  // Кнопка глобального пошуку в шапці (⌘K / Ctrl+K — для телефонів)
  const gsBtn = document.getElementById('globalSearchBtn');
  if (gsBtn) {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    gsBtn.innerHTML = `${icons.search}<kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd>`;
    gsBtn.addEventListener('click', () => palette.toggle());
  }
  palette.init({
    onOpenItem: (it) => {
      if (!it) return;
      if (it.tab === 'films' || it.tab === 'series') {
        if (activeTab !== it.tab) switchTab(it.tab);
        filmsView.openFilmById(it.id);
      } else if (it.tab === 'games') {
        if (activeTab !== 'games') switchTab('games');
        gamesView.openGameById(it.id);
      } else {
        // бібліотека: вкладка = вузол колекції (albums/singles/books/comics)
        if (activeTab !== it.tab) switchTab(it.tab);
        libraryView.openItemById(it.id);
      }
    },
    onGoTab: (tab) => { if (TABS[tab]) switchTab(tab); },
    onToggleTheme: toggleTheme,
    onOpenSettings: () => settings.openSettings()
  });
}

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
  catalog.setList('films', list); // глобальний пошук + клубна статистика
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
  catalog.setList('games', list);
  renderTab();
  handleGameDeepLink(list);
});

// ---------- Бібліотеки: альбоми / сингли / книги / комікси ----------
for (const k of Object.keys(MEDIA_KINDS)) {
  const node = MEDIA_KINDS[k].node;
  store.onMedia(node, (list, err) => {
    if (err) {
      console.error(`[store] Помилка Firebase (${node}):`, err);
      if (!mediaErrNotified[k]) {
        mediaErrNotified[k] = true;
        toast(`Немає доступу до колекції «${MEDIA_KINDS[k].addBtn.replace('Додати ', '')}». Перевірте правила безпеки Firebase.`, 'err');
      }
      libraryView.setError(err);
      libraryView.setItems(k, null);
      return;
    }
    mediaArr[node] = list;
    catalog.setList(node, list);
    renderTab();
    handleMediaDeepLink(k, list);
  });
}

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

// ?album= / ?single= / ?book= / ?comic= — відкрити запис бібліотеки.
// Вкладка = вузол колекції (albums/singles/books/comics збігаються з іменами вкладок)
function handleMediaDeepLink(kindKey, list) {
  if (!deepLinkMedia[kindKey]) return;
  const id = deepLinkMedia[kindKey];
  deepLinkMedia[kindKey] = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (Array.isArray(list) && list.some(m => m.id === id)) {
    const tab = MEDIA_KINDS[kindKey].node;
    if (activeTab !== tab) switchTab(tab);
    libraryView.openItemById(id);
  } else {
    toast('Запис за посиланням не знайдено — можливо, його вже видалили', 'err');
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
    if (TAB2KIND[activeTab]) {
      libraryView.openAdd(); // openAdd() знає поточний рід з mount()
      return;
    }
    if (activeTab !== 'films') switchTab('films');
    filmsView.openAdd();
  });
}

// ---------- Тема ----------
function applyThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeToggle.innerHTML = dark ? icons.sun : icons.moon;
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('films_theme', next); } catch (e) {}
  applyThemeIcon();
}
function initTheme() {
  applyThemeIcon();
  themeToggle.addEventListener('click', toggleTheme);
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
    libraryView.setUser(currentUser.id);
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
    libraryView.repaintAvatars();
  });
  avatars.initAvatars();
}

function switchTab(name) {
  if (activeTab === name) return;
  activeTab = name;
  try { localStorage.setItem('films_last_tab', name); } catch (e) {}
  renderTab();
  // FAB має відповідати вкладці («Додати фільм/гру/альбом…»)
  // — знахідний відмінок береться з реєстру вкладок (tabs.js)
  const noun = (TABS[activeTab] || {}).acc || 'фільм';
  fab.setAttribute('aria-label', 'Додати ' + noun);
  fab.title = 'Додати ' + noun;
  // На вузьких екранах панель вкладок гортається вбік — активна
  // вкладка має сама доїхати у видиму зону (глибокі лінки тощо)
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (btn && btn.scrollIntoView) {
    try { btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
}

function renderTab() {
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === activeTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  // Сімейство активної вкладки підсвічує свій дрібний підпис
  document.querySelectorAll('.tab-family').forEach(f => {
    f.classList.toggle('active', !!f.querySelector('.tab.active'));
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
  } else if (TAB2KIND[activeTab]) {
    // Чотири колекції бібліотеки — один універсальний view-модуль
    // (library.js); у кожної колекції свій пошук/сортування/вигляд
    const kindKey = TAB2KIND[activeTab];
    if (mountedTab !== activeTab) {
      libraryView.mount(view, kindKey);
      mountedTab = activeTab;
    }
    if (currentUser) libraryView.setUser(currentUser.id);
    libraryView.setItems(kindKey, mediaArr[MEDIA_KINDS[kindKey].node]);
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
    statsView.mount(view, {
      films: filmsArr, games: gamesArr,
      media: { albums: mediaArr.albums, singles: mediaArr.singles,
               books: mediaArr.books, comics: mediaArr.comics }
    }, {
      onFilter: (q) => { switchTab('films'); filmsView.setFilter(q); },
      onOpenFilm: (id) => filmsView.openFilmById(id),
      onGoTab: (tab) => { if (TABS[tab]) switchTab(tab); }
    });
    mountedTab = 'stats';
  }
}
