// ============================================================
// Пошук і збагачення для вкладок «Альбоми», «Сингли» та «Книги» —
// прямо з Вікіпедії та Вікіданих, без жодних ключів (той самий
// підхід, що й в ігор; MusicBrainz/IGDB/OpenLibrary вимагають
// реєстрацій або лімітуються жорсткіше, а вікі відкриті для всіх
// і відповідають найшвидше).
//
//   searchMedia(q, kind, onPartial) — швидкі підказки: uk.вікі
//     (префікс + повнотекст + WILDCARD deepcategory) → en.вікі,
//     УСІ проходи ПАРАЛЕЛЬНО; кожен готовий пакет одразу йде в
//     onPartial. Бали за класом Вікіданих (альбом/сингл/пісня/
//     книга/роман…), виконавець/автор піднімають релевантність,
//     фільми/серіали/ігри/люди/статті відсіюються.
//   enrichMedia({ qid, kind, ... }) — деталі обраного запису:
//     виконавець (P175) або автор (P50), рік (P577), жанри (P136),
//     трекліст (P658, альбоми), видавництво (P123) і сторінок
//     (P1104, книги), обкладинка (P18 / мініатюра статті / Cover
//     Art Archive за MusicBrainz ID), опис з uk/en статті; укр.
//     назва — з мітки/статті або автопереклад.
// ============================================================

import * as U from './utils.js?v=6.2';
import { translateToUk } from './translate.js?v=6.2';

const WD_API = 'https://www.wikidata.org/w/api.php';

async function fetchJSON(url, timeoutMs = 8000, headers = {}) {
  // Два автоматичні повтори: короткі збої мережі/тротлінгу WMF —
  // не рідкість; повтори не подовжують відчуття очікування, бо проходи
  // паралельні й малюються поступово (onPartial)
  const waits = [0, 350, 800];
  let err;
  for (const w of waits) {
    if (w) await new Promise(r => setTimeout(r, w));
    try {
      return await fetchOnce(url, timeoutMs, headers);
    } catch (e) { err = e; }
  }
  throw err;
}

