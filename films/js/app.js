// ============================================================
// Точка входу: тема, профіль користувача, вкладки, підписка на
// Firebase та зв'язування вкладок
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as filmsView from './films.js';
import * as statsView from './stats.js';
import { icons, toast } from './ui.js';
import { escapeHtml, initial } from './utils.js';
import { fetchPoster } from './wiki.js';

const view = document.getElementById('view');
const userOverlay = document.getElementById('userOverlay');
const userList = document.getElementById('userList');
const userBadge = document.getElementById('userBadge');
const themeToggle = document.getElementById('themeToggle');
const fab = document.getElementById('fabAdd');

let filmsArr = null;      // null = ще завантажується з бази
let activeTab = 'films';
let mountedTab = null;    // яку вкладку зараз змонтовано у #view
let currentUser = null;
let errNotified = false;

// ---------- Ініціалізація ----------
initBrand();
initTheme();
initFab();
initUser();
initTabs();

// Клік на людину/жанр у модалці фільму або статистиці:
// переключає вкладку «Фільми» (якщо потрібно) і фільтрує список
document.addEventListener('films:filter', (e) => {
  if (activeTab !== 'films') switchTab('films');
  filmsView.setFilter(e.detail);
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
  renderTab();
  healMissingPosters(list); // тихо підтягуємо постери для фільмів без них
});

// ---------- Автоматичне підтягування постерів ----------
// Фільми, додані через англомірну Вікіпедію, могли зберегтися без
// постера (en.wiki не віддає fair-use зображення через API).
// Ланцюжок: IMDb за tt-ID -> Wikidata sitelinks -> Вікіпедія.
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

  userList.innerHTML = USERS.map(u => `
    <button class="u-btn" data-uid="${u.id}" aria-label="Обрати профіль ${u.name}">
      <span class="avatar xl" style="background:${u.color}">${escapeHtml(initial(u.name))}</span>
      <span class="u-btn-name">${escapeHtml(u.name)}</span>
    </button>`).join('');

  userList.addEventListener('click', (e) => {
    const btn = e.target.closest('.u-btn');
    if (!btn) return;
    currentUser = USERS.find(u => u.id === btn.dataset.uid) || null;
    try { localStorage.setItem('films_user', currentUser.id); } catch (e2) {}
    hideUserPicker();
    renderUserBadge();
    filmsView.setUser(currentUser.id);
    toast(`Вітаємо, ${currentUser.name}!`);
  });

  userOverlay.addEventListener('mousedown', (e) => {
    // Перший вибір обов'язковий: закрити кліком по фону можна, лише якщо профіль уже обрано
    if (e.target === userOverlay && currentUser) hideUserPicker();
  });

  userBadge.addEventListener('click', showUserPicker);
  renderUserBadge();
  if (!currentUser) showUserPicker();
}

function renderUserBadge() {
  userBadge.innerHTML = currentUser
    ? `<span class="avatar" style="background:${currentUser.color}">${escapeHtml(initial(currentUser.name))}</span>
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

  if (activeTab === 'films') {
    // Каркас монтуємо лише при переключенні вкладки — оновлення даних
    // із бази просто перемальовують сітку, не смикаючи інтерфейс
    if (mountedTab !== 'films') {
      filmsView.mount(view);
      mountedTab = 'films';
    }
    if (currentUser) filmsView.setUser(currentUser.id);
    filmsView.setFilms(filmsArr);
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
