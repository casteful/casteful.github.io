// ============================================================
// Аватарки учасників.
//
// За замовчуванням аватарка — кольорове коло з першою літерою
// імені (кольори та імена — у js/config.js). Тепер кожен друг
// може мати СПРАВЖНЄ фото: його завантажено в ⚙ «Налаштування»,
// стиснуто до квадрата 160×160 і збережено в базі (вузол «users»)
// як data-URL на кілька КБ — тож фото миттєво бачать усі.
//
// avatarHTML(u, cls) — єдина точка рендеру: якщо фото є, малює
// <img>, інакше — звичайну літерну аватарку. Усі місця, де
// раніше були літери (шапка, пікер профілю, таблиця, статистика,
// рядки друзів у модалці), користуються цією функцією.
// ============================================================

import * as store from './store.js';
import { escapeHtml, initial } from './utils.js';

let metaMap = {};   // uid -> { avatar: 'data:image/jpeg;base64,…' } | undefined
let started = false;

// Підписка на зміни аватарок. Кожен свіжий снапшот сповіщає
// додаток подією «avatars:changed» — всі види перерісовуються.
export function initAvatars() {
  if (started) return;
  started = true;
  store.onUserMeta((m) => {
    metaMap = m || {};
    document.dispatchEvent(new CustomEvent('avatars:changed'));
  });
}

// data-URL фото друга або null (тоді рендериться літера)
export function getAvatarUrl(uid) {
  const m = metaMap[uid];
  return (m && m.avatar) ? m.avatar : null;
}

// Універсальний рендер аватарки. cls — класи розміру/контексту
// ('avatar sm', 'avatar xl', 'u-head'…). extra — додаткові класи
// (напр., 'mine' для підсвітки свого стовпця в таблиці).
export function avatarHTML(u, cls = 'avatar', extra = '') {
  if (!u) return '';
  const img = getAvatarUrl(u.id);
  if (img) {
    return `<img class="${cls} photo ${extra}" src="${escapeHtml(img)}" alt="" ` +
      `style="background:${u.color}" draggable="false">`;
  }
  return `<span class="${cls} ${extra}" style="background:${u.color}">${escapeHtml(initial(u.name))}</span>`;
}

// ---------- Завантаження фото: файл -> квадратний data-URL ----------
// Обрізаємо по центру «cover» до 160×160 і стискаємо JPEG (q≈0.85):
// типова аватарка виходить 4–8 КБ. createImageBitmap враховує EXIF
// (повернутий iPhone-знімок не ляже на бік); фолбек — <img>.

const AVATAR_SIZE = 160;
const AVATAR_JPEG_Q = 0.85;

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не вдалося прочитати зображення')); };
    im.src = url;
  });
}

export async function fileToAvatarDataUrl(file) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new Error('Це не зображення');
  }
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    src = await loadViaImg(file); // старіші браузери без createImageBitmap
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('Пусте зображення');

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  // cover-crop: найменший бік заповнює квадрат, центр — по середині
  const side = Math.min(w, h);
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const out = canvas.toDataURL('image/jpeg', AVATAR_JPEG_Q);
  // ~140 КБ — розумна стеля навіть для RTDB; далі вже «фото», не аватарка
  if (out.length > 140 * 1024) throw new Error('Фото завелике після стискання');
  return out;
}
