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
SELECT ?ukLabel ?ukDesc ?directorLabel ?genreLabel ?actorLabel ?duration ?date ?ukWikiTitle WHERE {
  ?film wdt:P345 "${imdbId}" .
  OPTIONAL { ?film rdfs:label ?ukLabel . FILTER(LANG(?ukLabel) = "uk") }
  OPTIONAL { ?film schema:description ?ukDesc . FILTER(LANG(?ukDesc) = "uk") }
  OPTIONAL {
    ?ukArt schema:about ?film ;
           schema:isPartOf <https://uk.wikipedia.org/> ;
           schema:name ?ukWikiTitle .
  }
  OPTIONAL { ?film wdt:P57 ?director . }
  OPTIONAL { ?film wdt:P2047 ?duration . }
  OPTIONAL { ?film wdt:P577 ?date . }
  OPTIONAL { ?film wdt:P136 ?genre . }
  OPTIONAL { ?film wdt:P161 ?actor . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "uk,en" . }
} LIMIT 150`;

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
  // Точна назва статті uk.Вікіпедії про ЦЕЙ фільм/серіал (з sitelink
  // Вікіданих). Врятуовує від «сліпого» пошуку: «Теорія великого вибуху»
  // без уточнення — стаття про космологію, а серіал — «(телесеріал)».
  if (first.ukWikiTitle) out.ukWikiTitle = first.ukWikiTitle.value;

  const genres = [...new Set(rows.map(r => r.genreLabel && r.genreLabel.value).filter(Boolean))];
  if (genres.length) out.genres = genres.slice(0, 6);

  // Актори (P161): перші знайдені українські/англійські мітки
  const cast = [...new Set(rows.map(r => r.actorLabel && r.actorLabel.value).filter(Boolean))];
  if (cast.length) out.cast = cast.slice(0, 6);

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

// Пряме читання статті за ТОЧНОЮ назвою (titles=, без пошуку) —
// найнадійніший спосіб отримати сюжет саме про цей фільм/серіал
async function wikiArticleByTitle(title) {
  const url =
    'https://uk.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
    '&titles=' + encodeURIComponent(title) + '&redirects=1' +
    '&prop=extracts|pageimages&exintro=1&explaintext=1' +
    '&piprop=thumbnail&pithumbsize=500';

  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  if (!pages.length) return {};
  const p = pages[0];
  if (p.missing !== undefined) return {};
  return {
    plot: (p.extract || '').trim() || null,
    poster: (p.thumbnail && p.thumbnail.source) || null
  };
}

// Перевірка, що вступ статті дійсно про фільм/серіал, а не про однойменну
// книгу/теорію/людину і не про сторінку значень. «Теорія великого вибуху»
// (серіал) — «американський серіал…» ✓; «Великий вибух» (космологія) — ✗.
const FILM_WORDS_RE = /фільм|серіал|мінісеріал|мультфільм|мультсеріал|короткометражк|анімаційн|телевізійн/i;
const DAB_RE = /може означати|багатозначн|список значень|may refer to|disambiguation/i;

function extractLooksLikeFilm(extract, expectTitles) {
  const head = String(extract || '').slice(0, 400);
  if (!head) return false;
  if (DAB_RE.test(head)) return false;
  if (FILM_WORDS_RE.test(head)) return true;
  const low = head.toLowerCase();
  return (expectTitles || []).some(t => {
    const s = String(t || '').toLowerCase().trim();
    return s.length >= 6 && low.includes(s.slice(0, Math.min(s.length, 40)));
  });
}

// Головна функція: повертає { titleUk, director, genres[], runtime, plot, poster }
export async function enrichFilm({ imdbId, title, year, titleUkHint }) {
  let out = {};
  try {
    out = await enrichByImdbId(imdbId);
  } catch (e) {
    console.warn('[enrich] Wikidata недоступна:', e && e.message);
  }

  // Опис: спершу точна стаття з sitelink Вікіданих, потім пошук —
  // ЗАВЖДИ з роком у запиті (відсіює омоніми), і лише потім «голі» назви.
  // Кожен результат пошуку перевіряємо: це має бути стаття про фільм/серіал.
  if (!out.plot) {
    if (out.ukWikiTitle) {
      try {
        const r = await wikiArticleByTitle(out.ukWikiTitle);
        if (r.plot) {
          out.plot = r.plot;
          if (!out.poster && r.poster) out.poster = r.poster;
        }
      } catch (e) { /* наступні варіанти */ }
    }
  }
  if (!out.plot) {
    const expect = [out.titleUk, titleUkHint, title].filter(Boolean);
    const queries = [
      out.titleUk && year ? `${out.titleUk} ${year}` : null,
      title && year ? `${title} ${year}` : null,
      titleUkHint && year ? `${titleUkHint} ${year}` : null,
      titleUkHint,
      out.titleUk,
      title
    ].filter(Boolean);
    for (const q of queries) {
      try {
        const r = await wikiSummary(q);
        if (r.plot && extractLooksLikeFilm(r.plot, expect)) {
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
