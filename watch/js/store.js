// ============================================================
// Firebase Realtime Database: ініціалізація та CRUD-операції
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getDatabase, ref, onValue, push, set, update, remove, get
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Перетворює об'єкт з бази ({ id1: {...}, id2: {...} }) на масив
function toList(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([id, f]) => ({ id, ...f }));
}

// Підписка на список фільмів. cb(films[], error|null)
export function onFilms(cb) {
  return onValue(
    ref(db, 'films'),
    (snap) => cb(toList(snap.val())),
    (err) => cb(null, err)
  );
}

// Додати новий фільм. Повертає ключ нового запису.
export async function addFilm(data) {
  const r = push(ref(db, 'films'));
  const now = Date.now();
  await set(r, {
    ratings: {},
    ...data,
    createdAt: now,
    updatedAt: now
  });
  return r.key;
}

// Оновити поля фільму
export async function updateFilm(filmId, patch) {
  await update(ref(db, `films/${filmId}`), { ...patch, updatedAt: Date.now() });
}

// Видалити фільм разом з оцінками
export async function deleteFilm(filmId) {
  await remove(ref(db, `films/${filmId}`));
}

// Поставити/змінити оцінку. score = null прибирає оцінку.
export async function setRating(filmId, user, score) {
  await set(ref(db, `films/${filmId}/ratings/${user}`), score ?? null);
}

// ---------- Резервна копія: експорт/імпорт усієї бази у JSON ----------

// Повний знімок кореня бази (films, tgConfig та будь-які майбутні вузли).
// Повертає {} для порожньої бази.
export async function exportAll() {
  const snap = await get(ref(db, '/'));
  const val = snap.val();
  return (val && typeof val === 'object') ? val : {};
}

// Повне відновлення: ПЕРЕЗАПИСУЄ корінь бази даними з резервної копії.
// Викликається лише після явного підтвердження користувача.
export async function importAll(data) {
  await set(ref(db, '/'), data);
}

// ---------- Аватарки профілів (вузол avatars/{userId}) ----------
// Фото зберігається як стиснутий data-URL (квадрат ~192px, webp/jpeg,
// кілька КБ) — Realtime Database чудово це тримає, окремий Storage
// не потрібен. Автоматично синхронізується між усіма пристроями.

// Підписка на аватарки: cb({ userId: dataUrl, ... })
export function onAvatars(cb) {
  return onValue(
    ref(db, 'avatars'),
    (snap) => cb(snap.val() || {}),
    (err) => { console.warn('[store] avatars:', err && err.code); cb({}); }
  );
}

export async function setAvatar(userId, dataUrl) {
  await set(ref(db, `avatars/${userId}`), dataUrl);
}

export async function removeAvatar(userId) {
  await remove(ref(db, `avatars/${userId}`));
}

// ---------- Налаштування Telegram-сповіщень (спільні для всіх) ----------
export function onTgConfig(cb) {
  return onValue(
    ref(db, 'tgConfig'),
    (snap) => cb(snap.val() || null),
    (err) => { console.warn('[store] tgConfig:', err && err.code); cb(null); }
  );
}
export async function setTgConfig(cfg) {
  await set(ref(db, 'tgConfig'), cfg);
}
