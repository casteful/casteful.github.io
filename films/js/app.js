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

const view = document.getElementById('view');
const userOverlay = document.getElementById('userOverlay');
const userList = document.getElementById('userList');
const userBadge = document.getElementById('userBadge');
const themeToggle = document.getElementById('themeToggle');
const fab = document.getElementById('fabAdd');

let filmsArr = null;      // null = ще завантажується з бази
let activeTab = 'films';
let currentUser = null;
let errNotified = false;

// ---------- Ініціалізація ----------
initBrand();
initTheme();
initFab();
initUser();
initTabs();

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
});

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
    filmsView.mount(view);
    if (currentUser) filmsView.setUser(currentUser.id);
    filmsView.setFilms(filmsArr);
  } else {
    statsView.mount(view, filmsArr);
  }
}
