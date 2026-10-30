// ============================================================
// Каталог клубу: єдиний знімок УСІХ колекцій у пам'яті.
// app.js на кожному снімку Firebase підгодовує його списками
// (setList), а командна палітра (palette.js) і клубна статистика
// (stats.js) читають звідси — замість того, щоб кожному модулю
// тримати власні копії масивів.
//
// Вузли бази: films/ (фільми + серіали за полем kind), games/,
// albums/, singles/, books/, comics/.
// ============================================================

import { TABS } from './tabs.js?v=6.4.1';
import { avg } from './utils.js?v=6.4.1';

const lists = { films: [], games: [], albums: [], singles: [], books: [], comics: [] };

// list === null (ще завантажується) — тримаємо порожній масив:
// палітра просто не показує записів, доки дані не прийдуть
export function setList(node, arr) {
  if (!(node in lists)) return;
  lists[node] = Array.isArray(arr) ? arr : [];
}

export function getList(node) { return lists[node] || []; }

// Головна назва: двомовні колекції (фільми/серіали/книги/комікси)
// читаються українською, музика й ігри — оригінальною назвою
function titleOf(rec, tab) {
  const t = TABS[tab] || {};
  if (t.uk) return rec.titleUk || rec.title || 'Без назви';
  return rec.title || rec.titleUk || 'Без назви';
}

// Другий рядок — оригінал, якщо він є і відрізняється від головної назви
function origOf(rec, tab) {
  const t = TABS[tab] || {};
  const main = titleOf(rec, tab);
  const other = t.uk ? rec.title : rec.titleUk;
  if (!other || other === main || other.toLowerCase() === String(main).toLowerCase()) return null;
  return other;
}

// Людина-автор запису: режисер (фільми), розробник (ігри),
// виконавець (музика), автор (книги/комікси)
function personOf(rec, tab) {
  if (tab === 'films' || tab === 'series') return rec.director || null;
  if (tab === 'games') return rec.developer || rec.publisher || null;
  if (tab === 'albums' || tab === 'singles') return rec.artist || null;
  return rec.author || null;
}

// Нормалізований запис для палітри
function normalize(rec, tab) {
  const t = TABS[tab] || { label: tab, icon: 'film' };
  const title = titleOf(rec, tab);
  const person = personOf(rec, tab);
  const a = avg(rec.ratings);
  const n = Object.values(rec.ratings || {}).filter(v => typeof v === 'number').length;
  // Рядок, у якому шукаємо: назви (обидві), людина, жанри, рік
  const hay = [
    title, origOf(rec, tab), person,
    (rec.genres || []).join(' '),
    rec.year != null ? String(rec.year) : ''
  ].filter(Boolean).join(' ').toLowerCase();
  return {
    id: rec.id,
    tab,                                 // куди переходити: films/series/albums/…
    group: t.label,
    icon: t.icon,
    title,
    orig: origOf(rec, tab),
    sub: person || '',
    year: rec.year || null,
    avg: a,
    n,
    hay
  };
}

// Усі записи клубу одним списком (палітра, підрахунки)
export function allItems() {
  const out = [];
  (lists.films || []).forEach(f => out.push(normalize(f, f.kind === 'series' ? 'series' : 'films')));
  ['albums', 'singles', 'books', 'comics'].forEach(node => {
    (lists[node] || []).forEach(m => out.push(normalize(m, node)));
  });
  (lists.games || []).forEach(g => out.push(normalize(g, 'games')));
  return out;
}

// Пошук по всіх колекціях: кожне слово запиту має зустрітися у
// рядку запису (назва/людина/жанри/рік). Ранжування: збіг назви
// на початку > збіг усередині назви > збіг в інших полях; далі —
// вища середня оцінка.
export function search(tokens) {
  const words = (Array.isArray(tokens) ? tokens : [tokens])
    .map(w => String(w || '').toLowerCase().trim()).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const it of allItems()) {
    let ok = true;
    for (const w of words) {
      if (!it.hay.includes(w)) { ok = false; break; }
    }
    if (!ok) continue;
    const title = it.title.toLowerCase();
    let score = 1;
    if (words.every(w => title.startsWith(w))) score = 3;
    else if (words.every(w => title.includes(w))) score = 2;
    scored.push({ it, score: score * 100 + (it.avg || 0) + Math.min(it.n, 5) });
  }
  return scored
    .sort((x, y) => y.score - x.score || x.it.title.localeCompare(y.it.title, 'uk'))
    .map(s => s.it);
}
