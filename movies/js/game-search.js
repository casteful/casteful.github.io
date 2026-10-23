// ============================================================
// Пошук ігор через Вікіпедію + Вікідані (те саме джерело, що й
// у фільмів — «IMDb для ігор» не потрібен: en.Вікіпедія має
// статтю майже про кожну відеогру, а Вікідані — структуровані
// поля P178 (розробник), P400 (платформи), P136 (жанри),
// P577 (дата виходу) і fair-use обкладинки (pilicense=any).
//
// Пайплайн — брат-близнюк wiki.js для фільмів:
//   1) префіксний + повнотекстовий пошук статей (uk + en вікі)
//      -> назва, мініатюра (обкладинка), вступний текст, QID
//   2) wbgetentities: класи P31 + поля гри одним викликом
//   3) другим викликом — укр/англ мітки розробників, платформ
//      і жанрів (до 50 id за раз)
//   4) фільтр «це точно гра»: клас Q7889 (відеогра) АБО є
//      розробник/платформи; фільми, серіали, книги, альбоми,
//      франшизи й серії ігор відсіюються за класами
// Результати малюються поступово (onPartial), усе fail-safe.
// ============================================================

import * as U from './utils.js';

const WD_API = 'https://www.wikidata.org/w/api.php';
const MAX_RESULTS = 12;
const CACHE_MAX = 60;
const cache = new Map(); // ключ запиту -> Promise зі списком

