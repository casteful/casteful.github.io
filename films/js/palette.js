// ============================================================
// Глобальний пошук клубу (⌘K / Ctrl+K) — командна палітра.
// Шукає по ВСІХ колекціях одразу (фільми, серіали, альбоми,
// сингли, книги, комікси, ігри — дані беруться з catalog.js),
// плюс «Перейти» до вкладок і пара дій (тема, налаштування).
// Клавіатура: ↑/↓ — вибір, Enter — відкрити, Esc — закрити.
// У шапці є кнопка з іконкою (app.js) — для телефонів, де немає
// системної клавіатури.
// ============================================================

import { icons, lockScroll, unlockScroll } from './ui.js?v=6.4.1';
import { escapeHtml, trunc } from './utils.js?v=6.4.1';
import { TABS, TAB_ORDER } from './tabs.js?v=6.4.1';
import * as catalog from './catalog.js?v=6.4.1';

let handlers = null;
let overlay = null;
let inputEl = null;
let listEl = null;
let rows = [];          // поточні рядки: { type: 'head'|'item'|'tab'|'action', ... }
let activeIdx = -1;     // індекс активного рядка серед ВИБІРАНИХ (item/tab/action)
let lastFocus = null;

const MAX_RESULTS = 18;

export function init(h) {
  handlers = h || {};
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
        (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  });
}

export function toggle() { overlay ? close() : open(); }

export function open() {
  if (overlay) return;
  lastFocus = document.activeElement;

  overlay = document.createElement('div');
  overlay.className = 'cmdk-overlay';
  overlay.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Глобальний пошук">
      <div class="cmdk-head">
        <span class="cmdk-search-ic" aria-hidden="true">${icons.search}</span>
        <input class="cmdk-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Пошук по всій бібліотеці: фільми, музика, книги, ігри…"
               aria-label="Глобальний пошук">
        <button type="button" class="cmdk-esc" title="Закрити (Esc)"><kbd>Esc</kbd></button>
      </div>
      <div class="cmdk-list" role="listbox" aria-label="Результати"></div>
      <div class="cmdk-foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> вибір</span>
        <span><kbd>Enter</kbd> відкрити</span>
        <span><kbd>Esc</kbd> закрити</span>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  lockScroll();

  inputEl = overlay.querySelector('.cmdk-input');
  listEl = overlay.querySelector('.cmdk-list');

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.cmdk-esc').addEventListener('click', close);
  inputEl.addEventListener('input', () => render(inputEl.value));
  inputEl.addEventListener('keydown', onKey);
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-row]');
    if (row) activateRow(parseInt(row.dataset.row, 10));
  });
  listEl.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[data-row]');
    if (row) setActive(parseInt(row.dataset.row, 10), false);
  });

  render('');
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    inputEl.focus();
  });
}

export function close() {
  if (!overlay) return;
  const el = overlay;
  overlay = null;
  inputEl = null;
  listEl = null;
  rows = [];
  el.classList.remove('show');
  unlockScroll();
  setTimeout(() => el.remove(), 160);
  if (lastFocus && document.body.contains(lastFocus)) {
    try { lastFocus.focus(); } catch (e) { /* елемент може бути недоступним */ }
  }
}

// ---------- Побудова списку ----------

function buildRows(q) {
  const out = [];
  const query = String(q || '').trim();
  const low = query.toLowerCase();

  if (!query) {
    // Порожній запит: усі вкладки + швидкі дії
    out.push({ type: 'head', label: 'Перейти' });
    TAB_ORDER.forEach(id => out.push({ type: 'tab', tab: id, pickable: true }));
    out.push({ type: 'head', label: 'Дії' });
    const dark = document.documentElement.dataset.theme === 'dark';
    out.push({ type: 'action', act: 'theme', pickable: true,
               label: dark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему',
               icon: dark ? 'sun' : 'moon' });
    out.push({ type: 'action', act: 'settings', pickable: true,
               label: 'Налаштування', icon: 'gear' });
    return out;
  }

  // Вкладки, чиї назви містять запит («стат», «книг»…)
  const tabHits = TAB_ORDER.filter(id => (TABS[id] ? TABS[id].label : '').toLowerCase().includes(low));
  if (tabHits.length) {
    out.push({ type: 'head', label: 'Перейти' });
    tabHits.forEach(id => out.push({ type: 'tab', tab: id, pickable: true }));
  }

  // Записи з усіх колекцій
  const items = catalog.search(low.split(/\s+/)).slice(0, MAX_RESULTS - out.filter(r => r.pickable).length);
  if (items.length) {
    const seenGroups = new Set();
    for (const it of items) {
      if (!seenGroups.has(it.group)) {
        out.push({ type: 'head', label: it.group });
        seenGroups.add(it.group);
      }
      out.push({ type: 'item', item: it, pickable: true });
    }
  }

  if (!out.length) out.push({ type: 'empty' });
  return out;
}

