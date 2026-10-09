// ============================================================
// Модальне вікно «Додати / Редагувати фільм»:
//  - швидке автозаповнення: IMDb і Вікіпедія шукають ПАРАЛЕЛЬНО
//  - автоматичне підтягування деталей (Wikidata + Вікіпедія)
//  - збереження в Firebase
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { suggestFilms, typeLabel, imdbTemporarilyDown, imdbById } from './imdb.js';
import { searchWikiFilms, fetchPoster, posterQuick, premiereInfo, cleanWikiTitle } from './wiki.js';
import { enrichFilm } from './enrich.js';
import { translateToUk } from './translate.js';
import { notifyFilmAdded, notifyFilmDeleted } from './telegram.js';

// ============================================================
// Швидкий пошук для автозаповнення (спільний між відкриттями).
//
// Стратегія «обидва джерела завжди»:
//   1. IMDb стартує одразу і малюється першим, щойно відповів.
//   2. Вікіпедія підключається через WIKI_DELAY_MS і ДОБУДОВУЄ список:
//      IMDb suggestion часто «не знає» серіалів і новинок або віддає
//      нерелевантні збіги за повної назви — тоді потрібний фільм/серіал
//      приходить саме з Вікіпедії.
//   3. Результати зливаються без дублікатів (IMDb зверху, збіги за
//      назвою доповнюють один одного: постер з IMDb + укр. назва з вікі).
//   4. Якщо запит кирилицею і знайдено замало — назва ТРАНСЛІТЕРУЄТЬСЯ
//      латиницею і пошук повторюється нею на IMDb та в en.Вікіпедії
//      («Інтерстеллар» → "Interstellar", «Джокер» → "Joker").
//   5. «Назва 2007» / «назва (2007)»: рік відділяється — IMDb шукає
//      повний запит (він розуміє рік), Вікіпедія — лише назву (рік у
//      повнотекстовому пошуку підіймає списки епізодів і сезони), а
//      результати з роком, що збігається, піднімаються нагору.
//   6. Усе кешується: повторний запит тієї ж назви — миттєвий.
// ============================================================

const WIKI_DELAY_MS = 800;  // фори IMDb; потім вікі-пошук підключається завжди
const SUG_CACHE_MAX = 60;
const SUG_MAX = 20;          // максимум рядків у підказках (список гортається)
const SUG_FALLBACK_MIN = 10; // знайдено менше — добираємо англійською транслітерацією

const sugCache = new Map(); // ключ запиту -> Promise зі списком підказок

