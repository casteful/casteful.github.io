// ============================================================
// Firebase Realtime Database: ініціалізація та CRUD-операції
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getDatabase, ref, onValue, push, set, update, remove, get, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './config.js?v=6.4';

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

// ---------- Ігри (вкладка «Ігри») ----------
// Той самий формат, що й у фільмів, але в окремому вузлі games/:
//   { title, titleUk, year, cover, developer, publisher,
//     platforms: [], genres: [], plot, wikiUrl, qid,
//     ratings: { userId: score }, addedBy, createdAt, updatedAt }

export function onGames(cb) {
  return onValue(
    ref(db, 'games'),
    (snap) => cb(toList(snap.val())),
    (err) => cb(null, err)
  );
}

export async function addGame(data) {
  const r = push(ref(db, 'games'));
  const now = Date.now();
  await set(r, {
    ratings: {},
    ...data,
    createdAt: now,
    updatedAt: now
  });
  return r.key;
}

export async function updateGame(gameId, patch) {
  await update(ref(db, `games/${gameId}`), { ...patch, updatedAt: Date.now() });
}

export async function deleteGame(gameId) {
  await remove(ref(db, `games/${gameId}`));
}

export async function setGameRating(gameId, user, score) {
  await set(ref(db, `games/${gameId}/ratings/${user}`), score ?? null);
}

// ---------- Універсальні бібліотеки: альбоми, сингли, книги, комікси ----------
// Той самий формат запису, що й в ігор, у власних вузлах albums/,
// singles/, books/ і comics/ (жодна колекція не впливає на інші та на
// статистику фільмів):
//   { title, titleUk, kind: 'album'|'single'|'book'|'comic', year,
//     artist | author, genres: [], tracks: [] (альбоми),
//     publisher, pages (книги/комікси), plot, cover, wikiUrl, qid,
//     ratings: { userId: score }, addedBy, createdAt, updatedAt }

export function onMedia(node, cb) {
  return onValue(
    ref(db, node),
    (snap) => cb(toList(snap.val())),
    (err) => cb(null, err)
  );
}

export async function addMedia(node, data) {
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

export async function updateMedia(node, itemId, patch) {
  await update(ref(db, `${node}/${itemId}`), { ...patch, updatedAt: Date.now() });
}

export async function deleteMedia(node, itemId) {
  await remove(ref(db, `${node}/${itemId}`));
}

export async function setMediaRating(node, itemId, user, score) {
  await set(ref(db, `${node}/${itemId}/ratings/${user}`), score ?? null);
}

// ---------- Аватарки профілів ----------
// Невеликий вузол avatars/{userId} = data:image/jpeg;base64,… (квадрат
// 144×144, стиснутий у браузері — зазвичай 3–8 КБ). Класичні буквені
// аватарки лишаються резервом: хто не завантажив фото — бачить ініціали.

export function onAvatars(cb) {
  return onValue(
    ref(db, 'avatars'),
    (snap) => cb(snap.val() || {}),
    (err) => { console.warn('[store] avatars:', err && err.code); cb({}); }
  );
}

// dataUrl = null/'' — видалити аватар (повернутися до ініціалів)
export async function setAvatar(userId, dataUrl) {
  const r = ref(db, `avatars/${userId}`);
  if (dataUrl) await set(r, String(dataUrl));
  else await remove(r);
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

// ---------- Гра «Вгадай оцінку»: таблиці лідерів (окремі за режимами) ----------
// Невеликий вузол quizScores/{userId}:
//   { name, updatedAt,
//     friend:  { best, games, exact, updatedAt },  — режим «Рейтинг друга»
//     average: { best, games, exact, updatedAt } } — режим «Середня команди»
// (Старі спільні записи з best/games/exact нагорі більше не читаються —
// нова статистика ведеться окремо по кожному режиму.)

// Жива підписка на обидві таблиці (оновлюється, коли друзі дограли матч).
export function onQuizScores(cb) {
  return onValue(
    ref(db, 'quizScores'),
    (snap) => cb(snap.val() || {}),
    (err) => { console.warn('[store] quizScores:', err && err.code); cb({}); }
  );
}

// Результат завершеного матчу в конкретному режимі (modeKey: 'friend' | 'average').
// Транзакція (а не read+set), щоб одночасні матчі друзів не затирали один одного:
// best = max, games/exact — накопичувальні; статистика другого режиму не чіпається.
export function saveQuizResult(userId, name, modeKey, points, exact) {
  const r = ref(db, `quizScores/${userId}`);
  return runTransaction(r, (cur) => {
    const c = (cur && typeof cur === 'object') ? cur : {};
    const m = (c[modeKey] && typeof c[modeKey] === 'object') ? c[modeKey] : {};
    const now = Date.now();
    const next = { name: name || c.name || userId, updatedAt: now };
    ['friend', 'average'].forEach((k) => {
      if (k === modeKey) {
        next[k] = {
          best: Math.max(m.best || 0, points || 0),
          games: (m.games || 0) + 1,
          exact: (m.exact || 0) + (exact || 0),
          updatedAt: now
        };
      } else if (c[k] && typeof c[k] === 'object') {
        next[k] = c[k]; // другий режим не чіпаємо
      }
    });
    return next;
  }).then((res) => (res.snapshot && res.snapshot.val()) || null);
}
