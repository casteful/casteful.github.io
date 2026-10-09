// ============================================================
// Автопереклад назв українською — безкоштовні публічні ендпоінти
// (без ключів, CORS відкритий обом):
//   1) Google Translate «dict-chrome-ex» (clients5.google.com) —
//      ендпоінт словника Chrome; авто-визначення мови, найкраща
//      якість (знає усталені укр. назви: «Втеча з Шоушенка»,
//      «Людина-павук: Дороги додому немає»);
//   2) MyMemory (api.mymemory.translated.net) — резерв, якщо
//      Google недоступний (ліміт/мережа).
// Назви короткі — квот вистачає; невдача теж кешується на сесію,
// щоб не спамити ендпоінти повторними запитами. Будь-яка помилка
// -> null: поле назви просто лишається порожнім, форма не ламається.
// ============================================================

const cache = new Map(); // текст -> переклад | '' (невдача)

export async function translateToUk(text) {
  const s = String(text || '').trim();
  // порожньо, вже кирилицею або без літер узагалі («1917», «9») —
  // перекладати нічого: Google для цифр повертає «1917 рік»
  if (!s || /[а-яіїєґ]/i.test(s) || !/[a-zа-яіїєґ]/i.test(s)) return null;
  if (cache.has(s)) return cache.get(s) || null;

  let out = (await viaGoogle(s)) || (await viaMyMemory(s));
  out = out ? out.trim() : null;
  // назви пишуться з великої літери: ендпоінти часто віддають
  // загальновживане слово з малої («вгору», «повзучість»)
  if (out) out = out.charAt(0).toUpperCase() + out.slice(1);
  cache.set(s, out || '');
  return out;
}

// [["Кінцевий пункт призначення","en"]] або [["сег1","en"],["сег2","en"]]
// -> рядок. Порожні сегменти ([[""]]) -> null (далі MyMemory).
function viaGoogle(s) {
  const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=uk&q=' + encodeURIComponent(s);
  return fetchJSON(url, 4500).then(data => {
    if (!Array.isArray(data)) return null;
    const parts = [];
    for (const row of data) {
      if (typeof row === 'string') parts.push(row);
      else if (Array.isArray(row) && typeof row[0] === 'string' && row[0]) parts.push(row[0]);
    }
    const joined = parts.join(' ').trim();
    return joined || null;
  }).catch(() => null);
}

// MyMemory: без авто-визначення мови (оригінали зазвичай англійською).
// Відповідь інколи містить банер-попередження замість перекладу — відсіюємо.
function viaMyMemory(s) {
  const url = 'https://api.mymemory.translated.net/get?langpair=en|uk&q=' + encodeURIComponent(s);
  return fetchJSON(url, 4500).then(r => {
    const t = r && r.responseData && r.responseData.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH|INVALID|QUOTA/i.test(t)) return null;
    return String(t);
  }).catch(() => null);
}

async function fetchJSON(url, timeoutMs) {
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
