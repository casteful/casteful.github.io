// ============================================================
// Вкладка «Фільми»: конфігурація спільної фабрики collection-view.js.
// Уся поведінка (сітка/таблиця, пошук, сортування, оцінки, модалка)
// живе у фабриці — тут лише тексти та поля, специфічні для фільмів.
// ============================================================

import { createCollectionView } from './collection-view.js';
import { openFormModal } from './film-form.js';

export const filmsView = createCollectionView({
  kind: 'film',
  node: 'films',
  showPremiere: true, // у фільмів відома повна дата прем'єри
  openForm: ({ film, currentUserId, allFilms }) => openFormModal({ film, currentUserId, allFilms }),
  // «Головна людина» картки/модалки — режисер; додатковий список — актори
  mainPerson: f => f.director,
  extraList: f => f.cast || [],
  extraText: f => (f.runtime != null ? String(f.runtime) : ''),
  searchHay: f => [f.title, f.titleUk, f.director, f.country, f.season,
    ...(f.genres || []), ...(f.cast || [])],
  cardMeta: f => [f.year, f.runtime ? `${f.runtime} хв` : ''],
  texts: {
    searchPlaceholder: 'Пошук за назвою або режисером…',
    searchAria: 'Пошук фільмів',
    addBtn: 'Додати фільм',
    errTitle: 'Не вдалося завантажити фільми',
    emptyTitle: 'Поки що немає жодного фільму',
    emptyText: 'Додайте перший фільм — почніть вводити назву, і ми підтягнемо постер та деталі з IMDb.',
    colTitle: 'Фільм',
    colPerson: 'Режисер',
    colExtra: 'Хв',
    colExtraNum: true,
    editAria: 'Редагувати фільм',
    personPrefix: 'реж. ',
    personChipTitle: 'Фільми цього режисера',
    genreChipTitle: 'Фільми цього жанру',
    extraLabel: 'У ролях:',
    extraChipTitle: 'Фільми з цим актором',
    delTitle: 'Видалити фільм?',
    deletedToast: 'Фільм видалено',
    delFailToast: 'Не вдалося видалити фільм'
  }
});
