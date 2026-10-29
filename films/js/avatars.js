// ============================================================
// Аватарки профілів: фото зберігається у вузлі avatars/{userId}
// як data:image/jpeg;base64 (квадрат 144×144, стискається тут,
// у браузері — зазвичай 3–8 КБ). Хто не завантажив фото — бачить
// класичну буквену аватарку з кольором профілю.
//
// Використання у будь-якому модулі:
//   import * as A from './avatars.js?v=5.7';
//   A.avatarHTML(u, 'sm')  -> <span class="avatar sm">…</span>
// Підписка на зміни: A.onChange(cb) — щоб перемалювати свій UI,
// коли хтось завантажив/прибрав фото.
// ============================================================

import * as store from './store.js?v=5.7';
import { escapeHtml, initial } from './utils.js?v=5.7';

let cache = {};              // { userId: dataUrl } — живі дані з бази
let started = false;
const listeners = new Set();

// Викликається один раз із app.js
export function initAvatars() {
  if (started) return;
  started = true;
  store.onAvatars((val) => {
    cache = val || {};
    listeners.forEach((cb) => { try { cb(cache); } catch (e) {} });
  });
}

export function get(uid) { return cache[uid] || null; }

export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Лише вміст аватарки: фото, якщо є, або ініціал. Зручно для
// кастомних чипів (наприклад, .u-head у шапці таблиці).
export function inner(u) {
  if (!u) return '?';
  const img = cache[u.id];
  return img
    ? `<img src="${escapeHtml(img)}" alt="" aria-hidden="true">`
    : escapeHtml(initial(u.name || ''));
}

// Універсальний рядок аватарки: фото поверх кольору профілю, або
// ініціали, якщо фото немає. cls — розмір ('', 'sm', 'lg', 'xl').
export function avatarHTML(u, cls = '') {
  if (!u) return `<span class="avatar ${cls} ghost">?</span>`;
  return `<span class="avatar ${cls}" style="background:${u.color}" title="${escapeHtml(u.name || '')}">${inner(u)}</span>`;
}

// ---------- Завантаження: файл -> квадрат 144×144 JPEG ----------
// Обрізає по центру (cover), стискає в JPEG — виходить кілька КБ,
// що безболісно тримає Firebase Realtime Database.

export const AVATAR_SIZE = 144;

export function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) {
      reject(new Error('Це не зображення'));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const S = AVATAR_SIZE;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const ctx = c.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) throw new Error('порожнє зображення');
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не вдалося прочитати зображення'));
    };
    img.src = url;
  });
}
