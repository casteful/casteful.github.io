// ============================================================
// Пошук ігор для автозаповнення — прямо з Вікіпедії та Вікіданих
// (без жодних ключів: IGDB вимагає Twitch OAuth, RAWG — API-ключ,
// а вікі відкриті для всіх; бокс-арт чіпляється з мініатюри статті).
//
//   searchGames(q, onPartial) — швидкі підказки: uk.вікі (префікс +
//     повнотекст) → en.вікі; бали за P31=Q7889 і «(відеогра)» в назві.
//   enrichGame({ qid, title, year }) — деталі з Вікіданих:
//     рік (P577), розробник (P178), видавець (P123), жанри (P136),
//     платформи (P400), обкладинка (P18 / мініатюра статті), сюжет
//     з uk/en статті; укр. назва — з мітки/статті або автопереклад.
// ============================================================

import * as U from './utils.js?v=6.4.1';
import { translateToUk } from './translate.js?v=6.4.1';

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

// ---------- Вікіпедія: пошук статей ----------

async function wikiSearch(lang, query, limit = 10) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    // pilicense=any: en.вікі віддає fair-use бокс-арт ігор
    '&piprop=thumbnail&pithumbsize=400&pilicense=any';
  const data = await fetchJSON(url, 6000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

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

// ---------- Вікідані: твердження ігор одним викликом ----------

export const GAME_CLASS = 'Q7889'; // відеогра

// Не-ігрові класи: ігри з ними опускаються вниз видачі
const NOT_GAME_CLASSES = new Set([
  'Q11424',    // фільм
  'Q24856',    // серія фільмів
  'Q5398426',  // телесеріал
  'Q21191270', // епізод телесеріалу
  'Q3464665',  // сезон телесеріалу
  'Q482994',   // музичний альбом
  'Q7366',     // пісня
  'Q571',      // книга
  'Q8261',     // роман
  'Q5',        // людина
  'Q43229',    // організація
  'Q13406463', // список статей
  'Q17329259', // енциклопедична стаття
  'Q191067'    // стаття
]);

async function wdGameEntities(qids) {
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
    const e = {
      classes: [],
      genreQids: [], platformQids: [], devQids: [], pubQids: []
    };
    e.ukWikiTitle = (sitelinks.ukwiki && sitelinks.ukwiki.title) || null;
    e.enWikiTitle = (sitelinks.enwiki && sitelinks.enwiki.title) || null;

    for (const c of claims.P31 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.classes.push(v.id);
    }
    // Рік випуску (P577): найраніша дата
    for (const c of claims.P577 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const t = v && v.time ? String(v.time) : '';
      const y = t ? parseInt(t.slice(1, 5), 10) : NaN;
      if (!Number.isNaN(y) && y >= 1958 && y <= 2100 && (e.year == null || y < e.year)) e.year = y;
    }
    // Розробник (P178) / видавець (P123)
    for (const c of claims.P178 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.devQids.length < 3) e.devQids.push(v.id);
    }
    for (const c of claims.P123 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.pubQids.length < 2) e.pubQids.push(v.id);
    }
    // Жанри (P136) / платформи (P400)
    for (const c of claims.P136 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.genreQids.push(v.id);
    }
    for (const c of claims.P400 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.platformQids.length < 8) e.platformQids.push(v.id);
    }
    // Обкладинка з Вікісховища (P18) — ім'я файлу
    for (const c of claims.P18 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (typeof v === 'string' && !e.imageFile) e.imageFile = v;
    }
    e.labelUk = (labels.uk && labels.uk.value) || null;
    e.labelEn = (labels.en && labels.en.value) || null;
    out[qid] = e;
  }
  return out;
}

// Мітки uk/en для розробників/видавців/жанрів/платформ одним викликом
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

const label = (m, qid) => {
  const l = m[qid];
  return (l && (l.uk || l.en)) || null;
};

// Мініатюра з Вікісховища за ім'ям файлу P18
function commonsThumb(file, width = 400) {
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;
}

