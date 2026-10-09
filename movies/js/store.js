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

// Підрахунок реальних (не-null) оцінок у словнику фільмів
function countRatings(films) {
  let n = 0;
  for (const k of Object.keys(films || {})) {
    const r = films[k] && films[k].ratings;
    if (r && typeof r === 'object') {
      n += Object.values(r).filter(v => v != null).length;
    }
  }
  return n;
}

// Нормалізація словника фільмів: прибирає null-записи, масив перетворює
// на об'єкт з текстовими ключами (RTDB не приймає масиви з дірами)
function normalizeFilms(films) {
  const src = Array.isArray(films)
    ? films.map((f, i) => [String(i), f])
    : Object.entries(films || {});
  const out = {};
  for (const [k, f] of src) {
    if (f && typeof f === 'object') out[k] = f;
  }
  return out;
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
  return {
    meta: {
      app: 'Фільмотека',
      projectId: firebaseConfig.projectId,
      databaseURL: firebaseConfig.databaseURL,
      exportedAt: new Date().toISOString(),
      films: keys.length,
      ratings: countRatings(films),
      members: (USERS_LIST || []).map(u => u.id)
    },
    films,
    tgConfig: tgSnap.val() ?? null
  };
}

// ---------- Відновлення бази з файлу експорту ----------
// Перевірка структури файлу БЕЗ запису: повертає { ok, films, ratings, hasTg }
// або { ok: false, msg } з поясненням українською.
export function validateImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, msg: 'Це не файл експорту Фільмотеки' };
  }
  if (!data.films || typeof data.films !== 'object' || Array.isArray(data.films)) {
    return { ok: false, msg: 'У файлі немає розділу «films» — це не експорт Фільмотеки' };
  }
  const films = normalizeFilms(data.films);
  return {
    ok: true,
    films: Object.keys(films).length,
    ratings: countRatings(films),
    hasTg: !!(data.tgConfig && typeof data.tgConfig === 'object' && data.tgConfig.token)
  };
}

// Атомарна заміна films + tgConfig вмістом файлу. Один multi-path
// update по кореню: або все запишеться, або нічого.
export async function importAll(data) {
  const check = validateImport(data);
  if (!check.ok) throw new Error(check.msg);
  const films = normalizeFilms(data.films);
  const tg = (data.tgConfig && typeof data.tgConfig === 'object') ? data.tgConfig : null;
  await update(ref(db), { films, tgConfig: tg });
  return { films: Object.keys(films).length, ratings: countRatings(films), tg: !!tg };
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
