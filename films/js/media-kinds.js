// ============================================================
// Спільна конфігурація колекцій «Альбоми» / «Сингли» / «Книги»:
// один масив використовують view (library.js) і форма
// (media-form.js) — щоб назви, вузли бази та іконки не роз'їжджалися.
// ============================================================

import { icons } from './ui.js?v=6.2';

export const MEDIA_KINDS = {
  album: {
    node: 'albums', kind: 'album', one: 'альбом', oneAcc: 'альбом', oneGen: 'альбому',
    addBtn: 'Додати альбом', newTitle: 'Новий альбом', editTitle: 'Редагувати альбом',
    searchPlaceholder: 'Пошук за назвою, виконавцем або жанром…',
    person: 'Виконавець', personPh: 'The Beatles',
    emptyTitle: 'Поки що немає жодного альбому',
    emptyText: 'Додайте перший альбом — почніть вводити назву, і обкладинка, виконавець, рік і трекліст підтягнуться з Вікіпедії.',
    icon: icons.album, sq: true, tracks: true
  },
  single: {
    node: 'singles', kind: 'single', one: 'сингл', oneAcc: 'сингл', oneGen: 'синглу',
    addBtn: 'Додати сингл', newTitle: 'Новий сингл', editTitle: 'Редагувати сингл',
    searchPlaceholder: 'Пошук за назвою, виконавцем або жанром…',
    person: 'Виконавець', personPh: 'The Weeknd',
    emptyTitle: 'Поки що немає жодного синглу',
    emptyText: 'Додайте перший сингл або пісню — почніть вводити назву, і обкладинка, виконавець і рік підтягнуться з Вікіпедії.',
    icon: icons.note, sq: true, tracks: false
  },
  book: {
    node: 'books', kind: 'book', one: 'книга', oneAcc: 'книгу', oneGen: 'книги',
    addBtn: 'Додати книгу', newTitle: 'Нова книга', editTitle: 'Редагувати книгу',
    searchPlaceholder: 'Пошук за назвою, автором або жанром…',
    person: 'Автор', personPh: 'Джордж Орвелл',
    emptyTitle: 'Поки що немає жодної книги',
    emptyText: 'Додайте першу книгу — почніть вводити назву, і обкладинка, автор, рік і опис підтягнуться з Вікіпедії.',
    icon: icons.book, sq: false, tracks: false
  }
};

export function mediaCfg(kind) { return MEDIA_KINDS[kind] || MEDIA_KINDS.album; }
