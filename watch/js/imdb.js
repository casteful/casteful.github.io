// ============================================================
// Автозаповнення назв через публічний IMDb Suggestion API
// (без ключа; повертає назву, рік, постер, IMDb ID).
//
// Швидкість: обидва дзеркала опитуємо ПАРАЛЕЛЬНО — хто перший
// відповів, той і виграв; таймаут 3 с замість 7 с.
// Якщо IMDb недоступний (CORS/мережа/блокування) — запам'ятовуємо
// це в sessionStorage на 10 хв, щоб не чекати таймаутів на кожне
// натискання, і film-form одразу шукає у Вікіпедії (wiki.js).
// ============================================================

const ALLOWED_TYPES = {
  movie: '',
  tvMovie: 'ТВ-фільм',
  tvSeries: 'серіал',
  tvMiniSeries: 'мінісеріал',
  short: 'короткометражка',
  video: 'відео'
};

const DOWN_MS = 10 * 60 * 1000;

function downUntil() {
  try { return parseInt(sessionStorage.getItem('imdbDownUntil'), 10) || 0; }
  catch (e) { return 0; }
}

// IMDb щойно не відповів — ховаємо його на 10 хв і користуємось Вікіпедією
export function imdbTemporarilyDown() {
  return Date.now() < downUntil();
}

function markDown() {
  try { sessionStorage.setItem('imdbDownUntil', String(Date.now() + DOWN_MS)); } catch (e) {}
}

function markOk() {
  try { sessionStorage.removeItem('imdbDownUntil'); } catch (e) {}
}

export function typeLabel(qid) {
  return ALLOWED_TYPES[qid] ?? null;
}

export async function suggestFilms(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  // Нещодавно вже був збій — не чекаємо таймаутів, одразу Вікіпедія
  if (imdbTemporarilyDown()) return [];

  const urls = [
    `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json?includeVideos=0`,
    `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(q.charAt(0).toLowerCase())}/${encodeURIComponent(q)}.json`
  ];

  // Обидва дзеркала — паралельно; перша успішна відповідь перемагає
  const parse = (data) => (data && Array.isArray(data.d) ? data.d : [])
    .filter(x => x && typeof x.id === 'string' && x.id.startsWith('tt') && ALLOWED_TYPES[x.qid] !== undefined)
    .slice(0, 12)
    .map(x => ({
      imdbId: x.id,
      title: x.l || 'Без назви',
      // y — рік виходу; у серіалів буває лише yr («2007-2019») — беремо рік старту
      year: x.y || parseInt(x.yr, 10) || null,
      poster: (x.i && x.i.imageUrl) || null,
      type: x.qid || 'movie',
      source: 'imdb'
    }));

  try {
    const list = await Promise.any(urls.map(url => fetchJSON(url, 3000).then(parse)));
    // Відповідь отримано (навіть порожня — дзеркала ідентичні), далі не йдемо
    markOk();
    return list;
  } catch (e) {
    // Обидва дзеркала недоступні (мережа/CORS) — тимчасово вимикаємо IMDb
    markDown();
    return [];
  }
}

// Дані за tt-ID (перевірка IMDb ID із Вікіданих / постери):
// IMDb suggestion за tt-ID віддає еталонну назву — нею звіряємо,
// чи не «випадковий» це ID іншого фільму (у Вікіданнах трапляються
// помилкові P345: «Monster: The Ed Gein Story» має tt антології «Monster»).
export async function imdbById(tt) {
  if (!tt || !/^tt\d+$/.test(String(tt))) return null;
  const urls = [
    `https://v3.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json?includeVideos=0`,
    `https://v2.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json`
  ];
  for (const url of urls) {
    try {
      const data = await fetchJSON(url, 3000);
      const hit = ((data && data.d) || []).find(x => x && x.id === String(tt));
      if (hit) {
        return {
          imdbId: hit.id,
          title: hit.l || null,
          year: hit.y || parseInt(hit.yr, 10) || null,
          poster: (hit.i && hit.i.imageUrl) || null,
          type: hit.qid || null
        };
      }
      return null; // відповіли, але такого tt-ID немає
    } catch (e) { /* наступне дзеркало */ }
  }
  return null;
}

async function fetchJSON(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}
