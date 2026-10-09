// ============================================================
// Збагачення даних про фільм (порядок — «спочатку те, що швидше»):
//  1) Wikidata через швидкий wbgetentities (QID або IMDb ID -> claims,
//     мітки, sitelinks) — назви (uk + en)/жанри/актори/режисер/рік/прем'єра
//  2) СПАРКЛ-резерв (якщо швидкий шлях не дав основних полів)
//  3) СЮЖЕТ: англійська Вікіпедія (точна стаття за sitelink, потім
//     пошук) — усі дані окрім назви користувач хоче англійською;
//     українська стаття — страховка, якщо англійської немає
// Усе опціонально: будь-яка помилка просто лишає поля порожніми.
// ============================================================

import { qidByImdbId, enrichByQid } from './wiki.js';

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
SELECT ?ukLabel ?enLabel ?enDesc ?enWikiTitle ?directorLabel ?countryLabel ?genreLabel ?actorLabel ?duration ?date WHERE {
  ?film wdt:P345 "${imdbId}" .
  OPTIONAL { ?film rdfs:label ?ukLabel . FILTER(LANG(?ukLabel) = "uk") }
  OPTIONAL { ?film rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?film schema:description ?enDesc . FILTER(LANG(?enDesc) = "en") }
  OPTIONAL {
    ?enArt schema:about ?film ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?enWikiTitle .
  }
  OPTIONAL { ?film wdt:P57 ?director . }
  OPTIONAL { ?film wdt:P495 ?country . }
  OPTIONAL { ?film wdt:P2047 ?duration . }
  OPTIONAL { ?film wdt:P577 ?date . }
  OPTIONAL { ?film wdt:P136 ?genre . }
  OPTIONAL { ?film wdt:P161 ?actor . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,uk" . }
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
  if (first.enLabel) out.titleEn = first.enLabel.value;
  if (first.enDesc) out.desc = first.enDesc.value;
  if (first.directorLabel) out.director = first.directorLabel.value;
  if (first.countryLabel) out.country = first.countryLabel.value;
  if (first.duration) out.runtime = parseInt(first.duration.value, 10) || null;
  // Точні назви статей en/uk Вікіпедії про ЦЕЙ фільм/серіал (sitelink
  // Вікіданих). Рятує від «сліпого» пошуку: «Теорія великого вибуху»
  // без уточнення — стаття про космологію, а серіал — «(телесеріал)».
  if (first.enWikiTitle) out.enWikiTitle = first.enWikiTitle.value;

  const genres = [...new Set(rows.map(r => r.genreLabel && r.genreLabel.value).filter(Boolean))];
  if (genres.length) out.genres = genres.slice(0, 6);

  // Актори (P161): перші знайдені українські/англійські мітки
  const cast = [...new Set(rows.map(r => r.actorLabel && r.actorLabel.value).filter(Boolean))];
  if (cast.length) out.cast = cast.slice(0, 6);

  // Рік і прем'єра з P577 (?date у SELECT довго ігнорувався): найраніша
  // дата виходу — «рік фільму»; якщо у Вікіданих є дата з точністю до
  // дня — це прем'єра («2007-09-24»). «01-01» = рік без дня, її лишаємо
  // лише роком, щоб не показувати вигадане 1 січня.
  let premiere = null, pYear = null;
  for (const raw of rows.map(r => r.date && r.date.value)) {
    const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const y = parseInt(m[1], 10);
    if (y < 1888 || y > 2100) continue;
    if (pYear == null || y < pYear) pYear = y;
    if (!(m[2] === '01' && m[3] === '01')) {
      const iso = `${m[1]}-${m[2]}-${m[3]}`;
      if (premiere == null || iso < premiere) premiere = iso;
    }
  }
  if (pYear != null) out.year = pYear;
  if (premiere) out.premiere = premiere;

  return out;
}

// Пошук статті у Вікіпедії (lang) -> вступний текст + мініатюра
async function wikiSummary(lang, search) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    '&generator=search&gsrlimit=1&prop=extracts|pageimages&exintro=1&explaintext=1&exlimit=1' +
    // pilicense=any: без цього en.вікі ховає fair-use постери фільмів
    '&piprop=thumbnail&pithumbsize=500&pilicense=any&gsrsearch=' + encodeURIComponent(search);

  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  if (!pages.length) return {};
  const p = pages[0];
  return {
    plot: (p.extract || '').trim() || null,
    // чистимо ?utm_source=… — тримаємо URL постерів охайними
    poster: String(p.thumbnail && p.thumbnail.source || '').replace(/\?utm_source=.*$/, '') || null
  };
}

// Пряме читання статті за ТОЧНОЮ назвою (titles=, без пошуку) —
// найнадійніший спосіб отримати сюжет саме про цей фільм/серіал
async function wikiArticleByTitle(lang, title) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    '&titles=' + encodeURIComponent(title) + '&redirects=1' +
    '&prop=extracts|pageimages&exintro=1&explaintext=1' +
    '&piprop=thumbnail&pithumbsize=500&pilicense=any';

  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  if (!pages.length) return {};
  const p = pages[0];
  if (p.missing !== undefined) return {};
  return {
    plot: (p.extract || '').trim() || null,
    poster: String(p.thumbnail && p.thumbnail.source || '').replace(/\?utm_source=.*$/, '') || null
  };
}