// Рік з перших речень статті («…відеогра 2015 року…», «… 2015 video game …»)
function yearFromExtract(text) {
  const m = String(text || '').slice(0, 300).match(/(19[89]\d|20\d\d)/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return (y >= 1958 && y <= 2100) ? y : null;
}

function truncPlot(s) {
  s = String(s || '').trim();
  return s.length > 700 ? s.slice(0, 697).trimEnd() + '…' : (s || null);
}

function wikiUrl(lang, title) {
  if (!title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

// ---------- Пошук підказок ----------

// «clair obscur 33» → елементи { title, titleUk, year, cover, plot, qid,
// developer, publisher, platforms, genres, enWikiTitle, ukWikiTitle, source:'wiki' }
export async function searchGames(query, onPartial, opts = {}) {
  const langs = opts.langs || ['uk', 'en'];
  const normQ = String(query || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const seenPages = new Set();   // назва статті нижнім регістром
  const items = [];
  const paint = () => { if (typeof onPartial === 'function' && items.length) onPartial([...items]); };

  const pushPages = async (pages) => {
    const fresh = pages.filter(p => {
      const key = `${p._lang}:${String(p.title || '').toLowerCase()}`;
      if (!p.title || seenPages.has(key)) return false;
      seenPages.add(key);
      return true;
    });
    if (!fresh.length) return;

    // QID із pageprops → твердження Вікіданих одним пакетом
    const qids = fresh.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
    let ents = {};
    try { ents = await wdGameEntities(qids); } catch (e) { /* вікі недоступні — лишається базове */ }

    for (const p of fresh) {
      const qid = (p.pageprops && p.pageprops.wikibase_item) || null;
      const ent = qid ? ents[qid] : null;
      const title = p._lang === 'uk' ? null : p.title;
      const titleUk = p._lang === 'uk' ? p.title : null;
      const extract = String(p.extract || '');
      let score = 0;
      if (ent) {
        if (ent.classes.includes(GAME_CLASS)) score += 4;
        if (ent.classes.some(c => NOT_GAME_CLASSES.has(c))) score -= 4;
        if (ent.year != null) score += 1;
      }
      if (/\((відеогра|video game)\)/i.test(p.title)) score += 3;
      if (/(відеогра|комп['ʼ]ютерна гра|\bvideo game\b|\bvideo games\b|\bgameplay\b)/i.test(extract.slice(0, 250))) score += 1;
      if (normQ && U.normTitle(p.title).startsWith(normQ)) score += 1;

      const it = {
        title,
        titleUk,
        year: (ent && ent.year) || yearFromExtract(extract) || null,
        cover: (p.thumbnail && p.thumbnail.source) || null,
        plot: truncPlot(extract),
        qid,
        enWikiTitle: (ent && ent.enWikiTitle) || (p._lang === 'en' ? p.title : null),
        ukWikiTitle: (ent && ent.ukWikiTitle) || (p._lang === 'uk' ? p.title : null),
        wikiUrl: wikiUrl(p._lang, p.title),
        developer: null,
        publisher: null,
        platforms: [],
        genres: [],
        score,
        source: 'wiki'
      };
      items.push(it);
    }
    paint();
  };

  // М'який фільтр: прибираємо очевидні не-ігри (фільми/серії/людини),
  // об'єднуємо ту саму гру, знайдену в uk і en розділах (за QID —
  // як dedupeItems у фільмах), сортуємо за балом, точний збіг нагору
  const finalize = () => {
    let list = items.filter(it => it.score > -4);
    // Злиття за QID: бракуючі поля першого елемента добираються з другого
    const byQid = new Map();
    list.forEach((it) => {
      if (!it.qid) return;
      const prev = byQid.get(it.qid);
      if (prev) {
        for (const k of ['title', 'titleUk', 'year', 'cover', 'plot', 'developer', 'publisher', 'wikiUrl', 'ukWikiTitle', 'enWikiTitle']) {
          if (prev[k] == null && it[k] != null) prev[k] = it[k];
        }
        if ((!prev.genres || !prev.genres.length) && it.genres && it.genres.length) prev.genres = it.genres;
        if ((!prev.platforms || !prev.platforms.length) && it.platforms && it.platforms.length) prev.platforms = it.platforms;
        it._merged = true;
      } else {
        byQid.set(it.qid, it);
      }
    });
    list = list.filter(it => !it._merged);
    if (normQ && normQ.length >= 3) {
      const isExact = it =>
        U.normTitle(it.titleUk || it.title) === normQ || U.normTitle(it.title) === normQ;
      const exact = list.filter(isExact);
      if (exact.length && exact.length < list.length) list = exact.concat(list.filter(it => !isExact(it)));
    }
    return [...list].sort((a, b) => b.score - a.score).slice(0, 20);
  };

  // uk: спочатку швидкий префіксний, потім повнотекстовий
  for (const lang of langs) {
    try {
      await pushPages(await wikiPrefix(lang, query, 6));
    } catch (e) { /* цей розділ недоступний */ }
    try {
      await pushPages(await wikiSearch(lang, query, 10));
    } catch (e) { /* цей розділ недоступний */ }
    paint();
  }

  // Добираємо мітки Вікіданих (розробник/жанри/платформи) для підказок
  const withQ = items.filter(it => it.qid);
  if (withQ.length) {
    const ents2 = await wdGameEntities(withQ.map(it => it.qid).slice(0, 20)).catch(() => ({}));
    const labelQids = [];
    Object.values(ents2).forEach(e => {
      labelQids.push(...e.devQids, ...e.pubQids, ...e.genreQids.slice(0, 4), ...e.platformQids.slice(0, 6));
    });
    let lm = {};
    try { lm = await wdLabels([...new Set(labelQids)]); } catch (e) { /* без міток */ }
    withQ.forEach((it) => {
      const e = ents2[it.qid];
      if (!e) return;
      if (e.devQids.length) it.developer = label(lm, e.devQids[0]);
      if (e.pubQids.length) it.publisher = label(lm, e.pubQids[0]);
      it.genres = e.genreQids.map(g => label(lm, g)).filter(Boolean).slice(0, 5);
      it.platforms = e.platformQids.map(p => label(lm, p)).filter(Boolean).slice(0, 6);
      if (!it.titleUk && e.labelUk) it.titleUk = e.labelUk;
      if (!it.title && e.labelEn) it.title = e.labelEn;
      if (!it.year && e.year) it.year = e.year;
      if (!it.cover && e.imageFile) it.cover = commonsThumb(e.imageFile);
      if (e.ukWikiTitle) it.ukWikiTitle = e.ukWikiTitle;
      if (e.enWikiTitle) it.enWikiTitle = e.enWikiTitle;
    }); 
    paint();
  }

  return finalize();
}

// ---------- Повне збагачення обраної гри ----------

// Інтро статті uk/en Вікіпедії за точною назвою (сюжет + мініатюра)
async function wikiArticle(lang, title) {
  if (!title) return null;
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=400&pilicense=any` +
      `&redirects=1&titles=${encodeURIComponent(title)}`;
    const data = await fetchJSON(url, 6000);
    const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
    const p = pages[0];
    if (!p || p.missing != null) return null;
    return { extract: p.extract || '', thumb: (p.thumbnail && p.thumbnail.source) || null };
  } catch (e) {
    return null;
  }
}

export async function enrichGame({ qid, title, titleUk, year } = {}) {
  const out = {};

  let ent = null;
  if (qid) {
    try {
      const ents = await wdGameEntities([qid]);
      ent = ents[qid] || null;
    } catch (e) { /* без Вікіданих */ }
  }

  if (ent) {
    out.year = ent.year || null;
    // Розробник/видавець/жанри/платформи — мітки одним викликом
    const labelQids = [...ent.devQids, ...ent.pubQids, ...ent.genreQids.slice(0, 4), ...ent.platformQids.slice(0, 6)];
    let lm = {};
    try { lm = await wdLabels([...new Set(labelQids)]); } catch (e) { /* без міток */ }
    out.developer = ent.devQids.length ? label(lm, ent.devQids[0]) : null;
    out.publisher = ent.pubQids.length ? label(lm, ent.pubQids[0]) : null;
    out.genres = ent.genreQids.map(g => label(lm, g)).filter(Boolean).slice(0, 5);
    out.platforms = ent.platformQids.map(p => label(lm, p)).filter(Boolean).slice(0, 6);
    if (!out.titleUk && ent.labelUk) out.titleUk = ent.labelUk;
    if (!out.title && ent.labelEn) out.title = ent.labelEn;
    if (!out.cover && ent.imageFile) out.cover = commonsThumb(ent.imageFile);
    out.ukWikiTitle = ent.ukWikiTitle;
    out.enWikiTitle = ent.enWikiTitle;
  }

  // Сюжет: спершу українська стаття, за потреби — англійська
  const ukTitle = out.ukWikiTitle || (titleUk ? String(titleUk) : null);
  const uk = await wikiArticle('uk', ukTitle);
  if (uk) {
    if (!out.plot) out.plot = truncPlot(uk.extract);
    if (!out.cover && uk.thumb) out.cover = uk.thumb;
    if (!out.ukWikiTitle) out.ukWikiTitle = ukTitle;
  }
  if (!out.plot || !out.cover) {
    const enTitle = out.enWikiTitle || title || null;
    const en = await wikiArticle('en', enTitle);
    if (en) {
      if (!out.plot) out.plot = truncPlot(en.extract);
      if (!out.cover && en.thumb) out.cover = en.thumb;
      if (!out.enWikiTitle) out.enWikiTitle = enTitle;
    }
  }
  if (!out.plot && out.titleUk == null && out.ukWikiTitle == null && out.enWikiTitle == null && !out.cover && !out.year) {
    // взагалі нічого не знайшли — рік хоча б із запиту
    if (year) out.year = out.year || year;
  }

  out.wikiUrl = wikiUrl('uk', out.ukWikiTitle) || wikiUrl('en', out.enWikiTitle) || null;
  return out;
}

// Останній шанс для укр. назви — автопереклад (викликається з форми,
// коли після всіх джерел titleUk досі порожній)
export async function translateTitle(title) {
  if (!title) return null;
  try {
    const tr = await translateToUk(String(title).trim());
    if (tr && tr.toLowerCase() !== String(title).trim().toLowerCase()) return tr;
  } catch (e) { /* переклад не критичний */ }
  return null;
}
