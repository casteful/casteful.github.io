// ============================================================
// Вкладка «Ігри»: конфігурація спільної фабрики collection-view.js.
// Той самий вигляд і потік, що й у фільмів (сітка/таблиця, пошук,
// сортування, швидке оцінювання, сповіщення), але дані живуть в
// окремому вузлі бази «games», а поля — ігрові.
// ============================================================

import { createCollectionView } from './collection-view.js';
import { openGameFormModal } from './game-form.js';

export const gamesView = createCollectionView({
  kind: 'game',
  node: 'games',
  showPremiere: false, // іграм достатньо року випуску
  openForm: ({ film, currentUserId, allFilms }) => openGameFormModal({ game: film, currentUserId, allGames: allFilms }),
  // «Головна людина» — розробник; додатковий список — платформи
  mainPerson: f => f.developer,
  extraList: f => f.platform || [],
  extraText: f => (f.platform || []).join(', '),
  searchHay: f => [f.title, f.titleUk, f.developer,
    ...(f.platform || []), ...(f.genres || [])],
  cardMeta: f => [f.year, (f.platform || []).join(' · ')],
  texts: {
    searchPlaceholder: 'Пошук за назвою або розробником…',
    searchAria: 'Пошук ігор',
    addBtn: 'Додати гру',
    errTitle: 'Не вдалося завантажити ігри',
    emptyTitle: 'Поки що немає жодної гри',
    emptyText: 'Додайте першу гру — назву, рік, розробника, платформи та обкладинку можна вписати вручну.',
    colTitle: 'Гра',
    colPerson: 'Розробник',
    colExtra: 'Платформи',
    colExtraNum: false,
    editAria: 'Редагувати гру',
    personPrefix: 'розроб. ',
    personChipTitle: 'Ігри цього розробника',
    genreChipTitle: 'Ігри цього жанру',
    extraLabel: 'Платформи:',
    extraChipTitle: 'Ігри цієї платформи',
    delTitle: 'Видалити гру?',
    deletedToast: 'Гру видалено',
    delFailToast: 'Не вдалося видалити гру'
  }
});
