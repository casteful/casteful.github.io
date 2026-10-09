// ============================================================
// Автопереклад назв фільмів українською.
//
// Коли джерела не дають готової укр. назви (у Вікіданих немає uk-мітки,
// укр. вікі-статті не існує) — перекладаємо оригінальну назву
// клієнтськими безкоштовними API (без ключів, працюють зі статичного
// сайту — обидва віддають CORS-заголовки):
//   1. Google Translate (gtx) — основне: найкраща якість, авто-значення
//      мови оригіналу (sl=auto), dj=1 віддає простий JSON
//   2. MyMemory — резерв, якщо Google недоступний/обмежений
//
// Результати кешуються на сесію; будь-яка невдача (мережа, CORS,
// таймаут, сміттєва відповідь) → null — поле назви лишається як було
// (тиха деградація, ніщо не ламається).
// ============================================================

const cache = new Map();
const MAX_LEN = 120; // назви короткі; довше — вже не назва
const TIMEOUT_MS = 5000;

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null; // мережа / CORS / таймаут — тихо
  } finally {
    clearTimeout(timer);
  }
}

// Google інколи повертає HTML-сутності (&#39; тощо) — декодуємо
function htmlDecode(s) {
  const ta = document.createElement('textarea');
  ta.innerHTML = s;
  return ta.value;
}

// Відсіюємо сміття:
//  - службові відповіді MyMemory про вичерпану квоту / помилку запиту
//  - «переклад», ідентичний оригіналу (заповнювати поле цим безглуздо)
//  - склейки двох алфавітів без пробілу («ДЖОКЕРcard») — у справжніх
//    укр. назвах кирилиця з латиницею не зливаються впритул
function looksLikeJunk(out, src) {
  if (/MYMEMORY WARNING|QUERY LENGTH|INVALID SOURCE|INVALID LANGUAGE|ALL AVAILABLE FREE TRANSLATIONS/i.test(out)) return true;
  if (out.toLowerCase() === src.toLowerCase()) return true;
  if (/[а-яіїєґ][a-z]|[a-z][а-яіїєґ]/i.test(out)) return true;
  return false;
}

// Укр. назви фільмів завжди починаються з великої літери, а перекладачі
// інколи віддають усе з малої («повзучість» → «Повзучість»). Піднімаємо
// першу ЛІТЕРУ (перед нею можуть стояти лапки/дужки/цифри — їх не чіпаємо).
function capitalizeFirst(s) {
  return s.replace(/^([^A-Za-zА-Яа-яІіЇїЄєҐґ]*)([A-Za-zА-Яа-яІіЇїЄєҐґ])/,
    (m, pre, ch) => pre + ch.toUpperCase());
}

export async function translateToUk(text) {
  const src = String(text || '').trim();
  if (!src || src.length > MAX_LEN) return null;
  if (/[а-яіїєґ]/i.test(src)) return null; // вже кирилиця — переклад не потрібен

  const key = src.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let out = null;

  // 1) Google Translate (gtx, dj=1 → { sentences: [{ trans }] })
  const g = await fetchJson(
    `https://translate.googleapis.com/translate_a/single?client=gtx&dj=1&sl=auto&tl=uk&dt=t&q=${encodeURIComponent(src)}`,
    4500
  );
  if (g && Array.isArray(g.sentences)) {
    const seg = g.sentences.map(s => (s && s.trans) || '').join('').trim();
    if (seg) out = htmlDecode(seg);
  }

  // 2) MyMemory — резерв
  if (!out) {
    const mm = await fetchJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(src)}&langpair=en|uk`,
      5000
    );
    const t = mm && mm.responseData && mm.responseData.translatedText;
    if (typeof t === 'string' && t.trim()) out = htmlDecode(t.trim());
  }

  if (!out || looksLikeJunk(out, src)) {
    cache.set(key, null); // невдалий результат теж кешуємо — не молотимо API
    return null;
  }

  out = capitalizeFirst(out);
  cache.set(key, out);
  return out;
}