async function fetchOnce(url, timeoutMs, headers = {}) {
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

// ---------- Класи Вікіданих ----------
// Тільки QID, у яких упевнені: перелік книг збігається з «сірим
// списком» у wiki.js (NOT_FILM_CLASSES), музика — базові релізи.

const KIND_CLASSES = {
  album: ['Q482994'],                                     // музичний альбом
  single: ['Q134556', 'Q7366'],                           // сингл, пісня
  book: ['Q571', 'Q8261', 'Q149838', 'Q699', 'Q25379',    // книга, роман, повість,
    'Q277759', 'Q3331189', 'Q1004', 'Q8274',              // оповідання, п'єса, серія
    'Q7725634']                                           // книг, видання, комікс,
};                                                        // манґа, літературний твір

// Музика «не того роду»: у пошуку альбома сингли зайві, і навпаки
const WRONG_KIND = {
  album: ['Q134556', 'Q7366'],
  single: ['Q482994'],
  book: ['Q134556', 'Q7366', 'Q482994']
};

// Очевидно не наші сутності: люди, кіно, ігри, службові сторінки
const BLOCKED = new Set([
  'Q5',        // людина
  'Q11424',    // фільм
  'Q24856',    // серія фільмів
  'Q5398426',  // телесеріал
  'Q21191270', // епізод телесеріалу
  'Q3464665',  // сезон телесеріалу
  'Q506240',   // телевізійний фільм
  'Q7889',     // відеогра
  'Q191067',   // стаття
  'Q17329259', // енциклопедична стаття
  'Q13406463', // список статей
  'Q13433827'  // есе (стаття)
]);

// Категорії uk.Вікіпедії для цільових проходів WILDCARD +
// deepcategory (рятує короткі кириличні префікси — див. v5.4 у фільмів).
// Проходи best-effort: дерево, що перевищило ліміт deepcat, тихо
// повертає 0 результатів — решта проходів паралельно донесуться.
const UK_DEEPCAT = {
  album: 'Музичні альбоми',
  single: 'Сингли',
  book: 'Книги'
};

// Евристика «схоже на …» за вступним текстом статті — для сторінок
// БЕЗ сутності Вікіданих (коли клас не перевірити)
const HEAD_WORDS = {
  album: /альбом|саундтрек|\bsoundtrack\b|\bep\b|мікстейп|\bmixtape\b|компіляц|\bcompilation\b|\blive album\b|концертний альбом|студійний альбом/i,
  single: /сингл|\bsingle\b|пісн|\bsong\b|\btrack\b/i,
  book: /книга|роман|повіст|оповіданн|п'єса|казк|вірш|збірка|\bbook\b|\bnovel\b|\bnovella\b|\bstories\b|\bshort story\b|\bplay\b|\bmanga\b|\bcomic\b|манґа/i
};
const PERSON_WORDS = /актор|актриса|режисер|письменник|поет|співак|співачка|музикант|композитор|продюсер|\bactor\b|\bactress\b|\bdirector\b|\bwriter\b|\bauthor\b|\bpoet\b|\bsinger\b|\bmusician\b|\bcomposer\b|\bproducer\b|\bbiography\b/i;

function looksLikeMediaByExtract(text, kind) {
  const head = String(text || '').slice(0, 250);
  if (!head) return true; // без тексту — не судимо
  const wordRe = HEAD_WORDS[kind];
  const kindHit = wordRe.test(head);
  // Книга «роман британського письменника» — ок; особа «британський
  // письменник» без жодного слова твору — ні
  if (!kindHit && PERSON_WORDS.test(head)) return false;
  if (kind === 'book' && !kindHit && /\bhe\b|\bshe\b|народився|народилась|born/i.test(head)) return false;
  return kindHit || !PERSON_WORDS.test(head);
}

// ---------- Вікіпедія: пошук статей ----------

async function wikiSearch(lang, query, limit = 10, cat = null) {
  const sr = encodeURIComponent(cat ? `${query} deepcategory:${cat}` : query);
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrlimit=${limit}&gsrsearch=${sr}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    // pilicense=any: en.вікі віддає fair-use обкладинки альбомів і книг
    '&piprop=thumbnail&pithumbsize=500&pilicense=any';
  const data = await fetchJSON(url, 8000);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

async function wikiPrefix(lang, query, limit = 10) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&generator=prefixsearch&gpslimit=${limit}&gpssearch=${encodeURIComponent(query)}` +
    '&prop=pageimages|pageprops|extracts&exintro=1&explaintext=1&exlimit=max' +
    '&piprop=thumbnail&pithumbsize=500&pilicense=any';
  const data = await fetchJSON(url, 6500);
  const pages = data && data.query ? Object.values(data.query.pages || {}) : [];
  return pages
    .map(p => ({ ...p, _lang: lang }))
    .sort((a, b) => (a.index || 999) - (b.index || 999));
}

// ---------- Вікідані: твердження медіа одним викликом ----------

async function wdMediaEntities(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*` +
    `&props=claims%7Clabels%7Csitelinks&languages=uk%7Cen&ids=${encodeURIComponent(qids.join('|'))}`;
  const data = await fetchJSON(url, 7000);
  const out = {};
  const entities = (data && data.entities) || {};
  for (const qid of Object.keys(entities)) {
    const ent = entities[qid] || {};
    const claims = ent.claims || {};
    const labels = ent.labels || {};
    const sitelinks = ent.sitelinks || {};
    const e = {
      classes: [], genreQids: [], performerQids: [], authorQids: [],
      trackQids: [], year: null, releaseDate: null
    };
    e.ukWikiTitle = (sitelinks.ukwiki && sitelinks.ukwiki.title) || null;
    e.enWikiTitle = (sitelinks.enwiki && sitelinks.enwiki.title) || null;

    for (const c of claims.P31 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.classes.push(v.id);
    }
    // Виконавець (P175) — альбоми і сингли
    for (const c of claims.P175 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.performerQids.length < 2) e.performerQids.push(v.id);
    }
    // Автор (P50) — книги
    for (const c of claims.P50 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.authorQids.length < 2) e.authorQids.push(v.id);
    }
    // Видавництво/лейбл (P123)
    for (const c of claims.P123 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && !e.pubQid) e.pubQid = v.id;
    }
    // Жанри (P136)
    for (const c of claims.P136 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id) e.genreQids.push(v.id);
    }
    // Трекліст (P658) — альбоми; порядок у claims відповідає диску
    for (const c of claims.P658 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (v && v.id && e.trackQids.length < 30) e.trackQids.push(v.id);
    }
    // MusicBrainz ID (P436 — реліз, P1004 — група релізів) → обкладинка
    // з Cover Art Archive (відкритий CDN, працює прямо в <img>)
    for (const c of claims.P436 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (typeof v === 'string' && !e.mbid) e.mbid = v;
    }
    for (const c of claims.P1004 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (typeof v === 'string' && !e.mbGroup) e.mbGroup = v;
    }
    // К-ть сторінок (P1104) — книги
    for (const c of claims.P1104 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const n = v && v.amount ? parseInt(v.amount, 10) : NaN;
      if (!Number.isNaN(n) && n > 0 && n < 20000 && !e.pages) e.pages = n;
    }
    // Зображення (P18) — обкладинки книг і класичних альбомів у Вікісховищі
    for (const c of claims.P18 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (typeof v === 'string' && !e.imageFile) e.imageFile = v;
    }
    // Дата виходу/публікації (P577): найраніша дата
    for (const c of claims.P577 || []) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      const t = v && v.time ? String(v.time) : '';
      const y = t ? parseInt(t.slice(1, 5), 10) : NaN;
      if (!Number.isNaN(y) && y >= 1400 && y <= 2100 && (e.year == null || y < e.year)) e.year = y;
      if (v && v.precision === 11 && /^[-+]?\d{4}-\d{2}-\d{2}/.test(t)) {
        const iso = t.replace(/^[-+]?/, '').slice(0, 10);
        if (!e.releaseDate || iso < e.releaseDate) e.releaseDate = iso;
      }
    }
    e.labelUk = (labels.uk && labels.uk.value) || null;
    e.labelEn = (labels.en && labels.en.value) || null;
    out[qid] = e;
  }
  return out;
}

