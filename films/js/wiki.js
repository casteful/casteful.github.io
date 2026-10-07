// ============================================================
// Резервний пошук фільмів через Вікіпедію (українську та англійську)
// + добір даних через Wikidata (швидкий API wbgetentities).
//
// Використовується, коли IMDb Suggestion API недоступний (CORS,
// блокування мережі) або не знайшов фільм (наприклад, українська
// назва). Пайплайн:
//   1) Пошук статей у Вікіпедії -> назва, мініатюра (постер),
//      вступний текст, QID елемента Вікіданих
//   2) wbgetentities за всіма QID одразу -> P31/P345/P57/P577/
//      P2047/P136 -> рік, режисер, жанри, тривалість, IMDb ID,
//      українська/англійська назви (другий швидкий виклик для
//      міток режисера й жанрів)
// Усе fail-safe: будь-яка помилка лишає список порожнім або
// з базовими даними (назва/постер/опис).
// ============================================================

const WD_API = 'https://www.wikidata.org/w/api.php';

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

// ---------- Пошук статей у розділі Вікіпедії ----------

async function wikiSearch(lang, query, limit = 10) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    '&piprop=thumbnail&pithumbsize=400';

  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  // index = релевантність видачі
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

// ---------- Wikidata: твердження (claims) за списком QID ----------

async function wdClaims(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*&props=claims&ids=${encodeURIComponent(qids.join('|'))}`;
  const data = await fetchJSON(url, 6000);

  const out = {};
  const entities = (data && data.entities) || {};
  for (const qid of Object.keys(entities)) {
    const claims = entities[qid].claims || {};
    const e = { classes: [], genreQids: [] };

    for (const c of claims.P31 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.classes.push(v.id);
    }
    for (const c of claims.P345 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (typeof v === 'string' && /^tt\d+$/.test(v)) e.imdbId = v;
    }
    for (const c of claims.P57 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && !e.directorQid) e.directorQid = v.id;
    }
    for (const c of claims.P577 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const y = v && v.time ? parseInt(String(v.time).slice(1, 5), 10) : NaN;
      // найраніша дата виходу — це і є «рік фільму»
      if (!Number.isNaN(y) && y >= 1888 && y <= 2100 && (!e.year || y < e.year)) e.year = y;
    }
    for (const c of claims.P2047 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const m = v && v.amount ? parseInt(v.amount, 10) : NaN;
      if (!Number.isNaN(m) && m > 0 && !e.runtime) e.runtime = m;
    }
    for (const c of claims.P136 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.genreQids.push(v.id);
    }
    out[qid] = e;
  }
  return out;
}

// ---------- Wikidata: українські/англійські мітки ----------

async function wdLabels(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*&props=labels&languages=uk%7Cen&ids=${encodeURIComponent(qids.slice(0, 50).join('|'))}`;
  const data = await fetchJSON(url, 6000);

  const out = {};
  const entities = (data && data.entities) || {};
  for (const qid of Object.keys(entities)) {
    const labels = (entities[qid].labels) || {};
    out[qid] = {
      uk: (labels.uk && labels.uk.value) || null,
      en: (labels.en && labels.en.value) || null
    };
  }
  return out;
}

// ---------- Об'єднання: фільмові дані за QID ----------

// Не-кінематографічні сутності (книги, п'єси, альбоми, ігри, статті)
const NOT_FILM_CLASSES = new Set([
  'Q571',      // книга
  'Q8261',     // роман
  'Q149838',   // повість
  'Q699',      // оповідання
  'Q25379',    // п'єса
  'Q482994',   // музичний альбом
  'Q7366',     // пісня
  'Q7889',     // відеогра
  'Q277759',   // серія книг
  'Q3331189',  // видання
  'Q21191270', // епізод телесеріалу
  'Q7725634',  // літературний твір
  'Q191067',   // стаття
  'Q17329259', // енциклопедична стаття
  'Q13433827'  // есе
]);

async function wikidataByQids(qids) {
  if (!qids.length) return { map: {}, ok: true };

  let claims;
  try {
    claims = await wdClaims(qids);
  } catch (e) {
    return { map: {}, ok: false }; // Wikidata недоступна
  }

  // Мітки для самих фільмів + режисерів + жанрів (до 50 id за виклик)
  const extra = new Set();
  for (const e of Object.values(claims)) {
    if (e.directorQid) extra.add(e.directorQid);
    for (const g of e.genreQids) extra.add(g);
  }
  let labels = {};
  try {
    labels = await wdLabels([...new Set(qids), ...extra]);
  } catch (e) { /* мітки не критичні */ }

  const map = {};
  for (const qid of qids) {
    const c = claims[qid];
    if (!c) continue;
    if ((c.classes || []).some(cl => NOT_FILM_CLASSES.has(cl))) continue;
    // Фільтр «це точно кіно/серіал»: IMDb ID, режисер або (рік і жанр)
    const filmLike = c.imdbId || c.directorQid || (c.year && c.genreQids.length);
    if (!filmLike) continue;

    const lab = labels[qid] || {};
    const dirLab = c.directorQid ? (labels[c.directorQid] || {}) : {};
    map[qid] = {
      titleUk: lab.uk || null,
      titleEn: lab.en || null,
      imdbId: c.imdbId || null,
      director: dirLab.uk || dirLab.en || null,
      genres: c.genreQids.map(g => (labels[g] ? (labels[g].uk || labels[g].en) : null)).filter(Boolean).slice(0, 6),
      runtime: c.runtime || null,
      year: c.year || null
    };
  }
  return { map, ok: true };
}

