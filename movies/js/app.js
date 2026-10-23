// ============================================================
// Точка входу: тема, профіль користувача, вкладки, підписка на
// Firebase та зв'язування вкладок (Фільми / Ігри / Статистика)
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import { filmsView } from './films.js';
import { gamesView } from './games.js';
import * as statsView from './stats.js';
import { icons, toast } from './ui.js';
import { escapeHtml } from './utils.js';
import { fetchPoster } from './wiki.js';
import * as telegram from './telegram.js';
import { openSettings } from './settings.js';
import { initAvatars, avatarHTML } from './avatars.js';

const view = document.getElementById('view');
const userOverlay = document.getElementById('userOverlay');
const userList = document.getElementById('userList');
const userBadge = document.getElementById('userBadge');
const themeToggle = document.getElementById('themeToggle');
const fab = document.getElementById('fabAdd');

let filmsArr = null;      // null = ще завантажується з бази
let gamesArr = null;      // те саме для вкладки «Ігри»
let gamesErrNotified = false;
let activeTab = 'films';
let mountedTab = null;    // яку вкладку зараз змонтовано у #view
let currentUser = null;
let errNotified = false;

// ---------- Deep-link з Telegram-сповіщень (?film=<id> / ?game=<id>) ----------
// Клік за посиланням у пуші відкриває Фільмотеку одразу з вікном
// фільму або гри. Параметр одразу прибираємо з адреси, щоб F5 не
// відкривав вікно знову. Вікно чекає на дві речі: завантаження бази
// і обраний профіль (якщо профілю ще немає — відкриємо одразу після
// вибору в пікері).
let pendingLink = null; // { kind: 'film' | 'game', id }
try {
  const u = new URL(location.href);
  const fid = u.searchParams.get('film');
  const gid = u.searchParams.get('game');
  if (fid) pendingLink = { kind: 'film', id: fid };
  else if (gid) pendingLink = { kind: 'game', id: gid };
  if (pendingLink) {
    u.searchParams.delete('film');
    u.searchParams.delete('game');
    history.replaceState(null, '', u.toString());
  }
} catch (e) { /* без location/history — просто без deep-link */ }

function tryOpenPending() {
  if (!pendingLink || !currentUser) return;
  const ready = pendingLink.kind === 'film' ? filmsArr : gamesArr;
  if (ready == null) return; // колекція ще завантажується
  const p = pendingLink;
  pendingLink = null;
  if (p.kind === 'game') {
    if (activeTab !== 'games') switchTab('games');
    gamesView.openItemById(p.id); // якщо гру видалили — тихо нічого не станеться
  } else {
    if (activeTab !== 'films') switchTab('films');
    filmsView.openItemById(p.id);
  }
}

// ---------- Ініціалізація ----------
initBrand();
initTheme();
initFab();
initUser();
initTabs();
initSettings();
initAvatars(); // підписка на фото аватарок (вузол «users»)

// Хтось завантажив/прибрав аватарку — перемальовуємо все, де вона видно:
// шапку, пікер профілю, сітки обох колекцій і статистику
let statsHandlers = null; // опції останнього монтування статистики
document.addEventListener('avatars:changed', () => {
  renderUserBadge();
  buildUserList();
  filmsView.rerenderAll();
  gamesView.rerenderAll();
  if (mountedTab === 'stats' && statsHandlers) statsView.mount(view, filmsArr, statsHandlers);
});

// Клік на людину/жанр/платформу у модалці або статистиці:
// переключає потрібну вкладку і фільтрує список
document.addEventListener('films:filter', (e) => {
  if (activeTab !== 'films') switchTab('films');
  filmsView.setFilter(e.detail);
});
document.addEventListener('games:filter', (e) => {
  if (activeTab !== 'games') switchTab('games');
  gamesView.setFilter(e.detail);
});

store.onFilms((list, err) => {
  if (err) {
    console.error('[store] Помилка Firebase (films):', err);
    if (!errNotified) {
      errNotified = true;
      const code = err && err.code ? ` (${err.code})` : '';
      toast(`Немає доступу до бази даних${code}. Перевірте правила безпеки Firebase.`, 'err');
    }
    filmsView.setError(err);
    filmsView.setList(null);
    return;
  }
  filmsArr = list;
  renderTab();
  tryOpenPending(); // deep-link ?film=… з Telegram — коли база вже тут
  healMissingPosters(list); // тихо підтягуємо постери для фільмів без них
});

