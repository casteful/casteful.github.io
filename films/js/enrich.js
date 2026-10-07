// ============================================================
// Збагачення даних про фільм:
//  1) Wikidata SPARQL (за IMDb ID) -> українська назва, режисер,
//     жанри, тривалість, опис українською
//  2) Українська Вікіпедія (фолбек) -> опис/сюжет, зображення
// Усе опціонально: будь-яка помилка просто лишає поля порожніми.
// ============================================================

const WD_ENDPOINT = 'https://query.wikidata.org/sparql';

async function fetchJSON(url, timeoutMs = 8000, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function enrichByImdbId(imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return {};

  const query = `
SELECT ?ukLabel ?ukDesc ?directorLabel ?genreLabel ?duration ?date WHERE {
  ?film wdt:P345 "${imdbId}" .
  OPTIONAL { ?film rdfs:label ?ukLabel . FILTER(LANG(?ukLabel) = "uk") }
  OPTIONAL { ?film schema:description ?ukDesc . FILTER(LANG(?ukDesc) = "uk") }
  OPTIONAL { ?film wdt:P57 ?director . }
  OPTIONAL { ?film wdt:P2047 ?duration . }
  OPTIONAL { ?film wdt:P577 ?date . }
  OPTIONAL { ?film wdt:P136 ?genre . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "uk,en" . }
} LIMIT 60`;

  const data = await fetchJSON(
    `${WD_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
    9000,
    { 'Accept': 'application/sparql-results+json' }
  );

  const rows = (data && data.results && Array.isArray(data.results.bindings)) ? data.results.bindings : [];
  if (!rows.length) return {};

  const out = {};
  const first = rows[0];
  if (first.ukLabel) out.titleUk = first.ukLabel.value;
  if (first.ukDesc) out.desc = first.ukDesc.value;
  if (first.directorLabel) out.director = first.directorLabel.value;
  if (first.duration) out.runtime = parseInt(first.duration.value, 10) || null;

  const genres = [...new Set(rows.map(r => r.genreLabel && r.genreLabel.value).filter(Boolean))];
  if (genres.length) out.genres = genres.slice(0, 6);

  return out;
}

// Пошук статті в українській Вікіпедії -> вступний текст + мініатюра
async function wikiSummary(search) {
  const url =
    'https://uk.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
    '&generator=search&gsrlimit=1&prop=extracts|pageimages&exintro=1&explaintext=1&exlimit=1' +
    '&piprop=thumbnail&pithumbsize=500&gsrsearch=' + encodeURIComponent(search);

  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  if (!pages.length) return {};
  const p = pages[0];
  return {
    plot: (p.extract || '').trim() || null,
    poster: (p.thumbnail && p.thumbnail.source) || null
  };
}

// Головна функція: повертає { titleUk, director, genres[], runtime, plot, poster }
export async function enrichFilm({ imdbId, title, year, titleUkHint }) {
  let out = {};
  try {
    out = await enrichByImdbId(imdbId);
  } catch (e) {
    console.warn('[enrich] Wikidata недоступна:', e && e.message);
  }

  // Опис: спершу спробуємо українською назвою (точніший пошук), потім оригінальною
  if (!out.plot) {
    const queries = [out.titleUk, titleUkHint, title ? `${title}${year ? ' ' + year : ''}` : null]
      .filter(Boolean);
    for (const q of queries) {
      try {
        const r = await wikiSummary(q);
        if (r.plot) {
          out.plot = r.plot;
          if (!out.poster && r.poster) out.poster = r.poster;
          break;
        }
      } catch (e) { /* наступний варіант */ }
    }
  }

  // Якщо з Wikidata прийшов лише короткий опис — використаємо його як запасний сюжет
  if (out.desc && !out.plot) out.plot = out.desc;

  if (out.plot && out.plot.length > 700) {
    out.plot = out.plot.slice(0, 697).trimEnd() + '…';
  }
  return out;
}