// Перевірка, що вступ статті дійсно про фільм/серіал, а не про однойменну
// книгу/теорію/людину і не про сторінку значень. «Теорія великого вибуху»
// (серіал) — «американський серіал…» ✓; «Великий вибух» (космологія) — ✗.
const FILM_WORDS_RE = /фільм|серіал|мультфільм|мультсеріал|короткометражк|анімаційн|телевізійн/i;
// Англійська страховка: «is an American television series…», «…is a 2014 film»
const EN_FILM_WORDS_RE = /\b(film|movie|series|television|miniseries|mini-series|anthology|documentary|sitcom)\b/i;
const DAB_RE = /може означати|багатозначн|список значень|may refer to|disambiguation/i;

function extractLooksLikeFilm(extract, expectTitles) {
  const head = String(extract || '').slice(0, 400);
  if (!head) return false;
  if (DAB_RE.test(head)) return false;
  if (FILM_WORDS_RE.test(head) || EN_FILM_WORDS_RE.test(head)) return true;
  const low = head.toLowerCase();
  return (expectTitles || []).some(t => {
    const s = String(t || '').toLowerCase().trim();
    return s.length >= 6 && low.includes(s.slice(0, Math.min(s.length, 40)));
  });
}

// Головна функція: повертає { titleUk, titleEn, director, country, genres[], runtime,
// plot, poster, year, premiere, enWikiTitle, ukWikiTitle, desc }
// qid — якщо вже відомий (фільм обрано з Вікіпедії): пропускаємо надійний,
// але зайвий крок qidByImdbId і читаємо Вікідані напряму.
export async function enrichFilm({ imdbId, qid, title, year, titleUkHint }) {
  let out = {};

  // ---- 1) ШВИДКИЙ ШЛЯХ: QID (або IMDb ID -> QID) -> wbgetentities
  // (кілька сотень мс, надійніше за SPARQL — без черг і довгих таймаутів)
  try {
    if (qid && /^Q\d+$/.test(qid)) {
      out = await enrichByQid(qid);
    } else if (imdbId) {
      const q = await qidByImdbId(imdbId);
      if (q) out = await enrichByQid(q);
    }
  } catch (e) { out = {}; }

  // ---- 2) СПАРКЛ-РЕЗЕРВ: лише якщо швидкий шлях не дав основних полів
  // (він же дає короткий en-опис enDesc — запасний сюжет)
  const coreOk = out.titleUk || out.director || (out.genres && out.genres.length);
  if (!coreOk && imdbId) {
    try {
      const d = await enrichByImdbId(imdbId);
      for (const k of ['titleUk', 'titleEn', 'director', 'country', 'runtime', 'enWikiTitle', 'ukWikiTitle', 'year', 'premiere', 'desc']) {
        if (d[k] && !out[k]) out[k] = d[k];
      }
      if ((d.genres || []).length && !(out.genres || []).length) out.genres = d.genres;
      if ((d.cast || []).length && !(out.cast || []).length) out.cast = d.cast;
    } catch (e) {
      console.warn('[enrich] Wikidata недоступна:', e && e.message);
    }
  }

  // ---- 3) СЮЖЕТ — АНГЛІЙСЬКИЙ ПЕРШИМ (усі дані окрім назви — англійською,
  // домовленість з користувачем); український — як страховка.
  // Порядок: точна en-стаття (sitelink Вікіданих) -> точна uk-стаття ->
  // пошук uk -> пошук en. Кожен результат перевіряємо «це фільм/серіал».
  if (!out.plot && (out.enWikiTitle || title)) {
    try {
      const r = await wikiArticleByTitle('en', out.enWikiTitle || title);
      if (r.plot && extractLooksLikeFilm(r.plot, [out.titleEn || title, title, titleUkHint])) {
        out.plot = r.plot;
        if (!out.poster && r.poster) out.poster = r.poster;
      }
    } catch (e) { /* наступні варіанти */ }
  }
  if (!out.plot && out.ukWikiTitle) {
    try {
      const r = await wikiArticleByTitle('uk', out.ukWikiTitle);
      if (r.plot) {
        out.plot = r.plot;
        if (!out.poster && r.poster) out.poster = r.poster;
      }
    } catch (e) { /* наступні варіанти */ }
  }
  if (!out.plot) {
    const expect = [out.titleUk, titleUkHint, title, out.titleEn].filter(Boolean);
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
        const r = await wikiSummary('uk', q);
        if (r.plot && extractLooksLikeFilm(r.plot, expect)) {
          out.plot = r.plot;
          if (!out.poster && r.poster) out.poster = r.poster;
          break;
        }
      } catch (e) { /* наступний варіант */ }
    }
  }
  if (!out.plot && title) {
    try {
      const r = await wikiSummary('en', title);
      if (r.plot && extractLooksLikeFilm(r.plot, [out.titleEn || title, title])) {
        out.plot = r.plot;
        if (!out.poster && r.poster) out.poster = r.poster;
      }
    } catch (e) { /* сюжет не критичний */ }
  }

  // Якщо з Wikidata прийшов лише короткий опис — використаємо його як запасний сюжет
  if (out.desc && !out.plot) out.plot = out.desc;

  if (out.plot && out.plot.length > 700) {
    out.plot = out.plot.slice(0, 697).trimEnd() + '…';
  }
  return out;
}
