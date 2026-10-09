// ============================================================
// Firebase Realtime Database: ініціалізація та CRUD-операції
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getDatabase, ref, onValue, push, set, update, remove, get
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig, USERS as USERS_LIST } from './config.js';

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

// ---------- Повний експорт бази (для резервної копії в JSON) ----------
// Читаємо ті самі вузли, які використовує застосунок (films, tgConfig),
// тож експорт працює за будь-яких правил безпеки, за яких працює сам додаток.
export async function exportAll() {
  const [filmsSnap, tgSnap] = await Promise.all([
    get(ref(db, 'films')),
    get(ref(db, 'tgConfig'))
  ]);
  const films = filmsSnap.val() || {};
  const keys = Object.keys(films);
  let ratings = 0;
  for (const k of keys) {
    const r = films[k] && films[k].ratings;
    if (r && typeof r === 'object') {
      ratings += Object.values(r).filter(v => v != null).length;
    }
  }
  return {
    meta: {
      app: 'Фільмотека',
      projectId: firebaseConfig.projectId,
      databaseURL: firebaseConfig.databaseURL,
      exportedAt: new Date().toISOString(),
      films: keys.length,
      ratings,
      members: (USERS_LIST || []).map(u => u.id)
    },
    films,
    tgConfig: tgSnap.val() ?? null
  };
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
