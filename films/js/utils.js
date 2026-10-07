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
