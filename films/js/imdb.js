// ============================================================
// Автозаповнення назв через публічний IMDb Suggestion API
// (без ключа, з підтримкою CORS; повертає назву, рік, постер, IMDb ID)
// ============================================================

const ALLOWED_TYPES = {
  movie: '',
  tvMovie: 'ТВ-фільм',
  tvSeries: 'серіал',
  tvMiniSeries: 'мінісеріал',
  short: 'короткометражка',
  video: 'відео'
};

export function typeLabel(qid) {
  return ALLOWED_TYPES[qid] ?? null;
}

export async function suggestFilms(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

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
          type: x.qid || 'movie'
        }));
      // Перша відповідь успішна — далі не йдемо
      if (data) return list;
    } catch (e) {
      // Пробуємо наступне дзеркало
    }
  }
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