// «big bang theory 2007» / «джокер (2019)» -> { title: '…', year: 2007 }.
// Рік наприкінці запиту — це побажання користувача, а не частина назви.
export function splitQueryYear(q) {
  const s = String(q || '').trim();
  const m = s.match(/^(.{2,}?)\s*[\(\[]?(\d{4})[\)\]]?\s*$/);
  if (!m) return { title: s, year: null };
  const y = parseInt(m[2], 10);
  if (y < 1888 || y > 2100) return { title: s, year: null };
  return { title: m[1].trim().replace(/[\(\[]$/, '').trim(), year: y };
}

// Злиття результатів IMDb і Вікіпедії без дублікатів (за нормальною назвою).
// Дублікати доповнюють один одного: бракуючі поля першого елемента
// (постер, укр. назва, рік, режисер…) беруться з другого.
// Точний збіг назви із запитом (напр., «Monster: The Ed Gein Story»)
// піднімається нагору — IMDb suggestion часто не знає серіалів, і
// потрібний результат приходить з Вікіпедії, але має бути першим.
// expectedYear: якщо користувач вказав рік («big bang theory 2007»),
// результати з таким роком також піднімаються (після точних збігів).
function mergeLists(imdbList, wikiList, query, expectedYear = null) {
  const normQ = String(query || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const out = [];
  const idx = new Map(); // нормалізована назва -> [позиції в out]
  const reg = (t, pos) => {
    if (!t) return;
    const arr = idx.get(t);
    if (arr) { if (!arr.includes(pos)) arr.push(pos); }
    else idx.set(t, [pos]);
  };
  const add = it => {
    if (!it || !it.title) return;
    // два ключі: оригінальна назва і укр. назва — "Interstellar" та
    // «Інтерстеллар» це той самий фільм, дублювати його не можна
    const k = norm(it.title);
    const ku = norm(it.titleUk);
    const y = it.year != null ? Number(it.year) : null;
    // Однойменні фільми РІЗНИХ років («Creep» 2014 і «Creep» 2004) —
    // це РІЗНІ фільми: зливаємо лише «той самий рік» або «запис без року».
    // Інакше IMDb давав Creep 2014 + Creep 2004 + Creep 1995, а в
    // підказках лишався один «Creep» — решта «проковтувалася» дедуплікацією.
    const findAt = t => {
      if (!t) return undefined;
      const positions = idx.get(t);
      if (!positions || !positions.length) return undefined;
      if (y != null) {
        const same = positions.find(p => Number(out[p].year) === y);
        if (same !== undefined) return same;
        return positions.find(p => out[p].year == null);
      }
      return positions[0];
    };
    let at = findAt(k);
    if (at === undefined) at = findAt(ku);
    if (at !== undefined) {
      const keep = out[at];
      for (const f of ['poster', 'plot', 'year', 'premiere', 'director', 'runtime', 'imdbId', 'qid', 'titleUk', 'type', 'enWikiTitle']) {
        if (keep[f] == null && it[f] != null) keep[f] = it[f];
      }
      if ((!keep.genres || !keep.genres.length) && it.genres && it.genres.length) keep.genres = it.genres;
      if ((!keep.cast || !keep.cast.length) && it.cast && it.cast.length) keep.cast = it.cast;
      reg(k, at);
      reg(ku, at);
      return;
    }
    const pos = out.length;
    reg(k, pos);
    reg(ku, pos);
    out.push(it);
  };
  (imdbList || []).forEach(add);
  (wikiList || []).forEach(add);
  let ordered = out;
  if (normQ && normQ.length >= 3) {
    const isExact = it => {
      const t = String(it.title || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
      const tu = String(it.titleUk || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
      return t === normQ || (tu && tu === normQ);
    };
    const exact = ordered.filter(isExact);
    if (exact.length && exact.length < ordered.length) {
      ordered = exact.concat(ordered.filter(it => !isExact(it)));
    }
  }
  if (expectedYear && ordered.length > 1) {
    const isY = it => Number(it.year) === expectedYear;
    if (ordered.some(isY) && !ordered.every(isY)) {
      ordered = ordered.filter(isY).concat(ordered.filter(it => !isY(it)));
    }
  }
  return ordered.slice(0, SUG_MAX);
}

function searchFilmsFast(q, onPartial) {
  const imdbDown = imdbTemporarilyDown();
  // Рік відділяємо одразу: IMDb шукає за повним запитом (він розуміє
  // «назва рік» і сам піднімає правильний результат), а Вікіпедія —
  // лише за назвою: рік у повнотекстовому пошуку спотворює видачу
  // («big bang theory 2007» підіймав «List of … episodes»).
  const { title: qTitle, year: qYear } = splitQueryYear(q);
  let imdbList = [];
  let wikiList = [];

  const paint = (status) => {
    const merged = mergeLists(imdbList, wikiList, q, qYear);
    if (typeof onPartial !== 'function') return;
    if (merged.length) onPartial(merged);
    else if (status) onPartial([], status);
  };

  // IMDb стартує одразу і малюється, щойно відповів (навіть якщо вікі ще шукає)
  const imdbP = (imdbDown ? Promise.resolve([]) : suggestFilms(q).catch(() => []))
    .then(list => { imdbList = list || []; paint(); return imdbList; });

  // Вікіпедія: невелика затримка (щоб не спамити WMF на кожну літеру),
  // потім шукаємо ЗАВЖДИ і добудовуємо список поступово (onPartial).
  // Якщо користувач вказав рік — повнотекстово шукаємо ЩЕ і «назва рік»:
  // «creep 2004» підіймає статтю «Creep (2004 film)», якої НЕМАЄ у топ-10
  // видачі за голою назвою (префіксний пошук при цьому лишається за назвою).
  const wikiP = new Promise(res => setTimeout(res, imdbDown ? 0 : WIKI_DELAY_MS))
    .then(() => searchWikiFilms(qTitle, partial => { wikiList = partial || []; paint(); },
      qYear ? { textQuery: q } : {}))
    .catch(() => []);

  return Promise.all([imdbP, wikiP])
    .then(async ([il, wl]) => {
      imdbList = il || [];
      wikiList = wl || [];
      paint();

      // Кириличний запит знайшов замало — добираємо англійською:
      // транслітеруємо назву БЕЗ року і шукаємо нею (IMDb + en.Вікіпедія).
      // Це дає результати для «Інтерстеллар», «Джокер», «Гладіатор» тощо,
      // які IMDb за кирилицею часто не знаходить узагалі.
      const variants = U.translitVariants(qTitle);
      if (variants.length && mergeLists(imdbList, wikiList, q, qYear).length < SUG_FALLBACK_MIN) {
        paint('Мало збігів — шукаю ще за англійською транслітерацією…');
        const [moreImdb, moreWiki] = await Promise.all([
          Promise.all(variants.map(v => suggestFilms(v).catch(() => [])))
            .then(lists => lists.flat()),
          Promise.all(variants.map(v => searchWikiFilms(v, null, { langs: ['en'] }).catch(() => [])))
            .then(lists => lists.flat())
        ]);
        imdbList = imdbList.concat(moreImdb);
        wikiList = wikiList.concat(moreWiki);
        paint();
      }
    })
    .then(() => mergeLists(imdbList, wikiList, q, qYear));
}

function cachedSearch(q, onPartial) {
  const key = q.trim().toLowerCase().replace(/\s+/g, ' ');
  let p = sugCache.get(key);
  if (!p) {
    p = searchFilmsFast(q, onPartial);
    sugCache.set(key, p);
    if (sugCache.size > SUG_CACHE_MAX) {
      sugCache.delete(sugCache.keys().next().value);
    }
  }
  return p;
}

export function openFormModal({ film = null, currentUserId, allFilms = [] }) {
  const isEdit = !!film;
  let picked = null; // обраний фільм з підказок IMDb
  // Прем'єра (повна дата «2007-09-24»), якщо вдалося дістати —
  // зберігається разом із фільмом і показується під полем «Рік»
  let pickedPremiere = (film && film.premiere) || null;

  const { box, close, overlay } = openModal(formHTML(isEdit, film), {
    width: 640,
    label: isEdit ? 'Редагувати фільм' : 'Новий фільм'
  });

  const $ = id => box.querySelector('#' + id);
  const val = id => ($(id) ? $(id).value : '');
  const set = (id, v) => { if ($(id)) $(id).value = v ?? ''; };

  // ---------- Автопереклад укр. назви ----------
  // Джерела (Вікідані, укр. вікі) не завжди мають готову укр. назву —
  // тоді перекладаємо оригінал машинно і тихо підставляємо в поле,
  // доки користувач не встиг увести своє. Офіційна uk-назва з Вікіданих
  // (titleUkAuto = машинний переклад) має право перезаписати його.
  let titleUkAuto = false;
  let tukGen = 0; // захист від перегонів кількох автоперекладів

  async function autoFillTitleUk(srcText) {
    const src = String(srcText || '').trim();
    if (!src) return;
    if (val('fTitleUk').trim()) return; // уже заповнено (вручну або з джерел)
    const gen = ++tukGen;
    const translated = await translateToUk(src);
    if (gen !== tukGen) return;             // почався новіший переклад
    if (val('fTitleUk').trim()) return;     // користувач випередив
    if (translated) {
      set('fTitleUk', translated);
      titleUkAuto = true;
    }
  }

  if (film) {
    set('fTitleUk', film.titleUk || '');
    set('fTitle', film.title || '');
    set('fYear', film.year || '');
    set('fDirector', film.director || '');
    set('fCast', (film.cast || []).join(', '));
    set('fGenres', (film.genres || []).join(', '));
    set('fRuntime', film.runtime || '');
    set('fPlot', film.plot || '');
    set('fPoster', film.poster || '');
    if (film.poster) showPoster(box, film.poster);
    if (film.premiere) showPremiereHint();
    // Старі фільми без укр. назви — одразу пропонуємо машинний переклад
    // (поле редаговане: користувач бачить його і може виправити)
    if (!film.titleUk && film.title) autoFillTitleUk(film.title);
  }

  // ---------- Автозаповнення (лише в режимі додавання) ----------
  const searchInput = $('fSearch');
  const sugList = $('suggestList');
  let sugItems = [];
  let sugIndex = -1;

  if (searchInput) {
    const note = (icon, text) => `<div class="s-note">${icon}<span>${text}</span></div>`;
    let searchGen = 0; // захист від перегонів повільних запитів

    searchInput.addEventListener('input', U.debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { hideSug(); return; }
      const gen = ++searchGen;
      sugList.hidden = false;
      sugList.innerHTML = note(icons.search, 'Шукаю…');

      const renderItems = (list) => {
        sugItems = list;
        sugIndex = -1;
        sugList.innerHTML = list.map((s, i) => {
          // Назва двомовною парою: осн. рядок — укр. назва, під ним —
          // оригінальна англійська (якщо відрізняється)
          const main = s.titleUk || s.title;
          const alt = (s.titleUk && s.title && s.titleUk !== s.title) ? s.title : '';
          return `
          <button type="button" class="s-item" data-i="${i}">
            <span class="s-thumb">${icons.film}${s.poster
              ? `<img src="${U.escapeHtml(U.posterUrl(s.poster, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
              : ''}</span>
            <span class="s-text">
              <span class="s-name">${U.escapeHtml(main)}</span>
              ${alt ? `<span class="s-orig">${U.escapeHtml(alt)}</span>` : ''}
              <span class="s-year">${[s.year || '', typeLabel(s.type), s.source === 'wiki' ? 'Вікіпедія' : ''].filter(Boolean).join(' · ')}</span>
            </span>
          </button>`;
        }).join('') +
          (list.length > 7
            ? `<div class="s-foot">Усього ${list.length} ${U.plural(list.length, ['збіг', 'збіги', 'збігів'])} — гортайте список</div>`
            : '');
      };

      // Підказки без постера: тихо підтягуємо зображення в фоні.
      // Джерела (швидкі): IMDb за tt-ID -> en.Вікіпедія за точною
      // назвою статті (pilicense=any віддає fair-use постери) -> TVMaze.
      const fillMissingPosters = async (list) => {
        for (let i = 0; i < list.length && i < 12; i++) {
          const s = list[i];
          if (s.poster || (!s.imdbId && !s.title)) continue;
          if (gen !== searchGen || sugList.hidden) return;
          try {
            const url = await posterQuick({ imdbId: s.imdbId, title: s.title, enWikiTitle: s.enWikiTitle, qid: s.qid, year: s.year });
            if (gen !== searchGen || sugList.hidden) return;
            if (!url) continue; // цього джерела немає — пробуємо наступний рядок
            s.poster = url;
            const thumb = sugList.querySelector(`.s-item[data-i="${i}"] .s-thumb`);
            if (thumb) {
              thumb.insertAdjacentHTML('beforeend', `<img src="${U.escapeHtml(U.posterUrl(url, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`);
            }
          } catch (e) { /* постер у підказці не критичний */ }
        }
      };

      let items = [];
      try {
        items = await cachedSearch(q, (partial, status) => {
          // Прогресивний малюнок: перші результати — одразу, поки
          // другий розділ Вікіпедії ще відповідає. status — повідомлення
          // міжфазного стану (напр., «шукаю транслітерацію…»).
          if (gen !== searchGen || sugList.hidden) return;
          if (!partial.length) {
            if (status) sugList.innerHTML = note(icons.search, status);
            return;
          }
          renderItems(partial);
        });
      } catch (e) { items = []; }

      if (gen !== searchGen) return; // застарілий результат — ігноруємо
      if (!items.length) {
        sugList.innerHTML = note(icons.alert, 'Нічого не знайдено — шукали на IMDb, у Вікіпедії та за англійською транслітерацією назви. Спробуйте оригінальну англійську назву або заповніть поля вручну.');
        return;
      }
      renderItems(items);
      fillMissingPosters(items);
    }, 220));

    searchInput.addEventListener('keydown', (e) => {
      if (sugList.hidden) return;
      const items = sugList.querySelectorAll('.s-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sugIndex = e.key === 'ArrowDown'
          ? Math.min(sugIndex + 1, items.length - 1)
          : Math.max(sugIndex - 1, 0);
        items.forEach((el, i) => el.classList.toggle('active', i === sugIndex));
        items[sugIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && sugIndex >= 0) {
        e.preventDefault();
        pickSuggestion(sugItems[sugIndex]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        hideSug();
      }
    });

    // Вибір підказки — три шари подій (порядок важливий для iPhone/iPad):
    //  1) touchend + preventDefault: на iOS саме це надійно працює.
    //     preventDefault НЕ дає зняти фокус із поля (інакше blur ховає
    //     список швидше, ніж встигає спрацювати тап) і не породжує
    //     примарні mouse-події, які ламають розкладку після iOS-зуму.
    //     Якщо користувач ГОРТАВ список (список тепер довгий) — тапу
    //     немає, вибір не спрацьовує (перевірка зсуву від touchstart).
    //  2) mousedown + preventDefault: десктоп (фокус лишається у полі).
    //  3) click: запасний варіант. pickOnce() захищає від подвійного вибору.
    let touchX = 0, touchY = 0;
    sugList.addEventListener('touchstart', (e) => {
      const t = e.touches && e.touches[0];
      if (t) { touchX = t.clientX; touchY = t.clientY; }
    }, { passive: true });

    sugList.addEventListener('touchend', (e) => {
      const item = e.target.closest('.s-item');
      if (!item) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (t && (Math.abs(t.clientY - touchY) > 12 || Math.abs(t.clientX - touchX) > 12)) return;
      e.preventDefault();
      pickOnce(item);
    }, { passive: false });

    sugList.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.s-item');
      if (!item) return;
      e.preventDefault();
      pickOnce(item);
    });

    sugList.addEventListener('click', (e) => {
      const item = e.target.closest('.s-item');
      if (!item) return;
      pickOnce(item);
    });

    // Ховаємо список при втраті фокусу, АЛЕ не тоді, коли фокус переходить
    // на саму підказку (на iPhone список зникав раніше, ніж встигали тапнути).
    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae && sugList.contains(ae)) return;
        hideSug();
      }, 150);
    });
  }

  // Один вибір за один жест (touchend іноді доопрацьовується click'ом)
  let lastPickAt = 0;
  function pickOnce(item) {
    const now = Date.now();
    if (now - lastPickAt < 350) return;
    lastPickAt = now;
    pickSuggestion(sugItems[+item.dataset.i]);
    // На дотик-пристроях навмисно знімаємо фокус: клавіатура ховається,
    // і користувач бачить заповнену форму (фокус ми утримали вище).
    if (searchInput && window.matchMedia('(pointer: coarse)').matches) {
      try { searchInput.blur(); } catch (e) { /* не критично */ }
    }
  }

  function hideSug() {
    if (sugList) { sugList.hidden = true; sugList.innerHTML = ''; }
    sugIndex = -1;
  }

  function pickSuggestion(s) {
    if (!s) return;
    picked = s;

    // ЯВНИЙ вибір підказки замінює дані полів (а не лише заповнює порожні):
    // так у режимі редагування можна «перезібрати» неправильно доданий
    // фільм — напр., замінити випадкові режисера/сюжет правильними.
    // Страховка від службових уточнень вікі-статей: у поля назв потрапляє
    // лише чиста назва («Creep», «Кріп»), без «(2004 film)» / «(фільм, 2004)».
    const tUk = s.titleUk ? cleanWikiTitle(s.titleUk).title : null;
    const tOrig = s.title ? cleanWikiTitle(s.title).title : null;
    if (tUk) set('fTitleUk', tUk);
    if (s.source === 'wiki') {
      if (tOrig && (!tUk || tOrig.toLowerCase() !== tUk.toLowerCase())) {
        set('fTitle', tOrig);
      } else {
        set('fTitle', tUk || tOrig);
      }
    } else {
      set('fTitle', tOrig || s.title);
    }
    if (s.year != null) set('fYear', s.year);
    pickedPremiere = s.premiere || null; showPremiereHint();
    if (s.poster) { set('fPoster', s.poster); showPoster(box, s.poster); }

    // Вікі-результат часто несе готові дані — перезаписуємо ними поля
    if (s.director) set('fDirector', s.director);
    if (s.cast && s.cast.length) set('fCast', s.cast.join(', '));
    if (s.genres && s.genres.length) set('fGenres', s.genres.join(', '));
    if (s.runtime) set('fRuntime', s.runtime);
    if (s.plot) set('fPlot', s.plot);

    searchInput.value = `${tUk || tOrig || s.title}${s.year ? ` (${s.year})` : ''}`;
    hideSug();
    // Укр. назви немає в жодному джерелі — автоматично перекладаємо
    // оригінал (якщо Wikidata потім знайде офіційну uk-назву, вона
    // перезапише машинний переклад у runEnrichment)
    if (!tUk) autoFillTitleUk(tOrig || s.title);
    runEnrichment();
  }

  // ---------- Збагачення даними з Wikidata / Вікіпедії ----------
  let enriching = false;

  async function runEnrichment() {
    if (!picked || enriching) return;
    if (!picked.imdbId && !picked.qid) return; // вручну заповнений фільм
    enriching = true;
    const st = $('enrichStatus');
    st.className = 'enrich-status show';
    st.textContent = 'Завантажую деталі з Wikidata та Вікіпедії…';
    try {
      // ПЕРЕВІРКА IMDb ID З ВІКІДАНИХ: там трапляються помилкові P345
      // («Monster: The Ed Gein Story» посилається на tt антології «Monster»,
      // бо на IMDb це сезон). Звіряємо еталонну назву tt-ID з IMDb: якщо
      // інша — ID хибний, відкидаємо і збагачуємо за QID Вікіданих.
      let droppedImdbId = null;
      if (picked.imdbId && picked.source === 'wiki') {
        try {
          const im = await imdbById(picked.imdbId);
          if (im && im.title) {
            const imT = U.normTitle(im.title);
            const cand = [picked.title, picked.titleUk].map(t => U.normTitle(t)).filter(Boolean);
            if (imT && cand.length && !cand.includes(imT)) {
              droppedImdbId = picked.imdbId;
              picked.imdbId = null;
            }
          }
        } catch (e) { /* IMDb недоступний — лишаємо ID як є */ }
      }

      let d = {};
      d = await enrichFilm({
        imdbId: picked.imdbId || null,
        qid: picked.qid || null,
        title: picked.title,
        year: U.intOrNull(val('fYear'), 1888, 2100) || picked.year || null,
        titleUkHint: val('fTitleUk').trim() || null
      });
      // Знайшли IMDb ID через Wikidata — збережемо його разом із фільмом,
      // АЛЕ не повертаємо щойно відкинутий помилковий
      if (!picked.imdbId && d.imdbId && d.imdbId !== droppedImdbId) picked.imdbId = d.imdbId;
      // Офіційна укр. назва з Вікіданих сильніша за машинний переклад:
      // перезаписуємо нею й автопереклад, якщо він уже встиг підставитись
      if (d.titleUk && (titleUkAuto || !val('fTitleUk').trim())) {
        set('fTitleUk', cleanWikiTitle(d.titleUk).title);
        titleUkAuto = false;
      }
      // Досі порожньо — перекладаємо оригінальну назву автоматично
      if (!val('fTitleUk').trim()) autoFillTitleUk(val('fTitle').trim() || picked.title);
      // d.titleEn — зі СПАРКЛ-резерву; d.title — зі швидкого шляху (en мітка).
      // cleanWikiTitle — страховка від статтєвих суфіксів «(2004 film)»
      if (!val('fTitle')) fillIfEmpty('fTitle', cleanWikiTitle(d.titleEn || d.title).title);
      if (!val('fYear') && d.year) set('fYear', d.year);
      if (d.premiere && !pickedPremiere) { pickedPremiere = d.premiere; showPremiereHint(); }
      fillIfEmpty('fDirector', d.director);
      fillIfEmpty('fCast', (d.cast || []).join(', '));
      fillIfEmpty('fGenres', (d.genres || []).join(', '));
      fillIfEmpty('fRuntime', d.runtime);
      if (d.plot) {
        // Дані англійською: якщо в полі український опис (з укр. статті
        // підказки), а збагачення принесло англійський — підмінюємо;
        // порожнє поле просто заповнюємо; англ. не змінюємо.
        const cur = val('fPlot').trim();
        const curUk = /[а-яіїєґ]/i.test(cur);
        const dUk = /[а-яіїєґ]/i.test(String(d.plot));
        if (!cur || (curUk && !dUk)) set('fPlot', d.plot);
      }
      if (!val('fPoster') && d.poster) { set('fPoster', d.poster); showPoster(box, d.poster); }

      // Постер усе ще порожній — шукаємо за ланцюжком IMDb tt-ID →
      // Wikidata sitelinks (en перша) → TVMaze → Вікіпедія (en → uk → ru)
      if (!val('fPoster')) {
        st.textContent = 'Шукаю постер…';
        try {
          const poster = await fetchPoster({
            imdbId: picked.imdbId || d.imdbId || null,
            title: val('fTitle').trim() || picked.title || null,
            titleUk: val('fTitleUk').trim() || d.titleUk || picked.titleUk || null,
            year: val('fYear') || d.year || picked.year || null
          });
          if (poster) { set('fPoster', poster); showPoster(box, poster); }
        } catch (e) { /* постер не критичний */ }
      }

      // РІК/ПРЕМ'ЄРА СЕРІАЛУ: у Wikidata P577 у серіалів часто порожній,
      // а TVMaze зберігає ПОВНУ дату виходу («2007-09-24»). Якщо рік досі
      // порожній — заповнюємо його прем'єрою; для серіалів одразу показуємо
      // і точну дату під полем «Рік».
      if (!val('fYear') || picked.type === 'tvSeries' || picked.type === 'tvMiniSeries') {
        try {
          const info = await premiereInfo({
            imdbId: picked.imdbId || d.imdbId || null,
            title: val('fTitle').trim() || picked.title || null,
            titleUk: val('fTitleUk').trim() || d.titleUk || picked.titleUk || null,
            year: picked.year || d.year || null
          });
          if (info) {
            if (!val('fYear') && info.year) set('fYear', String(info.year));
            if (info.date && !pickedPremiere) { pickedPremiere = info.date; showPremiereHint(); }
            // TVMaze знає правильний IMDb ID навіть коли у Вікіданнах
            // помилковий/відсутній — але не повертаємо відкинутий
            if (!picked.imdbId && info.imdbId && info.imdbId !== droppedImdbId) picked.imdbId = info.imdbId;
          }
        } catch (e) { /* прем'єра не критична */ }
      }

      const got = [d.titleUk, d.director, (d.genres || []).length, d.runtime, d.plot, val('fPoster')].some(Boolean);
      st.textContent = got
        ? 'Готово — деталі підтягнуто. Перевірте й за потреби виправте поля.'
        : 'Додаткові дані не знайдено — заповніть поля вручну.';
    } catch (e) {
      st.textContent = 'Не вдалося отримати додаткові дані — заповніть поля вручну.';
    }
    enriching = false;
  }

  function fillIfEmpty(id, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    if (!val(id)) set(id, v);
  }

  // Підпис «Прем'єра: 24 вересня 2007» під полем «Рік» — з'являється,
  // коли вдалося дістати повну дату виходу (Wikidata або TVMaze)
  function showPremiereHint() {
    const el = $('premiereHint');
    if (!el) return;
    const txt = U.fmtPremiere(pickedPremiere);
    if (txt) { el.textContent = `Прем'єра: ${txt}`; el.hidden = false; }
    else el.hidden = true;
  }

  // ---------- Прев'ю постера ----------
  const posterInput = $('fPoster');
  if (posterInput) {
    posterInput.addEventListener('change', () => {
      const u = posterInput.value.trim();
      if (u) showPoster(box, u); else hidePoster(box);
    });
  }

  // ---------- Видалення (в режимі редагування) ----------
  const delBtn = box.querySelector('[data-delete-film]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Видалити фільм?',
        text: `«${fTitle(film)}» та всі його оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteFilm(film.id);
        toast('Фільм видалено');
        notifyFilmDeleted(currentUserId, fTitle(film));
        close();
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити фільм', 'err');
      }
    });
  }

  // ---------- Збереження ----------
  const form = $('filmForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titleUk = val('fTitleUk').trim();
    const title = val('fTitle').trim();
    if (!titleUk && !title) { toast('Вкажіть назву фільму', 'err'); return; }

    const data = {
      title: title || titleUk,
      titleUk: titleUk || null,
      year: U.intOrNull(val('fYear'), 1888, 2100),
      premiere: pickedPremiere || null,
      poster: val('fPoster').trim() || null,
      // перезапис значенням нової підказки, якщо вона була; в іншому
      // разі лишаємо старий imdbId (режим редагування без вибору)
      imdbId: (picked ? picked.imdbId : null) || (film ? film.imdbId : null) || null,
      director: val('fDirector').trim() || null,
      cast: U.parseGenres(val('fCast')),
      genres: U.parseGenres(val('fGenres')),
      runtime: U.intOrNull(val('fRuntime'), 1, 1200),
      plot: val('fPlot').trim() || null
    };

    if (!isEdit) {
      const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '');
      const dup = allFilms.find(f =>
        (data.imdbId && f.imdbId === data.imdbId) ||
        (norm(f.title) === norm(data.title) && f.year && data.year && f.year === data.year));
      if (dup) {
        const ok = await confirmDialog({
          title: 'Цей фільм уже є у списку',
          text: `«${fTitle(dup)}» вже додано. Все одно додати ще раз?`,
          confirmText: 'Все одно додати'
        });
        if (!ok) return;
      }
    }

    const saveBtn = box.querySelector('[data-save]');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span><span>Зберігаю…</span>';
    try {
      if (isEdit) {
        await store.updateFilm(film.id, data);
        toast('Зміни збережено');
      } else {
        await store.addFilm({ ...data, addedBy: currentUserId });
        toast('Фільм додано');
        notifyFilmAdded(currentUserId, data);
      }
      close();
    } catch (err) {
      console.error(err);
      toast('Помилка збереження: ' + ((err && (err.code || err.message)) || 'спробуйте ще раз'), 'err');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span>Зберегти</span>';
    }
  });

  function fTitle(f) { return f.titleUk || f.title || 'Без назви'; }
}

function showPoster(box, url) {
  const img = box.querySelector('#fPosterPreview');
  if (!img) return;
  img.src = U.posterUrl(url, 300) || url;
  img.parentElement.classList.add('has-img');
  img.onerror = () => { img.parentElement.classList.remove('has-img'); img.removeAttribute('src'); };
}

function hidePoster(box) {
  const img = box.querySelector('#fPosterPreview');
  if (!img) return;
  img.parentElement.classList.remove('has-img');
  img.removeAttribute('src');
}

function formHTML(isEdit, film) {
  return `
  <form id="filmForm" novalidate>
    <div class="modal-head">
      <h2>${isEdit ? 'Редагувати фільм' : 'Новий фільм'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    ${`
    <label class="field">
      <span class="field-label">Пошук фільму${isEdit ? ' — заміна даних' : ''}</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="fSearch" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="search"
               placeholder="Почніть вводити назву — українською або англійською…">
        <div class="suggest-list" id="suggestList" hidden></div>
      </div>
      <span class="hint">${isEdit
        ? 'Оберіть правильний фільм зі списку — назва, постер, рік, режисер, опис та інші поля буде замінено новими даними (оцінки залишаться).'
        : 'Оберіть фільм або серіал зі списку — постер, рік і деталі підтягнуться автоматично. Показуємо всі збіги з IMDb та Вікіпедії (список гортається); якщо українською не знаходиться — пробуємо англійську транслітерацію. Або просто заповніть поля нижче вручну.'}</span>
    </label>`}

    <div class="form-grid">
      <label class="field">
        <span class="field-label">Назва (українською)</span>
        <input id="fTitleUk" type="text" placeholder="Напр.: Втеча з Шоушенка">
      </label>
      <label class="field">
        <span class="field-label">Оригінальна назва</span>
        <input id="fTitle" type="text" placeholder="The Shawshank Redemption">
      </label>
      <label class="field">
        <span class="field-label">Рік</span>
        <input id="fYear" type="number" min="1888" max="2100" placeholder="1994">
        <span class="hint" id="premiereHint" hidden></span>
      </label>
      <label class="field">
        <span class="field-label">Тривалість, хв</span>
        <input id="fRuntime" type="number" min="1" max="1200" placeholder="142">
      </label>
      <label class="field span-2">
        <span class="field-label">Режисер</span>
        <input id="fDirector" type="text" placeholder="Френк Дарабонт">
      </label>
      <label class="field span-2">
        <span class="field-label">Актори (через кому)</span>
        <input id="fCast" type="text" placeholder="Тім Роббінс, Морган Фрімен">
      </label>
      <label class="field span-2">
        <span class="field-label">Жанри (через кому)</span>
        <input id="fGenres" type="text" placeholder="драма, кримінал">
      </label>
    </div>

    <label class="field">
      <span class="field-label">Опис</span>
      <textarea id="fPlot" rows="4" placeholder="Короткий опис або сюжет…"></textarea>
    </label>

    <div class="poster-edit" id="posterEditBox">
      <div class="poster-preview"><img id="fPosterPreview" alt="Прев'ю постера">${icons.film}</div>
      <label class="field grow">
        <span class="field-label">Посилання на постер</span>
        <input id="fPoster" type="url" placeholder="https://…">
        <span class="hint">Заповнюється автоматично після вибору фільму зі списку.</span>
      </label>
    </div>

    <div class="enrich-status" id="enrichStatus"></div>

    <div class="modal-footer between">
      ${isEdit ? `<button type="button" class="btn danger-ghost" data-delete-film>${icons.trash}<span>Видалити</span></button>` : '<span></span>'}
      <span class="footer-actions">
        <button type="button" class="btn" data-close>Скасувати</button>
        <button type="submit" class="btn primary" data-save><span>Зберегти</span></button>
      </span>
    </div>
  </form>`;
}
