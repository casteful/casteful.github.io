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
import { suggestFilms, typeLabel, imdbTemporarilyDown } from './imdb.js';
import { searchWikiFilms, enrichByQid, fetchPoster, posterQuick } from './wiki.js';
import { enrichFilm } from './enrich.js';

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
//   4. Усе кешується: повторний запит тієї ж назви — миттєвий.
// ============================================================

const WIKI_DELAY_MS = 800;  // фори IMDb; потім вікі-пошук підключається завжди
const SUG_CACHE_MAX = 60;
const SUG_MAX = 24;         // максимум рядків у підказках (список скролиться)

const sugCache = new Map(); // ключ запиту -> Promise зі списком підказок

// «big bang theory 2007» -> назва «big bang theory» + рік 2007 окремо.
// Рік у кінці запиту — це побажання користувача, а не частина назви.
// Якщо шукати весь рядок як є, повнотекстовий пошук Вікіпедії згодом
// «сміттєві» збіги (списки епізодів, сезони, актори), а збіг за назвою
// губиться. Шукаємо лише за назвою, а рік використовуємо для ранжування
// та автозаповнення поля «Рік».
export function splitYear(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.{2,}?)[\s,–—-]+((?:18|19|20)\d{2})$/);
  if (m && m[1].trim().length >= 2) return { title: m[1].trim(), year: parseInt(m[2], 10) };
  return { title: s, year: null };
}

// Ранжування злитого списку:
//   1) точний збіг назви із запитом (укр. або англ.) — нагору;
//   2) збіг за префіксом/підрядком («the big bang theory» містить «big bang theory»);
//   3) рік, розпізнаний у запиті: збіг — бонус, сусідній рік — менший бонус,
//      явний розбіжний рік — штраф (напр., серіал 2017-го при запиті «... 2007»).
function scoreItem(it, normQ, yearHint) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const t = norm(it.title);
  const tu = norm(it.titleUk);
  let s = 0;
  if (normQ && normQ.length >= 3) {
    if (t === normQ || (tu && tu === normQ)) s = 100;
    else if (t === 'the' + normQ ||
             (t && t.includes(normQ)) ||
             (tu && tu.includes(normQ))) s = 70;
  }
  if (yearHint) {
    if (it.year === yearHint) s += 15;
    else if (it.year && Math.abs(it.year - yearHint) <= 1) s += 5;
    else if (it.year) s -= 10;
  }
  return s;
}

// Злиття результатів IMDb і Вікіпедії без дублікатів (за нормальною назвою).
// Дублікати доповнюють один одного: бракуючі поля першого елемента
// (постер, укр. назва, рік, режисер…) беруться з другого.
// Список ранжується за релевантністю: точні збіги назви + рік із запиту
// піднімаються нагору (напр., «The Big Bang Theory» (2007) при запиті
// «big bang theory 2007» — перший рядок, а не «Unaired Pilot»).
function mergeLists(imdbList, wikiList, query, yearHint) {
  const normQ = String(query || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const out = [];
  const idx = new Map();
  const idxUk = new Map(); // укр. назва -> позиція (міст IMDb↔uk.вікі)
  const key = it => String((it && it.title) || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const ukKey = it => String((it && it.titleUk) || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, '');
  const mergeInto = (keep, it) => {
    for (const f of ['poster', 'plot', 'year', 'director', 'runtime', 'imdbId', 'qid', 'titleUk', 'type']) {
      if (keep[f] == null && it[f] != null) keep[f] = it[f];
    }
    if ((!keep.genres || !keep.genres.length) && it.genres && it.genres.length) keep.genres = it.genres;
    if ((!keep.cast || !keep.cast.length) && it.cast && it.cast.length) keep.cast = it.cast;
  };
  const add = it => {
    if (!it || !it.title) return;
    const k = key(it);
    const ku = ukKey(it);
    let at = k ? idx.get(k) : undefined;
    // Вторинний міст: та сама укр. назва в IMDb- і uk.вікі-елемента,
    // якщо їхні англ. назви не збіглися (мітка Вікіданих відсутня).
    // Різні роки = різні фільми (ремейки) — не зливаємо.
    if (at === undefined && ku) {
      const atUk = idxUk.get(ku);
      if (atUk !== undefined) {
        const first = out[atUk];
        const conflict = first.year && it.year && first.year !== it.year;
        if (!conflict) at = atUk;
      }
    }
    if (at !== undefined) {
      mergeInto(out[at], it);
      return;
    }
    if (k) idx.set(k, out.length);
    if (ku) idxUk.set(ku, out.length);
    out.push(it);
  };
  (imdbList || []).forEach(add);
  (wikiList || []).forEach(add);
  // Ранжування замість простого зрізу: точні збіги + рік із запиту нагору
  return out
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const d = scoreItem(b.it, normQ, yearHint) - scoreItem(a.it, normQ, yearHint);
      return d !== 0 ? d : a.i - b.i; // стабільність: IMDb-порядок при рівній оцінці
    })
    .map(x => x.it)
    .slice(0, SUG_MAX);
}

