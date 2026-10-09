// ============================================================
// Резервний пошук фільмів через Вікіпедію (українську та англійську)
// + добір даних через Wikidata (швидкий API wbgetentities).
//
// Використовується, коли IMDb Suggestion API недоступний (CORS,
// блокування мережі) або не знайшов фільм (наприклад, українська
// назва). Пайплайн (усе ПАРАЛЕЛЬНО, де можливо — задля швидкості):
//   1) Пошук статей у Вікіпедії (префіксний + повнотекстовий, uk+en)
//      -> назва, мініатюра (постер), вступний текст, QID Вікіданих
//   2) wbgetentities: claims + мітки фільмів одним викликом;
//      другим швидким викликом — мітки режисерів, жанрів і акторів
//      -> P31/P345/P57/P577/P2047/P136/P161
// Пакети результатів малюються поступово (onPartial) — не чекаємо
// найповільніше джерело. Усе fail-safe: будь-яка помилка лишає
// список порожнім або з базовими даними (назва/постер/опис).
//
// Постер: важливий нюанс API — MediaWiki prop=pageimages ЗА ГОСТОВОЮ
// УМОВОЮ ховає некомерційні (fair-use) постери фільмів (параметр
// pilicense за замовчуванням = "free"). Тому в УСІХ запитах pageimages
// вказуємо pilicense=any — і en.Вікіпедія (де є стаття майже про кожен
// фільм/серіал) віддає постер майже завжди. Для вже збережених фільмів
// є fetchPoster(): IMDb за tt-ID → Wikidata sitelinks → pageimages.
// ============================================================