function rowHTML(r, idx) {
  if (r.type === 'head') {
    return `<div class="cmdk-group">${escapeHtml(r.label)}</div>`;
  }
  if (r.type === 'empty') {
    return `<div class="cmdk-empty">${icons.search}<span>Нічого не знайдено</span></div>`;
  }
  const active = idx === activeIdx ? ' active' : '';
  if (r.type === 'tab') {
    const t = TABS[r.tab] || { label: r.tab, icon: 'film' };
    return `
      <button type="button" class="cmdk-row${active}" data-row="${idx}" role="option">
        <span class="cmdk-ic" aria-hidden="true">${icons[t.icon] || icons.film}</span>
        <span class="cmdk-main">
          <span class="cmdk-title">${escapeHtml(t.label)}</span>
          <span class="cmdk-sub">Перейти на вкладку</span>
        </span>
      </button>`;
  }
  if (r.type === 'action') {
    return `
      <button type="button" class="cmdk-row${active}" data-row="${idx}" role="option">
        <span class="cmdk-ic" aria-hidden="true">${icons[r.icon] || icons.gear}</span>
        <span class="cmdk-main">
          <span class="cmdk-title">${escapeHtml(r.label)}</span>
        </span>
      </button>`;
  }
  // item
  const it = r.item;
  const titleWithOrig = it.orig
    ? `<span class="cmdk-orig">${escapeHtml(trunc(it.orig, 42))}</span>`
    : '';
  return `
    <button type="button" class="cmdk-row${active}" data-row="${idx}" role="option">
      <span class="cmdk-ic" aria-hidden="true">${icons[it.icon] || icons.film}</span>
      <span class="cmdk-main">
        <span class="cmdk-title">${escapeHtml(it.title)}${it.year ? ` <small class="cmdk-year">${it.year}</small>` : ''}</span>
        ${titleWithOrig}
        ${it.sub ? `<span class="cmdk-sub">${escapeHtml(trunc(it.sub, 46))}</span>` : ''}
      </span>
      <span class="cmdk-meta">
        ${it.avg != null ? `<span class="cmdk-avg" style="color:${avgColor(it.avg)}">${escapeHtml(fmtAvg(it.avg))}</span>` : ''}
        <span class="cmdk-kind">${escapeHtml(it.group)}</span>
      </span>
    </button>`;
}

function avgColor(v) {
  const h = Math.max(0, Math.min(1, (v - 1) / 9)) * 120;
  return `hsl(${Math.round(h)} 60% 45%)`;
}
function fmtAvg(v) {
  return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

function render(q) {
  if (!listEl) return;
  rows = buildRows(q);
  // активним робимо перший вибірний рядок
  activeIdx = rows.findIndex(r => r.pickable);
  listEl.innerHTML = rows.map((r, i) => rowHTML(r, i)).join('');
  scrollActiveIntoView();
}

function onKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIdx >= 0) activateRow(activeIdx);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

function moveActive(dir) {
  if (!rows.length) return;
  const pickable = rows.map((r, i) => (r.pickable ? i : -1)).filter(i => i >= 0);
  if (!pickable.length) return;
  let pos = pickable.indexOf(activeIdx);
  pos = pos === -1 ? 0 : (pos + dir + pickable.length) % pickable.length;
  setActive(pickable[pos]);
}

function setActive(idx, scroll = true) {
  activeIdx = idx;
  listEl.querySelectorAll('[data-row]').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.row, 10) === idx);
  });
  if (scroll) scrollActiveIntoView();
}

function scrollActiveIntoView() {
  const el = listEl && listEl.querySelector(`[data-row="${activeIdx}"]`);
  if (el && el.scrollIntoView) {
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
}

function activateRow(idx) {
  const r = rows[idx];
  if (!r || !r.pickable) return;
  close();
  if (r.type === 'item') {
    if (handlers.onOpenItem) handlers.onOpenItem(r.item);
  } else if (r.type === 'tab') {
    if (handlers.onGoTab) handlers.onGoTab(r.tab);
  } else if (r.type === 'action') {
    if (r.act === 'theme' && handlers.onToggleTheme) handlers.onToggleTheme();
    if (r.act === 'settings' && handlers.onOpenSettings) handlers.onOpenSettings();
  }
}
