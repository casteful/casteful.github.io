// ============================================================
// Єдиний реєстр вкладок: назви, іконки, сімейства.
// З нього рендериться панель вкладок (app.js), беруться підписи
// для FAB («Додати …»), групи командної палітри (palette.js) та
// підписи колекцій у каталозі (catalog.js) — щоб ніде більше не
// роз'їжджалися назви вкладок і колекцій.
//
// acc — знахідний відмінок для FAB («Додати фільм/книгу/гру…»);
// uk  — двомовна колекція (головна назва — українська, як у фільмів);
// icon — ключ у об'єкті icons (ui.js).
// ============================================================

export const TABS = {
  films:   { label: 'Фільми',     acc: 'фільм',  icon: 'clapper', uk: true },
  series:  { label: 'Серіали',    acc: 'серіал', icon: 'film',    uk: true },
  albums:  { label: 'Альбоми',    acc: 'альбом', icon: 'album' },
  singles: { label: 'Сингли',     acc: 'сингл',  icon: 'note' },
  books:   { label: 'Книги',      acc: 'книгу',  icon: 'book',    uk: true },
  comics:  { label: 'Комікси',    acc: 'комікс', icon: 'comic',   uk: true },
  games:   { label: 'Ігри',       acc: 'гру',    icon: 'gamepad' },
  stats:   { label: 'Статистика', acc: 'фільм',  icon: 'chart' },
  quiz:    { label: 'Гра',        acc: 'фільм',  icon: 'spark' }
};

// Сімейства вкладок: у панелі між ними стоять роздільники, над
// групою — дрібний підпис (для однієї вкладки підпису немає).
export const FAMILIES = [
  { id: 'cinema', label: 'Кіно',    tabs: ['films', 'series'] },
  { id: 'music',  label: 'Музика',  tabs: ['albums', 'singles'] },
  { id: 'shelf',  label: 'Полиці',  tabs: ['books', 'comics'] },
  { id: 'play',   label: null,      tabs: ['games'] },
  { id: 'club',   label: 'Клуб',    tabs: ['stats', 'quiz'] }
];

// HTML панелі вкладок (index.html містить порожній <nav id="tabsNav">):
// <span class="tab-family"><span class="tf-label">Кіно</span>
//   <span class="tf-tabs"><button class="tab" data-tab="films">…</button>…</span></span>
// <span class="tab-sep"> між сімействами.
export function tabsNavHTML() {
  const parts = [];
  FAMILIES.forEach((f, i) => {
    if (i > 0) parts.push('<span class="tab-sep" aria-hidden="true"></span>');
    const btns = f.tabs.map(id => {
      const t = TABS[id] || { label: id };
      return `<button class="tab" data-tab="${id}" role="tab" aria-selected="false">${t.label}</button>`;
    }).join('');
    parts.push(
      `<span class="tab-family" data-family="${f.id}">` +
      (f.label ? `<span class="tf-label" aria-hidden="true">${f.label}</span>` : '') +
      `<span class="tf-tabs">${btns}</span></span>`
    );
  });
  return parts.join('');
}

// Порядок вкладок для палітри («Перейти: …») — бібліотеки, потім службові
export const TAB_ORDER = FAMILIES.flatMap(f => f.tabs);
