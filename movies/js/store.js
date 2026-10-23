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

// ---------- Універсальні операції над колекціями (films / games) ----------
// «Ігри» живуть в окремому вузлі бази, але за тією ж схемою,
// що й фільми: тож усі CRUD-операції параметризовані вузлом.

// Підписка на довільну колекцію. cb(list[], error|null)
export function onList(node, cb) {
  return onValue(
    ref(db, node),
    (snap) => cb(toList(snap.val())),
    (err) => cb(null, err)
  );
}

// Додати запис до колекції. Повертає ключ нового запису.
export async function addTo(node, data) {
  const r = push(ref(db, node));
  const now = Date.now();
  await set(r, {
    ratings: {},
    ...data,
    createdAt: now,
    updatedAt: now
  });
  return r.key;
}

// Оновити поля запису
export async function updateIn(node, id, patch) {
  await update(ref(db, `${node}/${id}`), { ...patch, updatedAt: Date.now() });
}

// Видалити запис разом з оцінками
export async function deleteFrom(node, id) {
  await remove(ref(db, `${node}/${id}`));
}

// Поставити/змінити оцінку у колекції. score = null прибирає оцінку.
export async function setRatingIn(node, id, user, score) {
  await set(ref(db, `${node}/${id}/ratings/${user}`), score ?? null);
}

// ---------- Аватарки учасників (вузол «users») ----------
// Фото живуть у базі як невеликі data-URL (стискаємо до 160×160),
// тож усі друзі бачать аватарки одразу — жодних файлів чи сховищ.
export function onUserMeta(cb) {
  return onValue(
    ref(db, 'users'),
    (snap) => cb(snap.val() || null),
    (err) => { console.warn('[store] users:', err && err.code); cb(null); }
  );
}
// dataUrl = null прибирає аватарку (повертається літера на кольоровому колі)
export async function setUserAvatar(userId, dataUrl) {
  await set(ref(db, `users/${userId}/avatar`), dataUrl ?? null);
}

// ---------- Повний експорт бази (для резервної копії в JSON) ----------
// Читаємо ті самі вузли, які використовує застосунок (films, games,
// tgConfig, users), тож експорт працює за будь-яких правил безпеки,
// за яких працює сам додаток.
export async function exportAll() {
  const [filmsSnap, gamesSnap, tgSnap, usersSnap] = await Promise.all([
    get(ref(db, 'films')),
    get(ref(db, 'games')),
    get(ref(db, 'tgConfig')),
    get(ref(db, 'users'))
  ]);
  const films = filmsSnap.val() || {};
  const games = gamesSnap.val() || {};
  const users = usersSnap.val() || {};
  const keys = Object.keys(films);
  return {
    meta: {
      app: 'Фільмотека',
      projectId: firebaseConfig.projectId,
      databaseURL: firebaseConfig.databaseURL,
      exportedAt: new Date().toISOString(),
      films: keys.length,
      games: Object.keys(games).length,
      ratings: countRatings(films) + countRatings(games),
      avatars: Object.values(users).filter(u => u && u.avatar).length,
      members: (USERS_LIST || []).map(u => u.id)
    },
    films,
    games,
    tgConfig: tgSnap.val() ?? null,
    users: usersSnap.val() ?? null
  };
}

// ---------- Відновлення бази з файлу експорту ----------
// Перевірка структури файлу БЕЗ запису: повертає { ok, films, ratings, games, hasTg }
// або { ok: false, msg } з поясненням українською. Розділ «games» необов'язковий —
// старі експорти без ігор теж приймаються.
export function validateImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, msg: 'Це не файл експорту Фільмотеки' };
  }
  if (!data.films || typeof data.films !== 'object' || Array.isArray(data.films)) {
    return { ok: false, msg: 'У файлі немає розділу «films» — це не експорт Фільмотеки' };
  }
  const films = normalizeFilms(data.films);
  const games = data.games ? normalizeFilms(data.games) : {};
  const users = (data.users && typeof data.users === 'object' && !Array.isArray(data.users)) ? data.users : {};
  return {
    ok: true,
    films: Object.keys(films).length,
    games: Object.keys(games).length,
    hasGames: !!data.games,
    ratings: countRatings(films) + countRatings(games),
    hasTg: !!(data.tgConfig && typeof data.tgConfig === 'object' && data.tgConfig.token),
    avatars: Object.values(users).filter(u => u && u.avatar).length
  };
}

// Атомарна заміна вмісту файлу. Один multi-path update по кореню:
// або все запишеться, або нічого. Розділ «games» пишемо ЛИШЕ якщо він
// є у файлі — інакше відновлення старого експорту стерло б ігри, які
// користувачі вже встигли додати після цього експорту.
export async function importAll(data) {
  const check = validateImport(data);
  if (!check.ok) throw new Error(check.msg);
  const films = normalizeFilms(data.films);
  const tg = (data.tgConfig && typeof data.tgConfig === 'object') ? data.tgConfig : null;
  const patch = { films, tgConfig: tg };
  if (data.games) patch.games = normalizeFilms(data.games);
  // Аватарки пишемо ЛИШЕ якщо розділ «users» є у файлі (старі експорти
  // його не мають) — інакше відновлення стерло б живі аватарки
  if (data.users && typeof data.users === 'object') patch.users = data.users;
  await update(ref(db), patch);
  return {
    films: Object.keys(films).length,
    games: data.games ? Object.keys(patch.games).length : null,
    avatars: patch.users ? Object.values(patch.users).filter(u => u && u.avatar).length : null,
    ratings: countRatings(films) + (data.games ? countRatings(patch.games) : 0),
    tg: !!tg
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