function searchFilmsFast(rawQuery, onPartial) {
  // Рік у кінці запиту («big bang theory 2007») — шукаємо тільки за назвою,
  // а рік ідемо в ранжування та підстановку в поле «Рік»
  const { title: q, year: yearHint } = splitYear(rawQuery);
  if (q.length < 2) return Promise.resolve([]);

  const imdbDown = imdbTemporarilyDown();
  let imdbList = [];
  let wikiList = [];

  const paint = () => {
    const merged = mergeLists(imdbList, wikiList, q, yearHint);
    if (merged.length && typeof onPartial === 'function') onPartial(merged);
  };

  // IMDb стартує одразу і малюється, щойно відповів (навіть якщо вікі ще шукає)
  const imdbP = (imdbDown ? Promise.resolve([]) : suggestFilms(q).catch(() => []))
    .then(list => { imdbList = list || []; paint(); return imdbList; });

  // Вікіпедія: невелика затримка (щоб не спамити WMF на кожну літеру),
 // потім шукаємо ЗАВЖДИ і добудовуємо список поступово (onPartial)
  const wikiP = new Promise(res => setTimeout(res, imdbDown ? 0 : WIKI_DELAY_MS))
    .then(() => searchWikiFilms(q, partial => { wikiList = partial || []; paint(); }))
    .catch(() => []);

  return Promise.all([imdbP, wikiP])
    .then(([il, wl]) => { imdbList = il || []; wikiList = wl || []; })
    .then(() => mergeLists(imdbList, wikiList, q, yearHint));
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

  const { box, close, overlay } = openModal(formHTML(isEdit, film), {
    width: 640,
    label: isEdit ? 'Редагувати фільм' : 'Новий фільм'
  });

  const $ = id => box.querySelector('#' + id);
  const val = id => ($(id) ? $(id).value : '');
  const set = (id, v) => { if ($(id)) $(id).value = v ?? ''; };

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
  }

  // ---------- Автозаповнення (лише в режимі додавання) ----------
  const searchInput = $('fSearch');
  const sugList = $('suggestList');
  let sugItems = [];
  let sugIndex = -1;

  if (searchInput) {
    const note = (icon, text) => `<div class="s-note">${icon}<span>${text}</span></div>`;
    let searchGen = 0; // захист від перегонів повільних запитів
    let lastYearHint = null; // рік, розпізнаний у кінці запиту («... 2007»)
    const sourceBadge = s =>
      s.source === 'wiki' ? 'Вікіпедія'
      : s.source === 'wikidata' ? 'Вікідані'
      : '';

    searchInput.addEventListener('input', U.debounce(async () => {
      const raw = searchInput.value.trim();
      const parsed = splitYear(raw);
      lastYearHint = parsed.year;
      const q = parsed.title;
      if (q.length < 2) { hideSug(); return; }
      const gen = ++searchGen;
      sugList.hidden = false;
      sugList.innerHTML = note(icons.search, 'Шукаю…');

      const renderItems = (list) => {
        sugItems = list;
        sugIndex = -1;
        sugList.innerHTML = list.map((s, i) => `
          <button type="button" class="s-item" data-i="${i}">
            <span class="s-thumb">${icons.film}${s.poster
              ? `<img src="${U.escapeHtml(U.posterUrl(s.poster, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
              : ''}</span>
            <span class="s-text">
              <span class="s-name">${U.escapeHtml(s.titleUk || s.title)}</span>
              <span class="s-year">${[s.year || '', typeLabel(s.type), sourceBadge(s)].filter(Boolean).join(' · ')}</span>
            </span>
          </button>`).join('');
      };

      // Підказки без постера (часто — вікі/вікідані-результати): тихо підтягуємо
      // зображення в фоні, тільки швидкі джерела (IMDb за tt-ID / TVMaze).
      const fillMissingPosters = async (list) => {
        for (let i = 0; i < list.length && i < 12; i++) {
          const s = list[i];
          if (s.poster || (!s.imdbId && !s.title)) continue;
          if (gen !== searchGen || sugList.hidden) return;
          try {
            const url = await posterQuick({ imdbId: s.imdbId, title: s.title, year: s.year });
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
        items = await cachedSearch(raw, (partial) => {
          // Прогресивний малюнок: перші результати — одразу, поки
          // другий розділ Вікіпедії ще відповідає
          if (gen !== searchGen || sugList.hidden || !partial.length) return;
          renderItems(partial);
        });
      } catch (e) { items = []; }

      if (gen !== searchGen) return; // застарілий результат — ігноруємо
      if (!items.length) {
        sugList.innerHTML = note(icons.alert,
          'Нічого не знайдено на IMDb, у Вікіпедії та Вікіданих. Спробуйте іншу назву, іншу мову або заповніть поля вручну.');
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
    //  2) mousedown + preventDefault: десктоп (фокус лишається у полі).
    //  3) click: запасний варіант. pickOnce() захищає від подвійного вибору.
    sugList.addEventListener('touchend', (e) => {
      const item = e.target.closest('.s-item');
      if (!item) return;
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

    if (s.source === 'wiki' || s.source === 'wikidata') {
      // Результат із Вікіпедії/Вікіданих: укр. назва + оригінальна (якщо відрізняється)
      if (s.titleUk) set('fTitleUk', s.titleUk);
      if (s.title && (!s.titleUk || s.title.toLowerCase() !== s.titleUk.toLowerCase())) {
        set('fTitle', s.title);
      } else if (!val('fTitle')) {
        set('fTitle', s.titleUk || s.title);
      }
    } else {
      set('fTitle', s.title);
    }
    // Рік: із підказки, або — якщо користувач сам вказав рік у запиті
    // («... 2007») — із запиту
    if (!val('fYear')) set('fYear', s.year ?? lastYearHint ?? '');
    if (!val('fPoster') && s.poster) { set('fPoster', s.poster); showPoster(box, s.poster); }

    // Вікі-результат часто несе готові дані — заповнюємо решту полів
    if (s.director) fillIfEmpty('fDirector', s.director);
    if (s.cast && s.cast.length) fillIfEmpty('fCast', s.cast.join(', '));
    if (s.genres && s.genres.length) fillIfEmpty('fGenres', s.genres.join(', '));
    if (s.runtime) fillIfEmpty('fRuntime', s.runtime);
    if (s.plot) fillIfEmpty('fPlot', s.plot);

    const shownYear = s.year ?? lastYearHint;
    searchInput.value = `${s.titleUk || s.title}${shownYear ? ` (${shownYear})` : ''}`;
    hideSug();
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
      let d = {};
      if (picked.imdbId) {
        d = await enrichFilm({
          imdbId: picked.imdbId,
          title: picked.title,
          year: picked.year,
          titleUkHint: val('fTitleUk').trim() || null
        });
      } else {
        d = await enrichByQid(picked.qid);
      }
      // Знайшли IMDb ID через Wikidata — збережемо його разом із фільмом
      if (!picked.imdbId && d.imdbId) picked.imdbId = d.imdbId;
      fillIfEmpty('fTitleUk', d.titleUk);
      if (!val('fYear') && d.year) set('fYear', d.year);
      fillIfEmpty('fDirector', d.director);
      fillIfEmpty('fCast', (d.cast || []).join(', '));
      fillIfEmpty('fGenres', (d.genres || []).join(', '));
      fillIfEmpty('fRuntime', d.runtime);
      fillIfEmpty('fPlot', d.plot);
      if (!val('fPoster') && d.poster) { set('fPoster', d.poster); showPoster(box, d.poster); }

      // Постер усе ще порожній (en.Вікіпедія часто не віддає fair-use
      // постери) — шукаємо за ланцюжком IMDb tt-ID → Wikidata → Вікіпедія
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
      poster: val('fPoster').trim() || null,
      imdbId: (picked && picked.imdbId) || film?.imdbId || null,
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

    ${isEdit ? '' : `
    <label class="field">
      <span class="field-label">Пошук фільму</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="fSearch" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="search"
               placeholder="Почніть вводити назву — українською або англійською…">
        <div class="suggest-list" id="suggestList" hidden></div>
      </div>
      <span class="hint">Оберіть фільм або серіал зі списку — постер, рік і деталі підтягнуться автоматично. Шукаємо одночасно на IMDb і у Вікіпедії, тож результати зʼявляються швидко. Або просто заповніть поля нижче вручну.</span>
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
