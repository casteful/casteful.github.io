// ============================================================
// Автозаповнення назв через публічний IMDb Suggestion API
// (без ключа; повертає назву, рік, постер, IMDb ID).
//
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

  for (const url of urls) {
    try {
      const data = await fetchJSON(url, 7000);
      const list = (data && Array.isArray(data.d) ? data.d : [])
        .filter(x => x && typeof x.id === 'string' && x.id.startsWith('tt') && ALLOWED_TYPES[x.qid] !== undefined)
        .slice(0, 8)
        .map(x => ({
          imdbId: x.id,
          title: x.l || 'Без назви',
          year: x.y || null,
          poster: (x.i && x.i.imageUrl) || null,
          type: x.qid || 'movie',
          source: 'imdb'
        }));
      // Відповідь отримано (навіть порожня — дзеркала ідентичні), далі не йдемо
      markOk();
      return list;
    } catch (e) {
      // Пробуємо наступне дзеркало
    }
  }

  // Обидва дзеркала недоступні (мережа/CORS) — тимчасово вимикаємо IMDb
  markDown();
  return [];
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