async function fetchJSON(url, timeoutMs = 8000) {
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

// «Відьмак 3 2015» / «doom (2016)» -> { title, year }.
// Рік наприкінці запиту — побажання користувача, а не частина назви.
function splitQueryYear(q) {
  const s = String(q || '').trim();
  const m = s.match(/^(.{2,}?)\s*[\(\[]?(\d{4})[\)\]]?\s*$/);
  if (!m) return { title: s, year: null };
  const y = parseInt(m[2], 10);
  if (y < 1958 || y > 2100) return { title: s, year: null };
  return { title: m[1].trim().replace(/[\(\[]$/, '').trim(), year: y };
}

// ---------- Пошук статей у Вікіпедії ----------

async function wikiSearch(lang, query, limit = 10) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    // pilicense=any: fair-use обкладинки ігор без цього ховаються
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

// ---------- Вікідані: поля гри + класи ОДНИМ викликом ----------

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
    const e = { classes: [], developerQids: [], platformQids: [], genreQids: [] };

    e.ukWikiTitle = (sitelinks.ukwiki && sitelinks.ukwiki.title) || null;
    e.enWikiTitle = (sitelinks.enwiki && sitelinks.enwiki.title) || null;

    for (const c of claims.P31 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.classes.push(v.id);
    }
    // P178 — розробник (інколи їх двоє: студія + видавець-розробник)
    for (const c of claims.P178 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.developerQids.push(v.id);
    }
    // P400 — платформи (PC, PlayStation 5, Switch…)
    for (const c of claims.P400 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.platformQids.push(v.id);
    }
    for (const c of claims.P136 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.genreQids.push(v.id);
    }
    // P577 — дата виходу: найраніша дата і є «роком гри»
    for (const c of claims.P577 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const t = v && v.time ? String(v.time) : '';
      const y = t ? parseInt(t.slice(1, 5), 10) : NaN;
      if (!Number.isNaN(y) && y >= 1958 && y <= 2100 && (e.year == null || y < e.year)) e.year = y;
      if (v && v.precision === 11 && /^[-+]?\d{4}-\d{2}-\d{2}/.test(t)) {
        const iso = t.replace(/^[-+]?/, '').slice(0, 10);
        if (!e.premiere || iso < e.premiere) e.premiere = iso;
      }
    }
    e.labelUk = (labels.uk && labels.uk.value) || null;
    e.labelEn = (labels.en && labels.en.value) || null;
    out[qid] = e;
  }
  return out;
}

// Укр/англ мітки розробників, платформ і жанрів (до 50 id за виклик)
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

// ---------- Фільтр «це гра» ----------

// Не-ігрові сутності, які повнотекстовий пошук підіймає поряд з іграми
const NOT_GAME_CLASSES = new Set([
  'Q11424',    // фільм
  'Q5398426',  // телесеріал
  'Q506240',   // телевізійний фільм
  'Q15744398', // мінісеріал
  'Q3464665',  // сезон телесеріалу
  'Q21191270', // епізод телесеріалу
  'Q2485646',  // серія фільмів
  'Q7058673',  // серія відеоігор («Minecraft» — це гра, «Minecraft series» — ні)
  'Q25445348', // медіафраншиза
  'Q5',        // людина
  'Q571',      // книга
  'Q8261',     // роман
  'Q149838',   // повість
  'Q277759',   // серія книг
  'Q482994',   // музичний альбом
  'Q7366',     // пісня
  'Q134556',   // сингл
  'Q13406463', // список статей Вікімедіа
  'Q43229',    // організація
  'Q4830453',  // підприємство
  'Q191067',   // стаття
  'Q17329259', // енциклопедична стаття
  'Q3331189'   // видання
]);

// Евристика для сторінок БЕЗ сутності Вікіданих: схоже на гру за вступом
const GAME_WORDS = /відеогра|відеоігр|комп['’ʼ]ютерн\w* гра|консол|ігорн\w*|video game|videogame|action-adventure|role-playing|platform game|shooter|survival horror|sandbox game/i;
const NOT_GAME_WORDS = /\b(фільм|серіал|актор|акторка|режисер|письменник|альбом|співак|співачка|гурт|футболіст)\b|\b(film|movie|television series|tv series|actor|actress|director|writer|album|singer|band|novel)\b/i;

function looksLikeGameByExtract(text) {
  const head = String(text || '').slice(0, 250);
  if (!head) return true; // без тексту — не судимо
  return GAME_WORDS.test(head) && !NOT_GAME_WORDS.test(head);
}

// ---------- Дрібні хелпери ----------

function cleanThumb(src) {
  return src ? String(src).replace(/\?utm_source=.*$/, '') : null;
}

// Рік із вступного тексту (uk + en): «...відеогра 2011 року»,
// "released on November 18, 2011", "is a 2015 …video game"
const EN_MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
function yearFromExtract(text) {
  const s = String(text || '');
  const head = s.slice(0, 400);
  let m = head.match(/\b(19\d{2}|20\d{2}|21\d{2})\s*(року|році)/);
  if (m) return parseInt(m[1], 10);
  m = head.match(new RegExp(`\\b(?:${EN_MONTHS})\\s+\\d{1,2},\\s*(\\d{4})\\b`));
  if (m) return parseInt(m[1], 10);
  m = head.match(new RegExp(`\\b\\d{1,2}\\s+(?:${EN_MONTHS})\\s+(\\d{4})\\b`));
  if (m) return parseInt(m[1], 10);
  m = head.match(/\b(?:is|was)\s+(?:an|a)?\s*(19\d{2}|20\d{2}|21\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  m = s.slice(0, 1200).match(
    /(?:releas\w+|launch\w*|debuted?|вийшл[ао]|реліз|випуск\w*)[^.\n]{0,140}?\b(19\d{2}|20\d{2}|21\d{2})\b/i);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1958 && y <= 2100) return y;
  }
  return null;
}

// «The Witcher 3: Wild Hunt» / «Відьмак 3: Дике полювання» — чисті назви;
// службові хвости статей («… (video game)», «… (гра, 2015)») прибираємо
const PAREN_TYPES = 'video game|videogame|game|гра|відеогра|комп\'ютерна гра';
const TITLE_PAREN_RE = new RegExp(
  '^(.{2,}?)\\s*\\((?:[^)]*?\\b(\\d{4})\\b[^)]*|' + PAREN_TYPES + ')\\)$', 'i');

function cleanTitle(t) {
  const s = String(t || '').trim();
  const m = s.match(TITLE_PAREN_RE);
  if (!m) return { title: s, year: null };
  return { title: m[1].trim(), year: m[2] ? parseInt(m[2], 10) : null };
}

function truncPlot(s) {
  s = String(s || '').trim();
  return s.length > 700 ? s.slice(0, 697).trimEnd() + '…' : (s || null);
}

// «action role-playing game» -> «action role-playing»:
// суфікси « game»/« video game» у жанрах ігор — сміття з Вікіданих
function cleanGenreLabel(s) {
  return String(s || '').replace(/\s*(video\s+)?games?$/i, '').trim();
}

// ---------- Збір елементів зі сторінок (з Вікіданими) ----------

async function collectItems(pages, seen, thumbs, rescueQuery = '') {
  // дедуплікація за QID або назвою (спільна між розділами Вікіпедії)
  pages = pages.filter(p => {
    const qid = p.pageprops && p.pageprops.wikibase_item;
    const key = qid || ('t:' + String(p.title || '').toLowerCase());
    const thumb = p.thumbnail && p.thumbnail.source;
    if (seen.has(key)) {
      if (thumb && thumbs.get(key) == null) thumbs.set(key, thumb);
      return false;
    }
    seen.add(key);
    thumbs.set(key, thumb || null);
    return true;
  });
  if (!pages.length) return [];

  const qids = pages.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
  let ents = {};
  let wdOk = true;
  try { ents = await wdEntities(qids); } catch (e) { wdOk = false; }

  // Мітки розробників + платформ + жанрів — другим швидким викликом
  const extra = new Set();
  for (const e of Object.values(ents)) {
    for (const d of e.developerQids) extra.add(d);
    for (const p of e.platformQids) extra.add(p);
    for (const g of e.genreQids) extra.add(g);
  }
  let labels = {};
  if (extra.size) {
    try { labels = await wdLabels([...extra]); } catch (e) { /* мітки не критичні */ }
  }

  const nq = String(rescueQuery || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const nrm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');

  const items = [];
  for (const p of pages) {
    const qid = (p.pageprops && p.pageprops.wikibase_item) || null;
    const key = qid || ('t:' + String(p.title || '').toLowerCase());
    const e = qid ? (ents[qid] || null) : null;

    if (qid && wdOk && e) {
      const gameLike = (e.classes || []).includes('Q7889') || // відеогра
        (e.developerQids && e.developerQids.length) ||        // є розробник
        (e.platformQids && e.platformQids.length);            // є платформи
      const notGame = (e.classes || []).some(cl => NOT_GAME_CLASSES.has(cl));
      // Серії/франшизи/фільми відсіюємо; рятівний виняток — ДОСЛІВНИЙ
      // збіг назви із запитом (заглушка без P178/P400, але з даними)
      if (notGame) {
        const rescue = nq.length >= 3 && (nrm(e.labelEn) === nq || nrm(e.labelUk) === nq);
        if (!rescue) continue;
      } else if (!gameLike) {
        continue;
      }
    } else if (!(qid && wdOk && e)) {
      // Сторінка без Вікіданих (або Вікідані недоступні) — лишаємо
      // лише якщо за вступом схоже на гру
      if (!looksLikeGameByExtract(p.extract)) continue;
    }

    let titleUk = p._lang === 'uk'
      ? (e && e.labelUk) || p.title
      : (e && e.labelUk) || null;
    if (titleUk) {
      const cUk = cleanTitle(titleUk);
      if (cUk.title) titleUk = cUk.title;
    }
    const origTitle = p._lang === 'en'
      ? p.title
      : ((e && e.labelEn) || null);
    let title = origTitle || titleUk || p.title;
    if (!title) continue;
    let year = (e && e.year) || yearFromExtract(p.extract);
    const cT = cleanTitle(title);
    if (cT.title) title = cT.title;
    if (year == null && cT.year) year = cT.year;

    const poster = cleanThumb(p.thumbnail && p.thumbnail.source) || cleanThumb(thumbs.get(key));
    const plot = truncPlot(p.extract);
    if (!qid && !plot && !poster) continue;

    const lab = qid => (labels[qid] ? (labels[qid].en || labels[qid].uk) : null);
    items.push({
      qid,
      title,
      titleUk: titleUk || null,
      year: year != null ? year : null,
      poster,
      // розробник — рядок (перший заявлений); платформи/жанри — списки
      developer: (e && e.developerQids[0] && lab(e.developerQids[0])) || null,
      platforms: e ? e.platformQids.map(lab).filter(Boolean).slice(0, 8) : [],
      genres: e ? e.genreQids.map(lab).filter(Boolean).map(cleanGenreLabel).filter(Boolean).slice(0, 6) : [],
      plot,
      source: 'wiki'
    });
  }
  return items;
}

// ---------- Злиття без дублікатів ----------

function dedupeItems(items) {
  const out = [];
  const idx = new Map();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const reg = (t, pos) => {
    if (!t) return;
    const arr = idx.get(t);
    if (arr) { if (!arr.includes(pos)) arr.push(pos); }
    else idx.set(t, [pos]);
  };
  for (const it of items) {
    const k = norm(it.title);
    const ku = norm(it.titleUk);
    const y = it.year != null ? Number(it.year) : null;
    // однакова назва + різні роки = різні ігри («DOOM» 1993 ≠ «DOOM» 2016)
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
      const keep = out[at];
      for (const f of ['poster', 'plot', 'year', 'developer', 'qid']) {
        if (keep[f] == null && it[f] != null) keep[f] = it[f];
      }
      if ((!keep.platforms || !keep.platforms.length) && it.platforms && it.platforms.length) keep.platforms = it.platforms;
      if ((!keep.genres || !keep.genres.length) && it.genres && it.genres.length) keep.genres = it.genres;
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

// ---------- Головна функція пошуку ----------

export async function searchGames(query, onPartial) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const hasCyrillic = /[а-яіїєґ]/i.test(q);
  const langs = hasCyrillic ? ['uk', 'en'] : ['en', 'uk'];
  const { title: qTitle, year: qYear } = splitQueryYear(q);

  const seen = new Set();
  const thumbs = new Map();
  const all = [];

  const emit = (batch) => {
    if (!batch.length) return;
    all.push(...batch);
    const merged = dedupeItems(all).slice(0, MAX_RESULTS);
    if (typeof onPartial === 'function' && merged.length) onPartial(merged);
  };

  const runLang = async (lang, { prefix = false, text = null } = {}) => {
    let pages = [];
    try {
      pages = prefix ? await wikiPrefix(lang, qTitle) : await wikiSearch(lang, text || qTitle);
    } catch (e) { return; }
    let batch = [];
    try { batch = await collectItems(pages.slice(0, prefix ? 6 : 10), seen, thumbs, qTitle); } catch (e) { return; }
    emit(batch);
  };

  // Префіксний пошук основною мовою малюється першим, потім
  // повнотекстовий основною + другою мовою — паралельно
  const tasks = [runLang(langs[0], { prefix: true }), runLang(langs[0])];
  if (langs[1] && langs[1] !== langs[0]) tasks.push(runLang(langs[1]));
  await Promise.allSettled(tasks);

  // Кириличний запит знайшов замало — добираємо англійською
  // транслітерацією («Гта 5» -> "Gta 5", «Дум» -> "Doom")
  const variants = U.translitVariants(qTitle);
  if (variants.length && dedupeItems(all).length < 6) {
    await Promise.allSettled(variants.map(v => runLang('en', { text: v })));
  }

  const final = dedupeItems(all).slice(0, MAX_RESULTS);
  for (const it of final) {
    if (!it.poster) {
      const key = it.qid || ('t:' + String(it.title || '').toLowerCase());
      const t = thumbs.get(key);
      if (t) it.poster = cleanThumb(t);
    }
  }

  // Точний збіг назви із запитом — нагору; збіг за роком — слідом
  let ordered = final;
  const nq = qTitle.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  if (nq && nq.length >= 3) {
    const isExact = it =>
      it.title.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '') === nq ||
      (it.titleUk && it.titleUk.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '') === nq);
    if (ordered.some(isExact) && !ordered.every(isExact)) {
      ordered = ordered.filter(isExact).concat(ordered.filter(it => !isExact(it)));
    }
  }
  if (qYear != null && ordered.length > 1) {
    const isY = it => Number(it.year) === qYear;
    if (ordered.some(isY) && !ordered.every(isY)) {
      ordered = ordered.filter(isY).concat(ordered.filter(it => !isY(it)));
    }
  }
  return ordered;
}

// Кешований обгортка: повторний запит тієї ж назви — миттєвий
export function cachedGameSearch(q, onPartial) {
  const key = q.trim().toLowerCase().replace(/\s+/g, ' ');
  let p = cache.get(key);
  if (!p) {
    p = searchGames(q, onPartial);
    cache.set(key, p);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return p;
}