// Мітки uk/en для виконавців/авторів/жанрів/видавництв/треків
async function wdLabels(qids) {
  if (!qids.length) return {};
  const url = `${WD_API}?action=wbgetentities&format=json&origin=*&props=labels&languages=uk%7Cen&ids=${encodeURIComponent(qids.slice(0, 50).join('|'))}`;
  const data = await fetchJSON(url, 7000);
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
  // Дані англійською (як домовилися: укр. лише назва), fallback uk
  return (l && (l.en || l.uk)) || null;
};

function commonsThumb(file, width = 500) {
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;
}

function coverArtArchive({ mbid, mbGroup } = {}) {
  // Cover Art Archive: відкриті обкладинки музичних релізів; URL
  // лише КОНСТРУЮЄМО (без fetch) — 404 мирно ловить onerror у <img>
  if (mbid) return `https://coverartarchive.org/release/${encodeURIComponent(mbid)}/front-500`;
  if (mbGroup) return `https://coverartarchive.org/release-group/${encodeURIComponent(mbGroup)}/front-500`;
  return null;
}

// Рік із вступного тексту статті («…альбом 1969 року…», "… 1969 album …")
function yearFromExtract(text) {
  const m = String(text || '').slice(0, 300).match(/\b(1[4-9]\d\d|20\d\d)\b/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return (y >= 1400 && y <= 2100) ? y : null;
}

function truncPlot(s) {
  s = String(s || '').trim();
  return s.length > 700 ? s.slice(0, 697).trimEnd() + '…' : (s || null);
}

function wikiUrl(lang, title) {
  if (!title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

// ============================================================
// Музика поза Вікіпедією: iTunes Search API + MusicBrainz.
// Обидва — з відкритим CORS і без ключів (Deezer відпав: гео-
// блокування частини регіонів). Вікі погано покриває сингли й
// малоісні релізи, тоді як iTunes знає майже будь-яку пісню
// (з обкладинкою і 30-секундним прев'ю!), а MusicBrainz — най-
// повніший каталог релізів (обкладинки — Cover Art Archive).
// ============================================================

// 100×100 → 600×600 (той самий файл, більший прев'ю)
function artwork600(u) {
  return u ? String(u).replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg') : null;
}

function yearOfDate(d) {
  const y = d ? parseInt(String(d).slice(0, 4), 10) : NaN;
  return Number.isNaN(y) ? null : y;
}

async function itunesSearch(q, kind) {
  // entity=song — сингли/пісні; entity=album — альбоми
  const entity = kind === 'single' ? 'song' : 'album';
  const url = `https://itunes.apple.com/search?media=music&entity=${entity}&limit=15&term=${encodeURIComponent(q)}`;
  const data = await fetchJSON(url, 6000);
  const out = [];
  for (const r of ((data && data.results) || [])) {
    const year = yearOfDate(r.releaseDate);
    const cover = artwork600(r.artworkUrl100);
    const genres = r.primaryGenreName ? [r.primaryGenreName] : [];
    if (kind === 'single') {
      if (!r.trackName) continue;
      out.push({
        title: r.trackName, titleUk: null, artist: r.artistName || null,
        author: null, year, cover, preview: r.previewUrl || null,
        genres, tracks: [], publisher: null, pages: null,
        qid: null, enWikiTitle: null, ukWikiTitle: null, wikiUrl: null,
        score: 4, source: 'itunes'
      });
    } else {
      // «- Single» / «- EP» у назві збірки — це не альбом; мінімалки
      // (1–2 треки) теж пропускаємо
      if (!r.collectionName) continue;
      if (r.trackCount != null && r.trackCount < 3) continue;
      const name = String(r.collectionName).replace(/\s*-\s*(Single|EP)\s*$/i, '');
      out.push({
        title: name, titleUk: null, artist: r.artistName || null,
        author: null, year, cover, preview: null,
        genres, tracks: [], publisher: null, pages: null,
        qid: null, enWikiTitle: null, ukWikiTitle: null, wikiUrl: null,
        score: 4, source: 'itunes'
      });
    }
  }
  return out;
}

async function mbSearch(q, kind) {
  // recording — пісні/сингли; release-group — альбоми
  const res = kind === 'single' ? 'recording' : 'release-group';
  const url = `https://musicbrainz.org/ws/2/${res}?query=${encodeURIComponent(q)}&fmt=json&limit=25`;
  const data = await fetchJSON(url, 7000);
  const rows = (data && (kind === 'single' ? data.recordings : data['release-groups'])) || [];
  // MB за голою назвою повертає сотні однойменних записів маловідомих
  // виконавців — лишаємо лише найрелевантніші (score ≥ 90), кілька штук:
  // масовість покриває iTunes, MB додає глибину каталогу
  const top = rows
    .filter(r => r && r.title && (r.score || 0) >= 90)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 4);
  const out = [];
  for (const r of top) {
    if (!r || !r.title) continue;
    const artist = (r['artist-credit'] || [])
      .map(c => (c && c.artist && c.artist.name) || (c && c.name) || null)
      .filter(Boolean).join(' & ') || null;
    const year = yearOfDate(r['first-release-date']);
    // Обкладинка альбому — Cover Art Archive за id release-group
    const cover = (kind !== 'single' && r.id)
      ? `https://coverartarchive.org/release-group/${encodeURIComponent(r.id)}/front-500` : null;
    let score = 3;
    // релевантність MusicBrainz (score 0–100) — трохи підсилюємо топові
    score += Math.round((r.score || 0) / 50);
    // не-альбомні типи («Natural», «Broadcast», «Other») — нижче
    if (kind !== 'single' && r['primary-type'] && r['primary-type'] !== 'Album') score -= 2;
    out.push({
      title: r.title, titleUk: null, artist, author: null, year, cover,
      preview: null, genres: [], tracks: [], publisher: null, pages: null,
      qid: null, enWikiTitle: null, ukWikiTitle: null, wikiUrl: null,
      score, source: 'mb'
    });
  }
  return out;
}

// Вікі-довідка для записів, знайдених поза Вікіпедією (iTunes/
// MusicBrainz): опис + укр. назва зі статті. М'яко: без статті —
// пусто, користувач заповнить сам / спрацює автопереклад.
async function wikiLookup(title, artist, kind) {
  const out = {};
  const find = async (lang, q) => {
    try {
      const pages = await wikiSearch(lang, q, 5);
      for (const p of pages) {
        const ex = String(p.extract || '');
        if (ex && HEAD_WORDS[kind].test(ex.slice(0, 250))) return p;
      }
    } catch (e) { /* цей розділ недоступний */ }
    return null;
  };
  const en = await find('en', artist ? `${artist} ${title}` : title);
  if (en) {
    out.plot = truncPlot(en.extract);
    out.enWikiTitle = en.title;
    out.wikiUrl = wikiUrl('en', en.title);
  }
  const uk = await find('uk', title);
  if (uk) {
    out.titleUk = uk.title;
    out.ukWikiTitle = uk.title;
    if (!out.plot) out.plot = truncPlot(uk.extract);
    out.wikiUrl = out.wikiUrl || wikiUrl('uk', uk.title);
  }
  return out;
}

// «Назва 1987» / «назва (1987)» -> { title, year }
function splitQueryYear(q) {
  const s = String(q || '').trim();
  const m = s.match(/^(.{2,}?)\s*[\(\[]?(\d{4})[\)\]]?\s*$/);
  if (!m) return { title: s, year: null };
  const y = parseInt(m[2], 10);
  if (y < 1400 || y > 2100) return { title: s, year: null };
  return { title: m[1].trim().replace(/[\(\[]$/, '').trim(), year: y };
}

// ---------- Пошук підказок ----------
//
// УСІ вікі-проходи паралельні (префікс + повнотекст uk/en,
// кирилицею ще й WILDCARD+deepcategory): кожен готовий пакет
// одразу малюється, як у фільмів. Далі — один пакет міток
// Вікіданих, і фінальне сортування (бал → точний збіг нагору).

export async function searchMedia(query, kind, onPartial, opts = {}) {
  kind = KIND_CLASSES[kind] ? kind : 'album';
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const { title: qTitle, year: qYear } = splitQueryYear(q);
  const normQ = U.normTitle(qTitle);
  const hasCyrillic = /[а-яіїєґ]/i.test(qTitle);
  const langs = (opts.langs) || (hasCyrillic ? ['uk', 'en'] : ['en', 'uk']);

  const seen = new Set();   // дедуплікація QID/назв між пакетами
  const items = [];
  // Кожен пакет малюється ЧЕРЕЗ ранжування (а не «як прийшло»):
  // iTunes малює найшвидше, і без цього ремікси/кавери займали б верх
  // списку на кілька секунд до фінального сортування
  const paint = () => { if (typeof onPartial === 'function' && items.length) onPartial(rankItems(items, normQ)); };

  const pushPages = async (pages) => {
    // дедуплікація сторінок між проходами
    const fresh = pages.filter(p => {
      const qid = p.pageprops && p.pageprops.wikibase_item;
      const key = qid || ('t:' + String(p.title || '').toLowerCase());
      if (!p.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) return;
    // навігаційні сторінки (списки, дискографії, чарти) — не записи,
    // їх неможливо оцінювати; у підказках вони лише забивають місце
    const usable = fresh.filter(p => !NOT_MUSIC_TITLE.test(String(p.title || '').trim()));
    if (!usable.length) return;

    const qids = usable.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
    let ents = {};
    try { ents = await wdMediaEntities(qids); } catch (e) { /* вікі недоступні — лишається базове */ }

    for (const p of usable) {
      const qid = (p.pageprops && p.pageprops.wikibase_item) || null;
      const ent = qid ? ents[qid] : null;
      const extract = String(p.extract || '');
      const cl = (ent && ent.classes) || [];
      let score = 0;

      if (ent) {
        if (cl.some(c => BLOCKED.has(c))) continue; // людина/фільм/гра/стаття — геть
        if (cl.some(c => KIND_CLASSES[kind].includes(c))) score += 5;
        if (cl.some(c => WRONG_KIND[kind].includes(c))) score -= 5;
        // додаткові сигнали роду
        if (kind !== 'book' && ((ent.mbid || ent.mbGroup || ent.trackQids.length) || ent.performerQids.length)) score += 2;
        if (kind === 'book' && (ent.authorQids.length || ent.pages)) score += 2;
        if (ent.year != null) score += 1;
      } else if (qid) {
        // сутність є, але Вікідані не відповіли — лишаємо м'яко
        score += 0;
      } else if (!looksLikeMediaByExtract(extract, kind)) {
        continue; // сторінка без QID і не схожа на медіа цього роду
      }

      if (/\((альбом|album|сингл|single|пісня|song|книга|novel|роман)\)/i.test(p.title)) score += 2;
      if (qYear && ent && ent.year === qYear) score += 2;
      if (normQ && U.normTitle(p.title).startsWith(normQ)) score += 1;
      if (HEAD_WORDS[kind].test(extract.slice(0, 250))) score += 1;

      const title = p._lang === 'uk' ? null : p.title;
      const titleUk = p._lang === 'uk' ? p.title : null;
      items.push({
        title,
        titleUk,
        year: (ent && ent.year) || yearFromExtract(extract) || null,
        cover: (p.thumbnail && p.thumbnail.source) || null,
        plot: truncPlot(extract),
        qid,
        enWikiTitle: (ent && ent.enWikiTitle) || (p._lang === 'en' ? p.title : null),
        ukWikiTitle: (ent && ent.ukWikiTitle) || (p._lang === 'uk' ? p.title : null),
        wikiUrl: wikiUrl(p._lang, p.title),
        artist: null,
        author: null,
        publisher: null,
        genres: [],
        tracks: [],
        score,
        source: 'wiki'
      });
    }
    paint();
  };

  // УСІ проходи ПАРАЛЕЛЬНО — перший малюнок найшвидший
  const tasks = [
    runPass(langs[0], { prefix: true }),
    runPass(langs[0], {}),
    runPass(langs[1] && langs[1] !== langs[0] ? langs[1] : langs[0], {})
  ];
  // Кириличні короткі префікси: цільові дерева категорій
  if (hasCyrillic && qTitle.length >= 3) {
    tasks.push(runPass('uk', { query: `${qTitle}*`, cat: UK_DEEPCAT[kind] }));
  }
  // Рік у запиті («creedence 1987»): цільовий повнотекст
  if (qYear) {
    tasks.push(runPass(langs[0], { query: `${qTitle} ${qYear}` }));
    tasks.push(runPass(langs[0], { prefix: true, query: `${qTitle} (${qYear}` }));
  }

  // Музика поза вікі: iTunes (майже будь-яка пісня/альбом + прев'ю)
  // і MusicBrainz (найповніший каталог релізів) — теж паралельно.
  // Вікі лишається в грі: укр. назви, жанри, трекліст, сюжет.
  if (kind !== 'book') {
    tasks.push(itunesSearch(qTitle, kind).then(list => { pushMusic(list); }).catch(() => {}));
    tasks.push(mbSearch(qTitle, kind).then(list => { pushMusic(list); }).catch(() => {}));
  }

// Службові/навігаційні сторінки у підказках — не записи
const NOT_MUSIC_TITLE = /^(список|списки|list of|дискограф|discograph|billboard|hot 100|chart|charts|музичні чарти|рок-чарти)/i;

  function pushMusic(list) {
    const fresh = [];
    const local = new Set();
    for (const it of list || []) {
      if (NOT_MUSIC_TITLE.test(String(it.title || '').trim())) continue;
      const key = itemKey(it);
      if (local.has(key)) continue;
      local.add(key);
      fresh.push(it);
    }
    if (fresh.length) { items.push(...fresh); paint(); }
  }

  async function runPass(lang, { prefix = false, query: qq = qTitle, cat = null } = {}) {
    try {
      const pages = prefix ? await wikiPrefix(lang, qq) : await wikiSearch(lang, qq, 10, cat);
      await pushPages(pages.slice(0, prefix ? 8 : 10));
    } catch (e) { /* цей розділ/прохід недоступний — інші донесуться */ }
  }

  await Promise.allSettled(tasks);

  // Мітки виконавців/авторів/жанрів/видавництв одним викликом
  await fillLabels(items, kind);
  paint();

  // Мало результатів і запит кирилицею — добір транслітерацією
  if (!opts.noFallback && hasCyrillic && rankItems(items, normQ).length < 8) {
    const variants = U.translitVariants(qTitle);
    if (variants.length) {
      for (const v of variants) {
        try {
          const more = await searchMedia(v, kind, null, { langs: ['en'], noFallback: true });
          pushMusic(more);
        } catch (e) { /* варіант не вдався */ }
      }
      await fillLabels(items, kind);
      paint();
    }
  }

  // Ранжування + злиття (використовується і в paint, і у фіналі).
  // Злиття двоступеневе: 1) за точним ключем (QID або назва+виконавець);
  // 2) крос-злиття однойменних записів із різних джерел (вікі-запис без
  // виконавця + iTunes-запис з ним) — але різні QID ніколи не зливаються.
  function mergeInto(keep, it) {
    for (const k of ['title', 'titleUk', 'year', 'cover', 'plot', 'artist', 'author', 'publisher', 'wikiUrl', 'ukWikiTitle', 'enWikiTitle', 'qid', 'preview', 'pages']) {
      if (keep[k] == null && it[k] != null) keep[k] = it[k];
    }
    if ((!keep.genres || !keep.genres.length) && it.genres && it.genres.length) keep.genres = it.genres;
    if ((!keep.tracks || !keep.tracks.length) && it.tracks && it.tracks.length) keep.tracks = it.tracks;
    if (it.score > keep.score) keep.score = it.score;
    // Скільки джерел погодилися, що це той самий запис: оригінал «Blinding
    // Lights» — це itunes+musicbrainz+вікі разом, кавер — лише одне джерело
    if (!keep._srcs) keep._srcs = new Set(keep.source ? [keep.source] : []);
    if (it.source) keep._srcs.add(it.source);
  }

  function rankItems(raw, nq) {
    // 1) точні ключі
    const byKey = new Map();
    const list = [];
    for (const it of raw) {
      const key = itemKey(it);
      const prev = byKey.get(key);
      if (prev) mergeInto(prev, it);
      else { byKey.set(key, it); list.push(it); }
    }
    // 2) крос-злиття однойменних: групуємо ВСІ записи за назвою, всередині
    // групи кластеризуємо за виконавцем (різні виконавці — різні пісні),
    // записи без виконавця (вікі до міток) чіпляємо до кластера, чий
    // виконавець згаданий в описі статті («… song by … The Weeknd …»)
    const merged = [];
    const groups = new Map();
    for (const it of list) {
      const t = U.normTitle(it.title || it.titleUk || '');
      if (!t) { merged.push(it); continue; }
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(it);
    }
    for (const arr of groups.values()) {
      if (arr.length === 1) { merged.push(arr[0]); continue; }
      const clusters = [];
      for (const it of arr) {
        const who = it.artist || it.author || null;
        if (who) {
          const na = U.normTitle(who);
          let cl = clusters.find(c => c.na === na);
          if (!cl) { cl = { na, artist: who, items: [] }; clusters.push(cl); }
          cl.items.push(it);
        } else if (it.qid && it.plot) {
          // вікі-запис ще без мітки виконавця — шукаємо виконавця в описі
          const low = String(it.plot).toLowerCase();
          const cl = clusters.find(c => low.includes(String(c.artist).toLowerCase()));
          if (cl) cl.items.push(it);
          else merged.push(it); // невідомо чий — не ризикуємо
        } else {
          merged.push(it);
        }
      }
      for (const cl of clusters) {
        // первинним лишаємо запис із QID (авторитетні назва/укр. назва)
        cl.items.sort((a, b) => (b.qid ? 1 : 0) - (a.qid ? 1 : 0));
        const keep = cl.items[0];
        for (const it of cl.items.slice(1)) mergeInto(keep, it);
        merged.push(keep);
      }
    }
    let out = merged.filter(it => it.score > -4);
    if (nq && nq.length >= 3) {
      const isExact = it =>
        U.normTitle(it.titleUk || it.title) === nq || U.normTitle(it.title) === nq;
      // Згода джерел: оригінал підтверджений кількома каталогами одночасно
      // (itunes+musicbrainz+вікі), ремікси/кавери/малоісні тезки — одним.
      // Це головний спосіб підняти ПЕРШОВИДАННЯ над реміксами.
      for (const it of out) {
        const agree = it._srcs ? it._srcs.size : 1;
        if (agree > 1) it.score += (agree - 1) * 2;
      }
      // Точний збіг — ПЕРВИННИЙ критерій (позначка в сортуванні, бо
      // голий score змішав би його з вікі-піснями класу Q7366, у яких
      // бал вищий за iTunes-записи)
      out.forEach(it => { it._exact = isExact(it) ? 1 : 0; });
      return [...out].sort((a, b) => (b._exact - a._exact) || (b.score - a.score)).slice(0, 20);
    }
    return [...out].sort((a, b) => b.score - a.score).slice(0, 20);
  }

  return rankItems(items, normQ);
}

// Ключ дедуплікації: QID точний; без нього — назва + виконавець/автор
// (однойменні пісні різних виконавців не повинні зливатися)
function itemKey(it) {
  if (it.qid) return 'q:' + it.qid;
  const t = U.normTitle(it.title || it.titleUk || '');
  const who = U.normTitle(it.artist || it.author || '');
  return 'm:' + t + '|' + who;
}

async function fillLabels(items, kind) {
  const labelQids = new Set();
  const trackQids = new Set();
  // свіже зчитування тверджень: потрібні QID осіб/жанрів/треків
  const withQ = items.filter(it => it.qid);
  if (!withQ.length) return;
  let ents = {};
  try { ents = await wdMediaEntities(withQ.map(it => it.qid).slice(0, 20)); } catch (e) { return; }
  for (const it of withQ) {
    const e = ents[it.qid];
    if (!e) continue;
    e.performerQids.forEach(q => labelQids.add(q));
    e.authorQids.forEach(q => labelQids.add(q));
    if (e.pubQid) labelQids.add(e.pubQid);
    e.genreQids.slice(0, 4).forEach(q => labelQids.add(q));
    e.trackQids.slice(0, 16).forEach(q => trackQids.add(q));
  }
  let lm = {};
  try { lm = await wdLabels([...labelQids, ...trackQids]); } catch (e) { /* без міток */ }
  for (const it of withQ) {
    const e = ents[it.qid];
    if (!e) continue;
    if (e.performerQids.length) it.artist = label(lm, e.performerQids[0]);
    if (e.authorQids.length) it.author = label(lm, e.authorQids[0]);
    if (e.pubQid) it.publisher = label(lm, e.pubQid);
    it.genres = e.genreQids.map(g => label(lm, g)).filter(Boolean).slice(0, 5);
    it.tracks = e.trackQids.map(t => label(lm, t)).filter(Boolean).slice(0, 20);
    if (!it.titleUk && e.labelUk) it.titleUk = e.labelUk;
    if (!it.title && e.labelEn) it.title = e.labelEn;
    if (!it.year && e.year) it.year = e.year;
    if (!it.cover && e.imageFile) it.cover = commonsThumb(e.imageFile);
    if (!it.cover && kind !== 'book') it.cover = coverArtArchive(e);
    if (e.ukWikiTitle) it.ukWikiTitle = e.ukWikiTitle;
    if (e.enWikiTitle) it.enWikiTitle = e.enWikiTitle;
  }
}

// ---------- Повне збагачення обраного запису ----------

// Інтро статті uk/en Вікіпедії за точною назвою (опис + мініатюра)
async function wikiArticle(lang, title) {
  if (!title) return null;
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=500&pilicense=any` +
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

export async function enrichMedia({ qid, kind, title, titleUk, year,
  artist = null, author = null, cover = null, preview = null,
  genres = [], tracks = [], publisher = null, pages = null } = {}) {
  kind = KIND_CLASSES[kind] ? kind : 'album';
  // База — те, що вже відомо з підказки (iTunes/MusicBrainz дають
  // виконавця, рік, обкладинку і прев'ю одразу)
  const out = {
    title: null, titleUk: titleUk || null, year: year || null,
    releaseDate: null, artist, author, cover, preview,
    genres: [...(genres || [])], tracks: [...(tracks || [])],
    publisher, pages: pages || null
  };

  let ent = null;
  if (qid) {
    try {
      const ents = await wdMediaEntities([qid]);
      ent = ents[qid] || null;
    } catch (e) { /* без Вікіданих */ }
  }

  if (ent) {
    const labelQids = new Set([
      ...ent.performerQids, ...ent.authorQids,
      ...(ent.pubQid ? [ent.pubQid] : []),
      ...ent.genreQids.slice(0, 6),
      ...ent.trackQids.slice(0, 20)
    ]);
    let lm = {};
    try { lm = await wdLabels([...labelQids]); } catch (e) { /* без міток */ }
    if (out.year == null && ent.year != null) out.year = ent.year;
    out.releaseDate = ent.releaseDate || null;
    if (!out.artist && ent.performerQids.length) out.artist = label(lm, ent.performerQids[0]);
    if (!out.author && ent.authorQids.length) out.author = label(lm, ent.authorQids[0]);
    if (!out.publisher && ent.pubQid) out.publisher = label(lm, ent.pubQid);
    if (!out.genres.length) out.genres = ent.genreQids.map(g => label(lm, g)).filter(Boolean).slice(0, 5);
    if (!out.tracks.length) out.tracks = ent.trackQids.map(t => label(lm, t)).filter(Boolean).slice(0, 20);
    if (out.pages == null && ent.pages) out.pages = ent.pages;
    if (!out.cover) out.cover = (ent.imageFile && commonsThumb(ent.imageFile)) || coverArtArchive(ent) || null;
    out.ukWikiTitle = ent.ukWikiTitle || null;
    out.enWikiTitle = ent.enWikiTitle || null;
    if (!out.titleUk && ent.labelUk) out.titleUk = ent.labelUk;
    if (!out.title && ent.labelEn) out.title = ent.labelEn;
  }

  if (!qid) {
    // Запис поза Вікіпедією (iTunes/MusicBrainz/вручну): м'яка довідка —
    // опис і укр. назва зі статті, якщо вона взагалі є
    const lk = await wikiLookup(title, out.artist || '', kind);
    if (lk.plot && !out.plot) out.plot = lk.plot;
    if (lk.titleUk && !out.titleUk) out.titleUk = lk.titleUk;
    if (lk.ukWikiTitle) out.ukWikiTitle = lk.ukWikiTitle;
    if (lk.enWikiTitle) out.enWikiTitle = lk.enWikiTitle;
    if (lk.wikiUrl) out.wikiUrl = lk.wikiUrl;
    if (!out.cover && lk.plot == null) { /* залишаємо те, що було */ }
  }

  // Опис: спершу українська стаття, за потреби — англійська
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

  if (year && out.year == null) out.year = year;
  out.wikiUrl = out.wikiUrl || wikiUrl('uk', out.ukWikiTitle) || wikiUrl('en', out.enWikiTitle) || null;
  return out;
}

// Останній шанс для укр. назви — автопереклад (викликається з форми)
export async function translateTitle(title) {
  if (!title) return null;
  try {
    const tr = await translateToUk(String(title).trim());
    if (tr && tr.toLowerCase() !== String(title).trim().toLowerCase()) return tr;
  } catch (e) { /* переклад не критичний */ }
  return null;
}
