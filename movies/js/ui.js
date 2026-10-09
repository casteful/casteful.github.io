// ============================================================
// UI-примітиви: іконки (SVG), тости, модальні вікна, підтвердження
// ============================================================

import { escapeHtml } from './utils.js';

// --- Мінімалістичні SVG-іконки (stroke = currentColor) ---
const I = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}${extra}</svg>`;

export const icons = {
  brand: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="8.5" width="19" height="12" rx="2.5"/><path d="M2.5 8.5l1.6-4.4L9 5.3"/><path d="M8.4 5l1.6-1 2.6 3.3"/><path d="M12 3.9l2.7.9 2 2.6"/><path d="M17 4.9l2.5.9 1.7 2.7"/></svg>`,
  film: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>`,
  plus: I(`<path d="M12 5v14M5 12h14"/>`),
  search: I(`<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`),
  sun: I(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`),
  moon: I(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  edit: I(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  trash: I(`<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>`),
  star: `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z"/></svg>`,
  close: I(`<path d="M6 6l12 12M18 6L6 18"/>`),
  chart: I(`<path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-9"/>`),
  link: I(`<path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>`),
  alert: I(`<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.5"/>`),
  check: I(`<path d="M20 6L9 17l-5-5"/>`),
  users: I(`<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 15.2c2.4.4 4.3 1.9 5 4.3"/>`),
  grid: I(`<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>`),
  table: I(`<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9.5h18"/><path d="M9.5 9.5V19.5"/>`),
  clapper: I(`<rect x="2.5" y="8.5" width="19" height="12" rx="2.5"/><path d="M2.5 8.5l1.6-4.4L9 5.3"/><path d="M8.4 5l1.6-1 2.6 3.3"/><path d="M12 3.9l2.7.9 2 2.6"/><path d="M17 4.9l2.5.9 1.7 2.7"/>`),
  trophy: I(`<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a1.5 1.5 0 0 0 0 3H7M17 6h2.5a1.5 1.5 0 0 1 0 3H17"/>`),
  flame: I(`<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`),
  clock: I(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`),
  spark: I(`<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>`),
  thumbDown: I(`<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z"/>`),
  info: I(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>`),
  send: I(`<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>`),
  gear: I(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
  download: I(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>`)
};

// --- Тости ---
export function toast(message, type = 'ok') {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'err' ? 'err' : ''}`;
  el.innerHTML = `${type === 'err' ? icons.alert : icons.check}<span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// --- Блокування скролу сторінки під модалками/шітами ---
// iOS: без нього сторінка за фіксованою модалкою скролиться крізь неї.
let lockCount = 0;
export function lockScroll() {
  lockCount++;
  document.body.classList.add('no-scroll');
}
export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (!lockCount) document.body.classList.remove('no-scroll');
}

// --- Модальні вікна ---
// Повертає { overlay, box, close }. Клік по фону закриває, Esc — теж (якщо не в полі вводу).
export function openModal(innerHTML, { width = 680, label = 'Діалогове вікно' } = {}) {
  const root = document.getElementById('modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}" style="max-width:${width}px">${innerHTML}</div>`;
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  lockScroll();

  const box = overlay.querySelector('.modal');
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    unlockScroll();
    setTimeout(() => overlay.remove(), 180);
  }
  function onKey(e) {
    if (e.key === 'Escape' && !e.target.closest('input, textarea, select')) close();
  }
  // Клік по фону: mousedown (швидше) + click (надійніше на тач-пристроях)
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  return { overlay, box, close };
}

// --- Діалог підтвердження (видалення тощо) ---
export function confirmDialog({ title, text, confirmText = 'Видалити', cancelText = 'Скасувати' }) {
  return new Promise((resolve) => {
    const { box, close } = openModal(`
      <div class="confirm">
        <h3>${escapeHtml(title)}</h3>
        ${text ? `<p>${escapeHtml(text)}</p>` : ''}
        <div class="confirm-actions">
          <button class="btn" data-close>${escapeHtml(cancelText)}</button>
          <button class="btn danger" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `, { width: 420, label: title });

    box.querySelector('[data-confirm]').addEventListener('click', () => { close(); resolve(true); });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) resolve(false);
    });
    // Закриття по фону/Esc = відмова
    const obs = new MutationObserver(() => {
      if (!document.body.contains(box)) { obs.disconnect(); resolve(false); }
    });
    obs.observe(document.getElementById('modalRoot'), { childList: true });
  });
}