store.onList('games', (list, err) => {
  if (err) {
    console.error('[store] Помилка Firebase (games):', err);
    if (!gamesErrNotified) {
      gamesErrNotified = true;
      toast('Немає доступу до розділу «Ігри» в базі даних. Перевірте правила безпеки Firebase.', 'err');
    }
    gamesView.setError(err);
    gamesView.setList(null);
    return;
  }
  gamesArr = list;
  renderTab();
  tryOpenPending(); // deep-link ?game=… — коли база вже тут
});

// ---------- Автоматичне підтягування постерів ----------
// Фільми, додані раніше (коли en.вікі ховала fair-use постери через
// дефолтний pilicense=free), могли зберегтися без постера.
// Ланцюжок: IMDb за tt-ID -> Wikidata sitelinks (en перша) -> Вікіпедія.
// Кулдаун 3 доби на фільм, щоб не спамити API після невдачі.
// (Ігри не зцілюємо: обкладинки вписуються вручну.)

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

// ---------- Налаштування (⚙ = Telegram-сповіщення + база даних) ----------
function initSettings() {
  const btn = document.getElementById('settingsBtn');
  if (!btn) return;
  btn.innerHTML = icons.gear;
  btn.addEventListener('click', openSettings);
  telegram.init(); // спільний конфіг Telegram у базі (крапка на ⚙, коли підключено)
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
    if (activeTab === 'games') { gamesView.openAdd(); return; }
    if (activeTab !== 'films') switchTab('films');
    filmsView.openAdd();
  });
  updateFab();
}

function updateFab() {
  const t = activeTab === 'games' ? 'Додати гру' : 'Додати фільм';
  fab.setAttribute('aria-label', t);
  fab.setAttribute('title', t);
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

  buildUserList();

  userList.addEventListener('click', (e) => {
    const btn = e.target.closest('.u-btn');
    if (!btn) return;
    currentUser = USERS.find(u => u.id === btn.dataset.uid) || null;
    try { localStorage.setItem('films_user', currentUser.id); } catch (e2) {}
    hideUserPicker();
    renderUserBadge();
    filmsView.setUser(currentUser.id);
    gamesView.setUser(currentUser.id);
    tryOpenPending(); // користувач обрав профіль за deep-link — відкриваємо вікно
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

function buildUserList() {
  userList.innerHTML = USERS.map(u => `
    <button class="u-btn" data-uid="${u.id}" aria-label="Обрати профіль ${u.name}">
      ${avatarHTML(u, 'avatar xl')}
      <span class="u-btn-name">${escapeHtml(u.name)}</span>
    </button>`).join('');
}

function renderUserBadge() {
  userBadge.innerHTML = currentUser
    ? `${avatarHTML(currentUser, 'avatar')}
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
  updateFab();

  if (activeTab === 'films') {
    // Каркас монтуємо лише при переключенні вкладки — оновлення даних
    // із бази просто перемальовують сітку, не смикаючи інтерфейс
    if (mountedTab !== 'films') {
      filmsView.mount(view);
      mountedTab = 'films';
    }
    if (currentUser) filmsView.setUser(currentUser.id);
    filmsView.setList(filmsArr);
  } else if (activeTab === 'games') {
    if (mountedTab !== 'games') {
      gamesView.mount(view);
      mountedTab = 'games';
    }
    if (currentUser) gamesView.setUser(currentUser.id);
    gamesView.setList(gamesArr);
  } else {
    // Списки тримаємо актуальними навіть поза вкладками — щоб
    // «Рекорди» у статистиці могли відкрити вікно фільму
    filmsView.setList(filmsArr);
    gamesView.setList(gamesArr);
    statsHandlers = {
      onFilter: (q) => { switchTab('films'); filmsView.setFilter(q); },
      onOpenFilm: (id) => filmsView.openItemById(id)
    };
    statsView.mount(view, filmsArr, statsHandlers);
    mountedTab = 'stats';
  }
}