import { OMDB_API_KEY } from './config.js';

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
    // pilicense=any: без цього en.вікі НЕ віддає fair-use постери фільмів
    '&piprop=thumbnail&pithumbsize=400&pilicense=any';

  const data = await fetchJSON(url, 6000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  // index = релевантність видачі
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

// Швидкий ПРЕФІКСНИЙ пошук (тільки за назвами статей) — легкий і
// зазвичай вдвічі-втричі швидший за повнотекстовий; дає найперші підказки
async function wikiPrefix(lang, query, limit = 6) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=prefixsearch&gpslimit=${limit}&gpssearch=${encodeURIComponent(query)}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    '&piprop=thumbnail&pithumbsize=400&pilicense=any';

  const data = await fetchJSON(url, 4000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

// ---------- Wikidata: claims + мітки фільмів ОДНИМ викликом ----------
// (швидше, ніж два окремі запити claims і labels)

async function wdEntities(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*` +
    `&props=claims%7Clabels%7Csitelinks&languages=uk%7Cen&ids=${encodeURIComponent(qids.join('|'))}`;
  const data = await fetchJSON(url, 5000);

  const out = {};
  const entities = (data && data.entities) || {};
  for (const qid of Object.keys(entities)) {
    const ent = entities[qid] || {};
    const claims = ent.claims || {};
    const labels = ent.labels || {};
    const sitelinks = ent.sitelinks || {};
    const e = { classes: [], genreQids: [] };
    // Точні назви статей uk/en Вікіпедії про ЦЮ сутність (sitelink) —
    // найнадійніший спосіб дістати сюжет і назву без «сліпого» пошуку
    e.ukWikiTitle = (sitelinks.ukwiki && sitelinks.ukwiki.title) || null;
    e.enWikiTitle = (sitelinks.enwiki && sitelinks.enwiki.title) || null;

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
      const t = v && v.time ? String(v.time) : '';
      const y = t ? parseInt(t.slice(1, 5), 10) : NaN;
      // найраніша дата виходу — це і є «рік фільму»
      if (!Number.isNaN(y) && y >= 1888 && y <= 2100 && (e.year == null || y < e.year)) e.year = y;
      // повна дата (з точністю до дня, precision=11) — для «Прем'єра: …»
      if (v && v.precision === 11 && /^[-+]?\d{4}-\d{2}-\d{2}/.test(t)) {
        const iso = t.replace(/^[-+]?/, '').slice(0, 10);
        if (!e.premiere || iso < e.premiere) e.premiere = iso;
      }
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
    // Актори (P161): беремо перших 8 — зазвичай це головні ролі
    e.actorQids = [];
    for (const c of claims.P161 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.actorQids.push(v.id);
      if (e.actorQids.length >= 8) break;
    }
    e.labelUk = (labels.uk && labels.uk.value) || null;
    e.labelEn = (labels.en && labels.en.value) || null;
    out[qid] = e;
  }
  return out;
}

// ---------- Wikidata: українські/англійські мітки (для режисерів і жанрів) ----------

async function wdLabels(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*&props=labels&languages=uk%7Cen&ids=${encodeURIComponent(qids.slice(0, 50).join('|'))}`;
  const data = await fetchJSON(url, 5000);

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
  'Q3464665',  // сезон телесеріалу (не сам витвір — інакше підказки
               // забиваються сезонами: «The Big Bang Theory season 1»)
  'Q13406463', // список статей Вікімедіа («List of … episodes»)
  'Q7725634',  // літературний твір
  'Q191067',   // стаття
  'Q17329259', // енциклопедична стаття
  'Q13433827'  // есе
]);

async function wikidataByQids(qids, opts = {}) {
  if (!qids.length) return { map: {}, ok: true };

  // claims + мітки самих фільмів — ОДНИМ викликом (швидше, ніж два)
  let ents;
  try {
    ents = await wdEntities(qids);
  } catch (e) {
    return { map: {}, ok: false }; // Wikidata недоступна
  }

  // Рятувальний точний збіг: сутності класу «сезон серіалу» (Q3464665)
  // зазвичай відкидаються, АЛЕ якщо назва ДОСЛІВНО збігається із запитом
  // («Monster: The Ed Gein Story» — сезон антології «Monster» на IMDb) —
  // це саме те, що шукає користувач. Інакше потрібного результату
  // просто немає у підказках, і користувач додає неправильний фільм.
  const nq = opts.rescueQuery
    ? String(opts.rescueQuery).toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '') : '';
  const nrm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');

  // Мітки режисерів + жанрів + акторів — другим швидким викликом (до 50 id)
  const extra = new Set();
  for (const e of Object.values(ents)) {
    if (e.directorQid) extra.add(e.directorQid);
    for (const g of e.genreQids) extra.add(g);
    for (const a of e.actorQids || []) extra.add(a);
  }
  let labels = {};
  if (extra.size) {
    try { labels = await wdLabels([...extra]); } catch (e) { /* мітки не критичні */ }
  }

  // keepAll — явний запит за відомим QID (обрано користувачем): без фільтрів
  const keepAll = !!opts.keepAll;

  const map = {};
  for (const qid of qids) {
    const c = ents[qid];
    if (!c) continue;
    // Фільтр «це точно кіно/серіал»: IMDb ID, режисер, актори або (рік і жанр).
    // (у серіалів часто немає єдиного режисера P57, зате є актори P161)
    const filmLike = c.imdbId || c.directorQid ||
      (c.actorQids && c.actorQids.length) ||
      (c.year && c.genreQids.length);
    if (keepAll) {
      // без фільтрів
    } else if ((c.classes || []).some(cl => NOT_FILM_CLASSES.has(cl))) {
      const exactHit = nq && nq.length >= 3 && filmLike &&
        (nrm(c.labelEn) === nq || nrm(c.labelUk) === nq);
      if (!exactHit) continue; // сезон/книга/список — рятують лише точні збіги
    } else if (!filmLike) {
      continue;
    }

    const dirLab = c.directorQid ? (labels[c.directorQid] || {}) : {};
    // ДАНІ АНГЛІЙСЬКОЮ: режисер/жанри/актори — мітки en (fallback uk).
    // Укр. лишається лише НАЗВА (titleUk) — так домовилися з користувачем:
    // назва двомовна, решта інформації англійською.
    map[qid] = {
      titleUk: c.labelUk || null,
      titleEn: c.labelEn || null,
      imdbId: c.imdbId || null,
      director: dirLab.en || dirLab.uk || null,
      genres: c.genreQids.map(g => (labels[g] ? (labels[g].en || labels[g].uk) : null)).filter(Boolean).slice(0, 6),
      cast: (c.actorQids || []).map(a => (labels[a] ? (labels[a].en || labels[a].uk) : null)).filter(Boolean).slice(0, 6),
      runtime: c.runtime || null,
      year: c.year || null,
      premiere: c.premiere || null,
      ukWikiTitle: c.ukWikiTitle || null,
      enWikiTitle: c.enWikiTitle || null,
      classes: c.classes || []
    };
  }
  return { map, ok: true };
}

// ---------- Дрібні хелпери ----------

function cleanThumb(src) {
  return src ? String(src).replace(/\?utm_source=.*$/, '') : null;
}