// ---------- Дрібні хелпери ----------

function cleanThumb(src) {
  return src ? String(src).replace(/\?utm_source=.*$/, '') : null;
}

// «...фільм 1994 року» -> 1994 (тільки на початку тексту)
function yearFromExtract(text) {
  const m = String(text || '').slice(0, 200).match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\s*року/);
  return m ? parseInt(m[1], 10) : null;
}

// «... (англ. The Shawshank Redemption, досл. ...)» -> оригінальна назва
function origTitleFromExtract(text) {
  const m = String(text || '').match(/\(англ\.?\s*([^),;.]+)/);
  return m ? m[1].trim() : null;
}

function truncPlot(s) {
  s = String(s || '').trim();
  return s.length > 700 ? s.slice(0, 697).trimEnd() + '…' : (s || null);
}

// Евристика «схоже на фільм» за вступним текстом статті —
// використовується, лише коли Wikidata недоступна
const FILM_WORDS = /фільм|серіал|мінісеріал|мультфільм|короткометражк|анімаційн/i;
const NOT_FILM_WORDS = /\b(актор|акторка|режисер|письменник|сценарист|повість|роман|оповідання|книга|п'єса|альбом|співак|співачка|музикант|художник|футболіст)/i;

function looksLikeFilmByExtract(text) {
  const head = String(text || '').slice(0, 250);
  if (!head) return true; // без тексту — не судимо
  return FILM_WORDS.test(head) && !NOT_FILM_WORDS.test(head);
}

// ---------- Збір елементів зі сторінок (з Wikidata-фільтром) ----------

async function collectItems(pages, seen) {
  // дедуплікація за QID або назвою (seen — спільний між розділами Вікіпедії)
  pages = pages.filter(p => {
    const qid = p.pageprops && p.pageprops.wikibase_item;
    const key = qid || ('t:' + String(p.title || '').toLowerCase());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!pages.length) return [];

  const qids = pages.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
  const { map: wd, ok: wdOk } = await wikidataByQids(qids);

  const items = [];
  for (const p of pages) {
    const qid = (p.pageprops && p.pageprops.wikibase_item) || null;
    const e = qid ? (wd[qid] || null) : null;

    if (qid && wdOk && !e) continue; // точна вікі-сутність — і це не фільм
    // Wikidata недоступна — лишаємо статтю лише якщо за текстом схоже на фільм
    if (!wdOk && !looksLikeFilmByExtract(p.extract)) continue;

    const titleUk = p._lang === 'uk'
      ? (e && e.titleUk) || p.title
      : (e && e.titleUk) || null;
    const origTitle = p._lang === 'en'
      ? p.title
      : ((e && e.titleEn) || origTitleFromExtract(p.extract) || null);
    const title = origTitle || titleUk || p.title;
    if (!title) continue;

    const poster = cleanThumb(p.thumbnail && p.thumbnail.source);
    const plot = truncPlot(p.extract);

    // Стаття без QID і без змістовних даних — не пропозиція
    if (!qid && !plot && !poster) continue;

    items.push({
      imdbId: (e && e.imdbId) || null,
      qid,
      title,
      titleUk: titleUk || null,
      year: (e && e.year) || yearFromExtract(p.extract),
      poster,
      type: 'movie',
      source: 'wiki',
      director: (e && e.director) || null,
      genres: (e && e.genres) || [],
      runtime: (e && e.runtime) || null,
      plot
    });
  }
  return items;
}

// ---------- Головна функція пошуку ----------

export async function searchWikiFilms(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const hasCyrillic = /[а-яіїєґ]/i.test(q);
  const langs = hasCyrillic ? ['uk', 'en'] : ['en', 'uk'];

  const seen = new Set();
  let items = [];

  // Спершу розділ мовою запиту...
  try { items = await collectItems(await wikiSearch(langs[0], q), seen); }
  catch (e) { /* спробуємо другий розділ */ }

  // ...і якщо фільмів майже не знайшлось — добираємо з другого розділу
  if (items.length < 2) {
    try { items = items.concat(await collectItems(await wikiSearch(langs[1], q), seen)); }
    catch (e) { /* лишаємо те, що є */ }
  }

  // Прибираємо дублікати за назвою (укр. та англ. статті того самого фільму)
  const out = [];
  const tSeen = new Set();
  for (const it of items) {
    const k = String(it.title || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
    if (k && tSeen.has(k)) continue;
    if (k) tSeen.add(k);
    out.push(it);
  }
  return out.slice(0, 8);
}

// ---------- Добір даних за QID (коли фільм обрано з Вікіпедії) ----------

export async function enrichByQid(qid) {
  if (!qid || !/^Q\d+$/.test(qid)) return {};
  const { map: wd } = await wikidataByQids([qid]);
  const e = wd[qid];
  if (!e) return {};
  return {
    titleUk: e.titleUk || null,
    title: e.titleEn || null,
    imdbId: e.imdbId || null,
    director: e.director || null,
    genres: e.genres || [],
    runtime: e.runtime || null,
    year: e.year || null
  };
}
