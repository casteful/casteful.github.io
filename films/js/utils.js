// ============================================================
// Утиліти: екранування, форматування, кольори, робота з постерами
// ============================================================

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Українська множина: plural(3, ['оцінка','оцінки','оцінок']) -> 'оцінки'
export function plural(n, forms) {
  const n10 = Math.abs(n) % 10, n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

// Колір для оцінки: 1 — червоний, 10 — зелений
export function ratingColor(v) {
  const h = Math.max(0, Math.min(1, (v - 1) / 9)) * 120;
  return `hsl(${Math.round(h)} 60% 45%)`;
}

export function avg(ratingsObj) {
  const vals = Object.values(ratingsObj || {}).filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Середнє з комою, як прийнято в українському форматі: 9,3
export function fmtAvg(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

export function intOrNull(v, min = 1, max = 100000) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < min || n > max) return null;
  return n;
}

export function parseGenres(s) {
  return String(s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

// Індекс першої літери для аватарки
export function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase();
}

// Змінює розмір постера з CDN Amazon/IMDb (економія трафіку)
export function posterUrl(url, width = 400) {
  if (!url) return null;
  const u = String(url);
  if (/m\.media-amazon\.com/.test(u)) {
    const sized = u.replace(/\._V1_.*?\.jpg$/i, `._V1_QL75_UX${width}_.jpg`);
    if (sized !== u) return sized;
    return u.replace(/\.jpg$/i, `._V1_QL75_UX${width}_.jpg`);
  }
  return u;
}

export function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

// ISO-дата прем'єри («2007-09-24») -> «24 вересня 2007»
const MONTHS_UK_GEN = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
];
export function fmtPremiere(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = parseInt(m[3], 10), mo = parseInt(m[2], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${d} ${MONTHS_UK_GEN[mo - 1]} ${m[1]}`;
}

// Жанри: англійські мітки Wikidata -> українські (укр. рядки не чіпаємо).
// Словник — замкнений набір популярних жанрів; невідоме лишається як є.
const GENRE_UK = {
  'drama': 'драма', 'comedy': 'комедія', 'action': 'бойовик',
  'thriller': 'трилер', 'psychological thriller': 'психологічний трилер',
  'horror': 'жахи', 'science fiction': 'наукова фантастика', 'sci-fi': 'наукова фантастика',
  'crime': 'кримінал', 'romance': 'мелодрама', 'romantic comedy': 'романтична комедія',
  'documentary': 'документальний фільм', 'animation': 'анімація',
  'animated': 'анімаційний', 'fantasy': 'фентезі', 'mystery': 'детектив',
  'family': 'сімейний', 'biography': 'біографія', 'biopic': 'біографічний фільм',
  'history': 'історичний', 'historical': 'історичний', 'war': 'військовий',
  'musical': 'мюзикл', 'music': 'музичний', 'sport': 'спортивний', 'sports': 'спортивний',
  'adventure': 'пригоди', 'western': 'вестерн', 'sitcom': 'ситком',
  'short': 'короткометражний', 'teen': 'підлітковий', 'adult': 'дорослий',
  'black comedy': 'чорна комедія', 'dark comedy': 'чорна комедія',
  'dark fantasy': 'темне фентезі', 'supernatural': 'надприродне',
  'suspense': 'саспенс', 'noir': 'нуар', 'film noir': 'нуар',
  'satire': 'сатира', 'parody': 'пародія', 'tragedy': 'трагедія',
  'historical drama': 'історична драма', 'crime drama': 'кримінальна драма',
  'coming-of-age': 'дорослішання', 'coming of age film': 'фільм дорослішання',
  'erotic': 'еротика', 'experimental': 'експериментальний', 'avant-garde': 'авангард'
};
export function translateGenres(list) {
  return (Array.isArray(list) ? list : []).map(g => {
    const s = String(g || '').trim();
    if (!s || /[а-яіїєґ]/i.test(s)) return s; // вже українською (або порожньо)
    const low = s.toLowerCase();
    if (GENRE_UK[low]) return GENRE_UK[low];
    // «drama film» / «crime television series» -> базовий жанр без суфікса
    const base = low.replace(/\s*(film|movie|television series|tv series|series|film series)\s*$/, '').trim();
    if (GENRE_UK[base]) return GENRE_UK[base];
    return s;
  }).filter(Boolean);
}

// Обрізає довгий рядок, додаючи трикрапку
export function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function pluralFilms(n) { return plural(n, ['фільм', 'фільми', 'фільмів']); }
export function pluralRatings(n) { return plural(n, ['оцінка', 'оцінки', 'оцінок']); }
export function pluralRatingsGen(n) { return plural(n, ['оцінки', 'оцінок', 'оцінок']); }

// Десятиліття українською: 1990-ті, 2000-ні, 2010-ні...
export function decadeLabel(d) {
  return d >= 2000 ? `${d}-ні` : `${d}-ті`;
}

// ============================================================
// Українська → латиниця для ПОШУКУ (fallback автозаповнення):
// коли за українською назвою знайдено замало — пробуємо її латинським
// написанням на IMDb та в en.Вікіпедії. Три варіанти:
//   national — офіційна транслітерація КМУ-2010
//              («Інтерстеллар» → "Interstellar");
//   phon     — фонетична, ближча до англійських написань
//              (и→i, х→h, ю→u, я→a, й→y, «Джокер» → "Joker");
//   g        — як phon, але г/ґ → g («Гладіатор» → "Gladiator").
// Повертає масив УНІКАЛЬНИХ варіантів (порожній, якщо кирилиці немає).
// ============================================================

const TL_BASE = {
  'а': 'a', 'б': 'b', 'в': 'v', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z',
  'і': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p',
  'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'ч': 'ch', 'ш': 'sh',
  'ь': '', '\'': '', '’': '', 'ʼ': ''
};
const TL_SPEC = {
  national: { 'г': 'h', 'ґ': 'g', 'х': 'kh', 'и': 'y', 'й': 'i', 'ц': 'ts', 'щ': 'shch' },
  phon:     { 'г': 'h', 'ґ': 'g', 'х': 'h',  'и': 'i', 'й': 'y', 'ц': 'ts', 'щ': 'sh' },
  g:        { 'г': 'g', 'ґ': 'g', 'х': 'h',  'и': 'i', 'й': 'y', 'ц': 'ts', 'щ': 'sh' }
};
// є/ї/ю/я: на початку слова та всередині
const TL_INITIAL = {
  national: { 'є': 'ie', 'ї': 'i', 'ю': 'iu', 'я': 'ia' },
  phon:     { 'є': 'ye', 'ї': 'yi', 'ю': 'yu', 'я': 'ya' }
};
TL_INITIAL.g = TL_INITIAL.phon; // g-варіант відрізняється лише г/ґ
const TL_INNER = {
  national: { 'є': 'ie', 'ї': 'i', 'й': 'i', 'ю': 'iu', 'я': 'ia' },
  phon:     { 'є': 'e',  'ї': 'i', 'ю': 'u',  'я': 'a' }
};
TL_INNER.g = TL_INNER.phon;
const IS_LETTER = /[a-zа-яіїєґ0-9]/i;

function translitUk(s, mode) {
  const spec = TL_SPEC[mode];
  const initial = TL_INITIAL[mode];
  const inner = TL_INNER[mode];
  let out = '';
  let prevLetter = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const low = ch.toLowerCase();

    // Диграфи дж/дз: у фонетичних варіантах «Джокер» → "Joker"
    if (low === 'д' && (s[i + 1] === 'ж' || s[i + 1] === 'з')) {
      let r = (s[i + 1] === 'ж')
        ? (mode === 'national' ? 'dzh' : 'j')
        : 'dz';
      if (ch !== low) r = r.charAt(0).toUpperCase() + r.slice(1);
      out += r;
      i++;
      prevLetter = true;
      continue;
    }

    let r = prevLetter ? undefined : initial[low];
    if (r === undefined && prevLetter) r = inner[low];
    if (r === undefined) r = spec[low];
    if (r === undefined) r = TL_BASE[low];
    if (r === undefined) r = ch; // латиниця, цифри, пробіли, розділові

    if (ch !== low && r) r = r.charAt(0).toUpperCase() + r.slice(1);
    out += r;
    prevLetter = IS_LETTER.test(ch);
  }
  return out;
}

export function translitVariants(q) {
  const s = String(q || '');
  if (!/[а-яіїєґ]/i.test(s)) return [];
  const out = [];
  for (const v of [translitUk(s, 'national'), translitUk(s, 'phon'), translitUk(s, 'g')]) {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