// Рік із вступного тексту статті. Формати:
//   uk: «...фільм 1994 року», «...вийшов у 2025 році»;
//   en: "is a 2025 American…", "premiered on October 3, 2025",
//       "released on 3 October 2025"
// (дата прем'єри часто стоїть далі 200-го символу — беремо 400)
const EN_MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
function yearFromExtract(text) {
  const s = String(text || '');
  const head = s.slice(0, 400);
  let m = head.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\s*(року|році)/);
  if (m) return parseInt(m[1], 10);
  m = head.match(new RegExp(`\\b(?:${EN_MONTHS})\\s+\\d{1,2},\\s*(\\d{4})\\b`));
  if (m) return parseInt(m[1], 10);
  m = head.match(new RegExp(`\\b\\d{1,2}\\s+(?:${EN_MONTHS})\\s+(\\d{4})\\b`));
  if (m) return parseInt(m[1], 10);
  // «X is a 2025 American…» / «… is a 2025 … television miniseries»
  m = head.match(/\b(?:is|was)\s+(?:an|a)?\s*(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  // Рік може стояти далеко у вступі («Upon its premiere on October 3,
  // 2025…», «Прем'єра відбулася 3 жовтня 2025…») — шукаємо РІК ПОБЛИЗУ
  // слів прем'єри/виходу у ширшому фрагменті (до 1200 знаків), щоб не
  // чіпати випадкові роки (напр., роки народження акторів).
  m = s.slice(0, 1200).match(
    /(?:premier\w*|release[ds]?|debuted?|прем['’ʼ]?єр\w*|вийшл[ао]|реліз)[^.\n]{0,140}?\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/i);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1888 && y <= 2100) return y;
  }
  return null;
}

// «... (англ. The Shawshank Redemption, досл. ...)» -> оригінальна назва
function origTitleFromExtract(text) {
  const m = String(text || '').match(/\(англ\.?\s*([^),;.]+)/);
  return m ? m[1].trim() : null;
}

// Суфікс назв вікі-статей у дужках: «Creep (2004 film)», «Кріп (фільм, 2004)»,
// «2012 (film)», «Кріп (фільм)». Прибираємо хвіст і витягаємо звідти рік —
// у полях назв має лишатися чиста назва фільму, а не службове уточнення
// статті. Обидва формати (рік до/після слова типу) і голі типи без року.
// Дужки всередині назви не чіпаємо («Birdman or (The Unexpected Virtue
// of Ignorance)» лишається як є — хвіст шукаємо лише в кінці).
const WIKI_PAREN_TYPES = 'film|movie|short film|TV series|television series|miniseries|TV movie|television film|web series|фільм|серіал|телесеріал|телефільм|мультфільм|мультсеріал|анімаційний фільм';
const WIKI_TITLE_PAREN_RE = new RegExp(
  '^(.{2,}?)\\s*\\((?:[^)]*?\\b(\\d{4})\\b[^)]*|' + WIKI_PAREN_TYPES + ')\\)$', 'i');

export function cleanWikiTitle(t) {
  const s = String(t || '').trim();
  const m = s.match(WIKI_TITLE_PAREN_RE);
  if (!m) return { title: s, year: null };
  return { title: m[1].trim(), year: m[2] ? parseInt(m[2], 10) : null };
}

function truncPlot(s) {
  s = String(s || '').trim();
  return s.length > 700 ? s.slice(0, 697).trimEnd() + '…' : (s || null);
}

// Евристика «схоже на фільм» за вступним текстом статті — для сторінок
// БЕЗ сутності Вікіданих (вони не проходять P31-фільтр) та коли Wikidata
// недоступна. Двомовна: uk + en (en.Вікіпедія дає більшість результатів).
const FILM_WORDS = /фільм|серіал|мультфільм|короткометражк|анімаційн|телевізійн|\bfilm\b|\bmovie\b|\bseries\b|\btelevision\b|\bminiseries\b|\bmini-series\b|\bdocumentary\b|\bsitcom\b|\banthology\b/i;
const NOT_FILM_WORDS = /\b(актор|акторка|режисер|письменник|сценарист|повість|роман|оповідання|книга|п'єса|альбом|співак|співачка|музикант|художник|футболіст)\b|\b(actor|actress|director|writer|screenwriter|novel|novella|book|play|album|singer|musician|band|painter|footballer|biography|memoir|short story)\b/i;

function looksLikeFilmByExtract(text) {
  const head = String(text || '').slice(0, 250);
  if (!head) return true; // без тексту — не судимо
  return FILM_WORDS.test(head) && !NOT_FILM_WORDS.test(head);
}

// ---------- Збір елементів зі сторінок (з Wikidata-фільтром) ----------

// thumbs: спільна між пакетами мапа "QID або назва -> мініатюра".
// Сторінки-дублікати (та сама стаття в uk/en розділі) відкидаються,
// АЛЕ їхні мініатюри зберігаються тут: якщо в першого пакета мініатюри
// не було, а в дубліката-статті (інший розділ вікі) — є, постер
// "перетікає" з дубліката.
async function collectItems(pages, seen, thumbs, rescueQuery = '') {
  // дедуплікація за QID або назвою (seen — спільний між розділами Вікіпедії)
  pages = pages.filter(p => {
    const qid = p.pageprops && p.pageprops.wikibase_item;
    const key = qid || ('t:' + String(p.title || '').toLowerCase());
    const thumb = p.thumbnail && p.thumbnail.source;
    if (seen.has(key)) {
      // дублікат: як у першої сторінки не було мініатюри — забираємо з цього дубліката
      if (thumb && thumbs.get(key) == null) thumbs.set(key, thumb);
      return false;
    }
    seen.add(key);
    thumbs.set(key, thumb || null);
    return true;
  });
  if (!pages.length) return [];

  const qids = pages.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
  const { map: wd, ok: wdOk } = await wikidataByQids(qids, { rescueQuery });

  const items = [];
  for (const p of pages) {
    const qid = (p.pageprops && p.pageprops.wikibase_item) || null;
    const key = qid || ('t:' + String(p.title || '').toLowerCase());
    const e = qid ? (wd[qid] || null) : null;

    if (qid && wdOk && !e) continue; // точна вікі-сутність — і це не фільм
    // Сторінка без підтвердженої Вікіданими фільмової сутності (без QID
    // або Wikidata недоступна) — лишаємо лише якщо за вступом схоже на
    // фільм/серіал. Без цього книги й статті про людей без сутності
    // Вікіданих просочувалися у підказки (напр., книга «…Making of
    // Charley Varrick»).
    if (!(qid && wdOk && e) && !looksLikeFilmByExtract(p.extract)) continue;

    let titleUk = p._lang === 'uk'
      ? (e && e.titleUk) || p.title
      : (e && e.titleUk) || null;
    // укр. назва теж буває статтєвою («Кріп (фільм, 2004)») — чистимо хвіст
    if (titleUk) {
      const cUk = cleanWikiTitle(titleUk);
      if (cUk.title) titleUk = cUk.title;
    }
    const origTitle = p._lang === 'en'
      ? p.title
      : ((e && e.titleEn) || origTitleFromExtract(p.extract) || null);
    let title = origTitle || titleUk || p.title;
    if (!title) continue;
    // Рік: спершу Вікідані, потім вступний текст статті
    let year = (e && e.year) || yearFromExtract(p.extract);
    // Назви статей виду «Creep (2004 film)» / «Кріп (фільм, 2004)»: прибираємо
    // дужковий хвіст і витягаємо з нього рік — підказка показує чисту назву
    // («Creep · 2004»), зливається з IMDb-дублікатом, а в поле «Оригінальна
    // назва» потрапляє саме назва фільму, а не уточнення статті вікі
    const cT = cleanWikiTitle(title);
    if (cT.title) title = cT.title;
    if (year == null && cT.year) year = cT.year;

    // мініатюра сторінки або з дубліката-статті того ж фільму (інший розділ)
    const poster = cleanThumb(p.thumbnail && p.thumbnail.source) || cleanThumb(thumbs.get(key));
    const plot = truncPlot(p.extract);

    // Стаття без QID і без змістовних даних — не пропозиція
    if (!qid && !plot && !poster) continue;

    // Підпис типу для підказок: серіал / ТВ-фільм (класи Вікіданих).
    // Q3464665 (сезон серіалу) теж показуємо як серіал: «Monster: The
    // Ed Gein Story» у Вікіданнах — саме сезон антології «Monster».
    const cl = (e && e.classes) || [];
    const type = cl.includes('Q5398426') || cl.includes('Q3464665') ? 'tvSeries' // television series / season
      : cl.includes('Q506240') ? 'tvMovie'              // television film
      : 'movie';

    items.push({
      imdbId: (e && e.imdbId) || null,
      qid,
      title,
      titleUk: titleUk || null,
      year,
      premiere: (e && e.premiere) || null,
      poster,
      type,
      source: 'wiki',
      // Точна назва статті en.Вікіпедії — за нею posterQuick швидко
      // добирає мініатюру, якщо POSTER не прийшов одразу
      enWikiTitle: (e && e.enWikiTitle) || (p._lang === 'en' ? p.title : null),
      director: (e && e.director) || null,
      genres: (e && e.genres) || [],
      cast: (e && e.cast) || [],
      runtime: (e && e.runtime) || null,
      plot
    });
  }
  return items;
}

// ---------- Головна функція пошуку ----------
//
// Прогресивна видача (якомога швидший перший малюнок):
//   1) префіксний пошук мовою запиту — найлегший запит, малюється першим;
//   2) повнотекстовий пошук мовою запиту + другою мовою — паралельно,
//      добирають глибину, коли відповідять.
// Кожен готовий пакет одразу йде в callback onPartial. Фінальний
// список — злиття всіх пакетів без дублікатів (спільний seen + назви).

function dedupeItems(items) {
  const out = [];
  const idx = new Map(); // нормалізована назва -> [позиції в out]
  const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const reg = (t, pos) => {
    if (!t) return;
    const arr = idx.get(t);
    if (arr) { if (!arr.includes(pos)) arr.push(pos); }
    else idx.set(t, [pos]);
  };
  for (const it of items) {
    // два ключі: оригінальна назва + укр. назва («Інтерстеллар» і
    // "Interstellar" — та сама стаття, просто з різних розділів вікі)
    const k = norm(it.title);
    const ku = norm(it.titleUk);
    const y = it.year != null ? Number(it.year) : null;
    // однакова назва + РІЗНІ роки = різні фільми («Creep» 2004 ≠ «Creep» 2014):
    // зливаємо лише «той самий рік» або «запис без року» — інакше після
    // витягування року з назв («Creep (2004 film)» -> «Creep» + 2004)
    // різні однойменні фільми злилися б в один рядок
    const findAt = t => {
      if (!t) return undefined;
      const positions = idx.get(t);
      if (!positions || !positions.length) return undefined;
      if (y != null) {
        const same = positions.find(p => Number(out[p].year) === y);
        if (same !== undefined) return same;
        return positions.find(p => out[p].year == null);
      }
      return positions[0];
    };
    let at = findAt(k);
    if (at === undefined) at = findAt(ku);
    if (at !== undefined) {
      // дублікат назви: доповнюємо перший елемент тим, що є в другому
      const keep = out[at];
      for (const f of ['poster', 'plot', 'year', 'premiere', 'director', 'runtime', 'imdbId', 'qid', 'enWikiTitle']) {
        if (keep[f] == null && it[f] != null) keep[f] = it[f];
      }
      if ((!keep.genres || !keep.genres.length) && it.genres && it.genres.length) keep.genres = it.genres;
      if ((!keep.cast || !keep.cast.length) && it.cast && it.cast.length) keep.cast = it.cast;
      reg(k, at);
      reg(ku, at);
      continue;
    }
    const pos = out.length;
    reg(k, pos);
    reg(ku, pos);
    out.push(it);
  }
  return out;
}

export async function searchWikiFilms(query, onPartial, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const hasCyrillic = /[а-яіїєґ]/i.test(q);
  // opts.langs — явне обмеження розділів (транслітераційний fallback
  // шукає лише в en.Вікіпедії, щоб не витрачати запити на uk/ru)
  const langs = (opts && opts.langs) || (hasCyrillic ? ['uk', 'en'] : ['en', 'uk']);
  // opts.textQuery — запит для ПОВНОТЕКСТОВОГО пошуку (може включати рік:
  // «creep 2004» знаходить «Creep (2004 film)», якої немає у топ-10 видачі
  // за голою назвою). Префіксний пошук завжди лишається за голою назвою.
  const qText = String((opts && opts.textQuery) || '').trim() || q;

  const seen = new Set();    // спільна дедуплікація QID/назв між пакетами
  const thumbs = new Map(); // ключ -> мініатюра (у т.ч. з дублікатів)
  const all = [];

  const emit = (batch) => {
    if (!batch.length) return;
    all.push(...batch);
    const merged = dedupeItems(all).slice(0, 12);
    if (typeof onPartial === 'function' && merged.length) onPartial(merged);
  };

  const runLang = async (lang, { prefix = false } = {}) => {
    let pages = [];
    try {
      pages = prefix ? await wikiPrefix(lang, q) : await wikiSearch(lang, qText);
    } catch (e) { return; }
    let batch = [];
    try { batch = await collectItems(pages.slice(0, prefix ? 6 : 10), seen, thumbs, q); } catch (e) { return; }
    emit(batch);
  };

  const tasks = [runLang(langs[0], { prefix: true }), runLang(langs[0])];
  if (langs[1] && langs[1] !== langs[0]) tasks.push(runLang(langs[1]));
  await Promise.allSettled(tasks);

  const final = dedupeItems(all).slice(0, 12);
  // Фінальне заповнення постерів: мініатюра могла прийти пізніше
  // зі сторінки-дубліката (та сама стаття в іншому розділі Вікіпедії)
  for (const it of final) {
    if (!it.poster) {
      const key = it.qid || ('t:' + String(it.title || '').toLowerCase());
      const t = thumbs.get(key);
      if (t) it.poster = cleanThumb(t);
    }
  }
  return final;
}

// ---------- Добір даних за QID (коли фільм обрано з Вікіпедії) ----------

export async function enrichByQid(qid) {
  if (!qid || !/^Q\d+$/.test(qid)) return {};
  // keepAll: QID тут відомий точно (фільм обрано користувачем або знайдено
  // за IMDb ID) — фільтри «сезон/книга» не застосовуємо, інакше
  // легітимні сезони-серіали («Monster: The Ed Gein Story») втрачали б дані.
  const { map: wd } = await wikidataByQids([qid], { keepAll: true });
  const e = wd[qid];
  if (!e) return {};
  return {
    titleUk: e.titleUk || null,
    title: e.titleEn || null,
    imdbId: e.imdbId || null,
    director: e.director || null,
    genres: e.genres || [],
    cast: e.cast || [],
    runtime: e.runtime || null,
    year: e.year || null,
    premiere: e.premiere || null,
    ukWikiTitle: e.ukWikiTitle || null,
    enWikiTitle: e.enWikiTitle || null
  };
}

// QID за IMDb ID (P345) — швидкий wbsearch, найнадійніший місток між джерелами
export async function qidByImdbId(tt) {
  if (!tt || !/^tt\d+$/.test(String(tt))) return null;
  try {
    const sr = await fetchJSON(`${WD_API}?action=query&format=json&list=search&srlimit=1` +
      `&srsearch=${encodeURIComponent('haswbstatement:P345=' + tt)}`, 5000);
    const found = sr && sr.query && sr.query.search && sr.query.search[0] && sr.query.search[0].title;
    return (found && /^Q\d+$/.test(found)) ? found : null;
  } catch (e) { return null; }
}

// ============================================================
// Пошук постера для фільму, доданого без нього (fetchPoster).
// Ланцюжок (перший успішний крок перемагає):
//   1) IMDb Suggestion API за tt-ID — миттєво і точно, якщо відомий ID;
//   2) Wikidata: QID за P345 -> sitelinks (en/uk/ru вікі) -> pageimages;
//   3) TVMaze — серіали й шоу (швидке безкоштовне API з відкритим CORS);
//   4) Wikidata P18 (кадр/фото, пов'язане саме з цим фільмом);
//   5) Пошук сторінки en/uk/ru Вікіпедії з перевіркою року (щоб не
//      чіпати однойменні книги/старі фільми) — en.ПЕРШОЮ, бо стаття
//      там є майже про все, а з pilicense=any є і постер.
// ============================================================

// TVMaze: безкоштовне API бази серіалів із відкритим CORS.
// Добре знає серіали й шоу (з повною датою прем'єри), яких немає
// ані в Wikidata (P577 порожній), ані в IMDb suggestion.

// Спільний пошук шоу: точний за IMDb ID -> за назвою -> за роком ±1.
async function tvmazeFindShow(title, imdbId, year) {
  const q = String(title || '').trim();
  if (!q && !imdbId) return null;
  const data = await fetchJSON('https://api.tvmaze.com/search/shows?q=' +
    encodeURIComponent(q || imdbId), 4500);
  const shows = (Array.isArray(data) ? data : []).map(x => x && x.show).filter(Boolean);
  if (!shows.length) return null;

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]/g, '');
  const tq = norm(title);

  // 1) точний збіг за IMDb ID (надійно)
  if (imdbId) {
    const hit = shows.find(s => s.externals && s.externals.imdb === imdbId);
    if (hit) return hit;
  }
  // 2) назва збігається дослівно (нормалізовано)
  if (tq) {
    const hit = shows.find(s => norm(s.name) === tq);
    if (hit) return hit;
  }
  // 3) рік прем'єри ±1 і схожа назва
  if (tq && year) {
    const hit = shows.find(s => {
      if (!s.premiered) return false;
      const y = parseInt(String(s.premiered).slice(0, 4), 10);
      const sn = norm(s.name);
      return !Number.isNaN(y) && Math.abs(y - year) <= 1 &&
        (sn.includes(tq) || tq.includes(sn));
    });
    if (hit) return hit;
  }
  // 4) єдиний результат (назва скоріш за все точна)
  return shows.length === 1 ? shows[0] : null;
}

async function tvmazePoster(title, imdbId, year) {
  try {
    const hit = await tvmazeFindShow(title, imdbId, year);
    return hit && hit.image && hit.image.original ? cleanThumb(hit.image.original) : null;
  } catch (e) { return null; }
}

// Прем'єра серіалу/шоу: ПОВНА дата виходу («2007-09-24») + рік.
// TVMaze — єдине швидке джерело, де вона майже завжди є: у Wikidata
// P577 у серіалів часто порожній, а IMDb suggestion віддає лише рік.
export async function premiereInfo({ imdbId, title, titleUk, year } = {}) {
  const tt = (imdbId && /^tt\d+$/.test(String(imdbId))) ? imdbId : null;
  try {
    let hit = await tvmazeFindShow(title || titleUk, tt, year);
    if (!hit && titleUk && title && titleUk !== title) {
      hit = await tvmazeFindShow(titleUk, tt, year);
    }
    if (!hit || !hit.premiered) return null;
    const date = String(hit.premiered);
    const y = parseInt(date.slice(0, 4), 10);
    if (Number.isNaN(y) || y < 1888 || y > 2100) return null;
    return {
      year: y,
      date,
      name: hit.name || null,
      // TVMaze знає правильний IMDb ID навіть тоді, коли у Вікіданнах
      // записано помилковий (антологія-сезон) — використовуємо як rescue
      imdbId: (hit.externals && hit.externals.imdb) || null
    };
  } catch (e) { return null; }
}

// OMDb (лише якщо в config.js вставлено безкоштовний ключ) —
// надійне джерело постерів: точний збіг за IMDb ID або назва+рік
async function omdbPoster({ imdbId, title, year }) {
  if (!OMDB_API_KEY) return null;
  try {
    const params = new URLSearchParams({ apikey: OMDB_API_KEY });
    if (imdbId && /^tt\d+$/.test(String(imdbId))) params.set('i', String(imdbId));
    else {
      if (!title) return null;
      params.set('t', String(title));
      if (year) params.set('y', String(year));
    }
    const d = await fetchJSON('https://www.omdbapi.com/?' + params.toString(), 5000);
    if (d && d.Response !== 'False' && d.Poster && d.Poster !== 'N/A') {
      return cleanThumb(d.Poster);
    }
  } catch (e) { /* OMDb не критичний */ }
  return null;
}

export async function fetchPoster({ imdbId, title, titleUk, year } = {}) {
  const tt = (imdbId && /^tt\d+$/.test(String(imdbId))) ? imdbId : null;
  let qid = null;

  // 1) IMDb за tt-ID — найточніше і найшвидше
  if (tt) {
    const urls = [
      `https://v3.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json?includeVideos=0`,
      `https://v2.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json`
    ];
    for (const url of urls) {
      try {
        const data = await fetchJSON(url, 4000);
        const hit = ((data && data.d) || []).find(x => x && x.id === tt && x.i && x.i.imageUrl);
        if (hit) return hit.i.imageUrl;
      } catch (e) { /* наступне дзеркало */ }
    }
  }

  // 2) Wikidata: IMDb ID -> QID -> sitelinks (en/uk/ru) -> pageimages
  if (tt) {
    try {
      qid = await qidByImdbId(tt);
      if (qid) {
        const poster = await posterFromSitelinks(qid);
        if (poster) return poster;
      }
    } catch (e) { /* далі інші джерела */ }
  }

  // 3) TVMaze — серіали та шоу (і коли IMDb ID невідомий — за назвою)
  if (title || tt) {
    const tv = await tvmazePoster(title, tt, year);
    if (tv) return tv;
  }

  // 4) Останній шанс у Wikidata: зображення P18 (кадр/фото)
  if (qid) {
    const p18 = await posterP18(qid);
    if (p18) return p18;
  }

  // 4.5) OMDb (якщо є ключ у config.js) — постери, яких немає ніде вище
  const om = await omdbPoster({ imdbId: tt, title, year });
  if (om) return om;

  // 5) Пошук за назвою (з перевіркою року, щоб не взяти постер
  //    однойменного старого фільму чи книги). en.Вікіпедія першою —
  //    стаття там є майже про кожен фільм, користувач просив саме її.
  const wikiPosterSearch = async (lang, query) => {
    try {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
        `&generator=search&gsrlimit=4&gsrsearch=${encodeURIComponent(query)}` +
        '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
        '&piprop=thumbnail&pithumbsize=500&pilicense=any';
      const data = await fetchJSON(url, 5000);
      const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
      pages.sort((a, b) => (a.index || 999) - (b.index || 999));
      for (const p of pages) {
        if (!(p.thumbnail && p.thumbnail.source)) continue;
        // сторінка має бути про фільм/серіал, а не про однойменну річ
        if (p.pageprops && p.pageprops.disambiguation !== undefined) continue;
        if (!looksLikeFilmByExtract(p.extract)) continue;
        if (!yearMatchesPage(p, year)) continue;
        return cleanThumb(p.thumbnail.source);
      }
    } catch (e) { /* тихо */ }
    return null;
  };

  if (title) {
    const t = await wikiPosterSearch('en', title)
      || (year ? await wikiPosterSearch('en', `${title} ${year}`) : null)
      || (titleUk
        ? ((year ? await wikiPosterSearch('uk', `${titleUk} ${year}`) : null)
          || await wikiPosterSearch('uk', titleUk))
        : null)
      || await wikiPosterSearch('ru', title);
    if (t) return t;
  }
  return null;
}

// Сторінка відповідає року? Без року — довіряємо лише точній назві.
function yearMatchesPage(page, year) {
  if (!year) {
    // без року перевіряти нічим — пропускаємо лише якщо назва статті
    // точно збігається з пошуковим запитом (перевірка зверху)
    return true;
  }
  const t = String(page.title || '');
  if (t.includes(String(year))) return true;
  const ex = String(page.extract || '').slice(0, 250);
  return new RegExp(`\\b${year}\\b\\s*року`).test(ex) || new RegExp(`\\b${year}\\b`).test(ex.slice(0, 120));
}

// Мініатюра за QID: sitelinks enwiki/ukwiki/ruwiki -> pageimages + P18 в кінці.
// en.Вікіпедія — ПЕРША: стаття там є майже про кожен фільм/серіал, а з
// pilicense=any віддає і fair-use постери. pilicense=any ОБОВ'ЯЗКОВИЙ:
// дефолтний фільтр «free» ховає некомерційні постери (див. коментар зверху).
export async function posterFromSitelinks(qid) {
  try {
    const data = await fetchJSON(`${WD_API}?action=wbgetentities&format=json&origin=*` +
      `&props=sitelinks%7Cclaims&ids=${encodeURIComponent(qid)}`, 5000);
    const ent = data && data.entities && data.entities[qid];
    if (!ent) return null;
    const sl = ent.sitelinks || {};
    const tries = [];
    if (sl.enwiki && sl.enwiki.title) tries.push({ lang: 'en', title: sl.enwiki.title });
    if (sl.ukwiki && sl.ukwiki.title) tries.push({ lang: 'uk', title: sl.ukwiki.title });
    if (sl.ruwiki && sl.ruwiki.title) tries.push({ lang: 'ru', title: sl.ruwiki.title });
    for (const t of tries) {
      try {
        const url = `https://${t.lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
          `&titles=${encodeURIComponent(t.title)}&prop=pageimages&piprop=thumbnail&pithumbsize=500&pilicense=any&redirects=1`;
        const d = await fetchJSON(url, 5000);
        const pages = d && d.query ? Object.values(d.query.pages || {}) : [];
        const p = pages.find(x => x.thumbnail && x.thumbnail.source);
        if (p) return cleanThumb(p.thumbnail.source);
      } catch (e) { /* наступний розділ */ }
    }
  } catch (e) { /* тихо */ }
  return null;
}

// Зображення P18 (кадр/фото, пов'язане саме з цим фільмом) — останній шанс
export async function posterP18(qid) {
  try {
    const data = await fetchJSON(`${WD_API}?action=wbgetclaims&format=json&origin=*` +
      `&property=P18&entity=${encodeURIComponent(qid)}`, 5000);
    const claims = (data && data.claims && data.claims.P18) || [];
    const p18 = claims
      .map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value)
      .filter(v => typeof v === 'string' && v)[0];
    if (p18) {
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18)}?width=500`;
    }
  } catch (e) { /* тихо */ }
  return null;
}

// Комбо (сумісність): sitelinks -> P18
export async function posterFromQid(qid) {
  return (await posterFromSitelinks(qid)) || (await posterP18(qid));
}

// ============================================================
// Швидкий постер для ПІДКАЗОК (posterQuick) — тільки легкі джерела,
// без повільних вікі-пошуків: en.Вікіпедія за точною назвою ->
// IMDb за tt-ID -> TVMaze за назвою.
// Викликається фоново для рядків підказок без зображення.
// ============================================================

// Мініатюра з en.Вікіпедії (легкий запит): 1) точна стаття за назвою
// (sitelink із Вікіданих або заголовок результату), 2) пошук із
// перевіркою року. pilicense=any ОБОВ'ЯЗКОВИЙ — дефолтний фільтр
// «free» ховає fair-use постери фільмів (саме через це en.вікі
// здавалася «розділом без постерів»). Обидва кроки перевіряють, що
// стаття дійсно про фільм/серіал: «Parasite» редиректить на біологічну
// статтю «Parasitism» — без перевірки підтягнувся б кадр паразита.
export async function enWikiThumb(title, year) {
  const t = String(title || '').trim();
  if (!t) return null;
  // Сторінка дійсно про фільм/серіал? (не значення, не біологія/книга…)
  const filmPage = p =>
    p.missing === undefined &&
    !(p.pageprops && p.pageprops.disambiguation !== undefined) &&
    looksLikeFilmByExtract(p.extract);

  // 1) точна назва статті (redirects=1 опрацьовує перенаправлення)
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
      '&titles=' + encodeURIComponent(t) + '&redirects=1' +
      '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
      '&piprop=thumbnail&pithumbsize=400&pilicense=any';
    const data = await fetchJSON(url, 4500);
    const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
    const p = pages.find(x => x.thumbnail && x.thumbnail.source && filmPage(x));
    if (p) return cleanThumb(p.thumbnail.source);
  } catch (e) { /* далі пошук */ }

  // 2) пошук за назвою (рік відсіює однойменні книги/старі фільми).
  // gsrlimit=6: видача пошуку нестабільна — за загальними назвами («Alien»)
  // дезамбігуляція/франшиза витісняють сам фільм з топ-2; guard'и нижче
  // (filmPage + yearMatchesPage) самі вибирають правильну статтю.
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
      '&generator=search&gsrlimit=6&gsrsearch=' + encodeURIComponent(t) +
      '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
      '&piprop=thumbnail&pithumbsize=400&pilicense=any';
    const data = await fetchJSON(url, 4500);
    const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
    pages.sort((a, b) => (a.index || 999) - (b.index || 999));
    for (const p of pages) {
      if (!(p.thumbnail && p.thumbnail.source)) continue;
      if (!filmPage(p)) continue;
      if (!yearMatchesPage(p, year)) continue;
      return cleanThumb(p.thumbnail.source);
    }
  } catch (e) { /* тихо */ }
  return null;
}

export async function posterQuick({ imdbId, title, enWikiTitle, qid, year } = {}) {
  const tt = (imdbId && /^tt\d+$/.test(String(imdbId))) ? imdbId : null;
  // 1) en.Вікіпедія за ТОЧНОЮ назвою статті з Вікіданих — один легкий
  // запит, зображення належить саме ЦІЙ статті. Для вікі-рядків це
  // важливо ще й безпечно: P345 у Вікіданнах буває помилковим
  // («Monster: The Ed Gein Story» має tt антології «Monster»), і
  // постер за таким tt — постер ІНШОГО фільму.
  if (enWikiTitle) {
    const u = await enWikiThumb(enWikiTitle, year);
    if (u) return u;
  }
  // 2) QID -> sitelinks (en -> uk -> ru): покриває рядки, відомі лише
  //    за укр. назвою («Касабланка» на en.вікі — "Casablanca (film)")
  if (qid && /^Q\d+$/.test(qid)) {
    const u = await posterFromSitelinks(qid);
    if (u) return u;
  }
  // 3) IMDb за tt-ID — миттєво і канонічно (для рядків із IMDb це перше
  // джерело, бо enWikiTitle/qid у них немає)
  if (tt) {
    const urls = [
      `https://v3.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json?includeVideos=0`,
      `https://v2.sg.media-imdb.com/suggestion/t/${encodeURIComponent(tt)}.json`
    ];
    for (const url of urls) {
      try {
        const data = await fetchJSON(url, 4000);
        const hit = ((data && data.d) || []).find(x => x && x.id === tt && x.i && x.i.imageUrl);
        if (hit) return hit.i.imageUrl;
      } catch (e) { /* наступне дзеркало */ }
    }
  }
  // 4) назва рядка підказки (en або uk) — точна стаття або пошук en.вікі
  const wiki = title ? await enWikiThumb(title, year) : null;
  if (wiki) return wiki;
  if (title) return (await tvmazePoster(title, tt, year)) || omdbPoster({ title, year });
  return omdbPoster({ imdbId: tt, year });
}
