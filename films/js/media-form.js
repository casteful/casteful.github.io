// ============================================================
// Модальне вікно «Додати / Редагувати» для «Альбомів», «Синглів»,
// «Книг» і «Коміксів» (один універсальний модуль на чотири колекції):
//  - швидке автозаповнення з Вікіпедії/Вікіданих (media-lookup.js,
//    усе паралельно й поступово, як у фільмів та ігор)
//  - обкладинка, виконавець/автор, рік, жанри, трекліст, опис
//  - книги/комікси двомовні, як фільми: поле «Назва (українською)»
//    з автоперекладом (translate.js)
//  - «Ваша оцінка» одразу у формі (як у фільмів)
//  - збереження у вузол albums/ | singles/ | books/ | comics/ + пуш
// ============================================================

import * as store from './store.js?v=6.4.1';
import * as U from './utils.js?v=6.4.1';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=6.4.1';
import { searchMedia, enrichMedia, translateTitle } from './media-lookup.js?v=6.4.1';
import { mediaCfg } from './media-kinds.js?v=6.4.1';
import { notifyMediaAdded, notifyMediaDeleted, notifyMediaRatingSet, notifyMediaRatingRemoved } from './telegram.js?v=6.4.1';
import { rateTrailHTML, paintTrail, popValue } from './rating-ui.js?v=6.4.1';

const SUG_CACHE_MAX = 40;
const sugCache = new Map(); // `${kind}:${query}` -> Promise зі списком підказок

function cachedSearch(q, kind, onPartial) {
  const key = `${kind}:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  let p = sugCache.get(key);
  if (!p) {
    p = searchMedia(q, kind, onPartial);
    sugCache.set(key, p);
    if (sugCache.size > SUG_CACHE_MAX) {
      sugCache.delete(sugCache.keys().next().value);
    }
  }
  return p;
}

export function openFormModal({ kind = 'album', item = null, currentUserId, allItems = [] }) {
  const c = mediaCfg(kind);
  const isEdit = !!item;
  const printish = kind === 'book' || kind === 'comic'; // друкована продукція: автор, видавництво, сторінки
  let picked = null; // обраний запис із підказок

  // Оцінка одразу під час додавання/редагування (як у фільмів)
  const initialRating = (isEdit && item && item.ratings && typeof item.ratings[currentUserId] === 'number')
    ? item.ratings[currentUserId] : null;
  let formRating = initialRating;

  const { box, close } = openModal(formHTML(c, isEdit, item, !!currentUserId, initialRating), {
    width: 640,
    label: isEdit ? c.editTitle : c.newTitle
  });

  const $ = id => box.querySelector('#' + id);
  const val = id => ($(id) ? $(id).value : '');
  const set = (id, v) => { if ($(id)) $(id).value = v ?? ''; };

  if (item) {
    set('mTitle', item.title || item.titleUk || '');
    if (c.ukTitle) set('mTitleUk', item.titleUk || '');
    set('mYear', item.year || '');
    if (printish) set('mAuthor', item.author || '');
    else set('mArtist', item.artist || '');
    if (c.tracks) set('mTracks', (item.tracks || []).join('\n'));
    if (printish) {
      set('mPublisher', item.publisher || '');
      set('mPages', item.pages || '');
    }
    set('mGenres', (item.genres || []).join(', '));
    set('mPlot', item.plot || '');
    set('mCover', item.cover || '');
    if (item.cover) showCover(box, item.cover);
  }

  // ---------- Ваша оцінка одразу у формі ----------
  const rateBox = box.querySelector('#mRatingBox');
  if (rateBox) {
    rateBox.addEventListener('mouseover', (e) => {
      const seg = e.target.closest('.rt-seg');
      if (seg) paintTrail(rateBox, +seg.dataset.score);
    });
    rateBox.addEventListener('mouseout', (e) => {
      const seg = e.target.closest('.rt-seg');
      if (!seg) return;
      const to = e.relatedTarget;
      if (to && rateBox.contains(to) && to.closest('.rt-seg')) return;
      paintTrail(rateBox, formRating);
    });
    rateBox.addEventListener('click', (e) => {
      const seg = e.target.closest('.rt-seg');
      if (!seg) return;
      const score = +seg.dataset.score;
      formRating = (formRating === score) ? null : score;
      paintTrail(rateBox, formRating);
      if (formRating != null) popValue(rateBox);
      const rm = box.querySelector('#mRatingRemove');
      if (rm) rm.hidden = formRating == null;
    });
    const rmBtn = box.querySelector('#mRatingRemove');
    if (rmBtn) rmBtn.addEventListener('click', () => {
      formRating = null;
      paintTrail(rateBox, null);
      rmBtn.hidden = true;
    });
  }

  // ---------- Автозаповнення (лише в режимі додавання) ----------
  const searchInput = $('mSearch');
  const sugList = $('suggestList');
  let sugItems = [];
  let sugIndex = -1;

  if (searchInput) {
    const note = (icon, text) => `<div class="s-note">${icon}<span>${text}</span></div>`;
    let searchGen = 0;

    searchInput.addEventListener('input', U.debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { hideSug(); return; }
      const gen = ++searchGen;
      sugList.hidden = false;
      sugList.innerHTML = note(icons.search, 'Шукаю у Вікіпедії…');

      const renderItems = (list) => {
        sugItems = list;
        sugIndex = -1;
        const srcLabel = s => s.source === 'itunes' ? 'iTunes'
          : s.source === 'mb' ? 'MusicBrainz'
          : 'Вікіпедія';
        sugList.innerHTML = list.map((s, i) => {
          const main = U.stripDab(s.title || s.titleUk || '');
          const who = printish ? s.author : s.artist;
          const kindTag = kind === 'single' ? 'пісня' : kind === 'album' ? 'альбом' : '';
          const sub = [s.year || '', who || '', s.genres && s.genres.length ? s.genres.slice(0, 3).join(', ') : '']
            .filter(Boolean).join(' · ');
          return `
          <button type="button" class="s-item" data-i="${i}">
            <span class="s-thumb">${c.icon}${s.cover
              ? `<img src="${U.escapeHtml(U.posterUrl(s.cover, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
              : ''}${s.preview ? `<span class="s-prev-dot" title="Є 30-секундне прев'ю">♪</span>` : ''}</span>
            <span class="s-text">
              <span class="s-name">${U.escapeHtml(main)}</span>
              <span class="s-year">${[sub, kindTag, srcLabel(s)].filter(Boolean).join(' · ')}</span>
            </span>
          </button>`;
        }).join('') +
          (list.length > 7
            ? `<div class="s-foot">Усього ${list.length} ${U.plural(list.length, ['збіг', 'збіги', 'збігів'])} — гортайте список</div>`
            : '');
      };

      let items = [];
      try {
        items = await cachedSearch(q, kind, (partial) => {
          if (gen !== searchGen || sugList.hidden) return;
          if (partial && partial.length) renderItems(partial);
        });
      } catch (e) { items = []; }

      if (gen !== searchGen) return;
      if (!items.length) {
        sugList.innerHTML = note(icons.alert, `Нічого не знайдено у Вікіпедії. Спробуйте оригінальну назву ${c.oneGen} латиницею або заповніть поля вручну.`) +
          `<div class="s-retry"><button type="button" class="btn" id="mSugRetry">${icons.refresh}<span>Спробувати ще раз</span></button></div>`;
        const retry = sugList.querySelector('#mSugRetry');
        if (retry) retry.addEventListener('click', () => {
          sugCache.delete(`${kind}:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`);
          sugList.innerHTML = note(icons.search, 'Шукаю у Вікіпедії…');
          searchInput.dispatchEvent(new Event('input'));
        });
        return;
      }
      renderItems(items);
    }, 250));

    searchInput.addEventListener('keydown', (e) => {
      if (sugList.hidden) return;
      const its = sugList.querySelectorAll('.s-item');
      if (!its.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sugIndex = e.key === 'ArrowDown'
          ? Math.min(sugIndex + 1, its.length - 1)
          : Math.max(sugIndex - 1, 0);
        its.forEach((el, i) => el.classList.toggle('active', i === sugIndex));
        its[sugIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && sugIndex >= 0) {
        e.preventDefault();
        pickSuggestion(sugItems[sugIndex]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        hideSug();
      }
    });

    // Вибір підказки: touchend (iOS) -> mousedown -> click, pickOnce()
    // захищає від подвійного спрацювання — той самий патерн, що й у фільмів
    let touchX = 0, touchY = 0;
    sugList.addEventListener('touchstart', (e) => {
      const t = e.touches && e.touches[0];
      if (t) { touchX = t.clientX; touchY = t.clientY; }
    }, { passive: true });

    sugList.addEventListener('touchend', (e) => {
      const it = e.target.closest('.s-item');
      if (!it) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (t && (Math.abs(t.clientY - touchY) > 12 || Math.abs(t.clientX - touchX) > 12)) return;
      e.preventDefault();
      pickOnce(it);
    }, { passive: false });

    sugList.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.s-item');
      if (!it) return;
      e.preventDefault();
      pickOnce(it);
    });

    sugList.addEventListener('click', (e) => {
      const it = e.target.closest('.s-item');
      if (!it) return;
      pickOnce(it);
    });

    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae && sugList.contains(ae)) return;
        hideSug();
      }, 150);
    });
  }

  let lastPickAt = 0;
  function pickOnce(it) {
    const now = Date.now();
    if (now - lastPickAt < 350) return;
    lastPickAt = now;
    pickSuggestion(sugItems[+it.dataset.i]);
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

    // Явний вибір підказки замінює дані полів (як у фільмів/ігор —
    // так можна «перезібрати» неправильно доданий запис у режимі редагування).
    // Книги/комікси двомовні: укр. назва теж підтягується з підказки
    set('mTitle', U.stripDab(s.title || s.titleUk || ''));
    if (c.ukTitle && s.titleUk) set('mTitleUk', U.stripDab(s.titleUk));
    if (s.year != null) set('mYear', s.year);
    if (printish) {
      if (s.author) set('mAuthor', s.author);
    } else if (s.artist) set('mArtist', s.artist);
    if (c.tracks && s.tracks && s.tracks.length) set('mTracks', s.tracks.join('\n'));
    if (printish && s.publisher) set('mPublisher', s.publisher);
    if (s.genres && s.genres.length) set('mGenres', s.genres.join(', '));
    if (s.plot) set('mPlot', s.plot);
    if (s.cover) { set('mCover', s.cover); showCover(box, s.cover); }

    searchInput.value = `${U.stripDab(s.title || s.titleUk || '')}${s.year ? ` (${s.year})` : ''}`;
    hideSug();
    runEnrichment();
  }

  // ---------- Збагачення даними Вікіданих / Вікіпедії ----------
  let enriching = false;

  async function runEnrichment() {
    if (!picked || enriching) return;
    if (!picked.qid) return; // вручну заповнений запис — нічого добирати
    enriching = true;
    const st = $('enrichStatus');
    st.className = 'enrich-status show';
    st.textContent = 'Завантажую деталі з Вікіданих та Вікіпедії…';
    try {
      const d = await enrichMedia({
        qid: picked.qid,
        kind,
        title: picked.title,
        titleUk: picked.titleUk,
        year: U.intOrNull(val('mYear'), 1400, 2100) || picked.year || null,
        artist: picked.artist || null,
        author: picked.author || null,
        cover: picked.cover || null,
        preview: picked.preview || null,
        genres: picked.genres || [],
        tracks: picked.tracks || [],
        publisher: picked.publisher || null,
        pages: picked.pages || null
      });
      if (!val('mTitle') && (d.title || d.titleUk)) fillIfEmpty('mTitle', U.stripDab(d.title || d.titleUk));
      if (c.ukTitle) fillIfEmpty('mTitleUk', U.stripDab(d.titleUk));
      if (!val('mYear') && d.year) set('mYear', d.year);
      if (printish) {
        fillIfEmpty('mAuthor', d.author);
        fillIfEmpty('mPublisher', d.publisher);
        if (d.pages) fillIfEmpty('mPages', String(d.pages));
      } else {
        fillIfEmpty('mArtist', d.artist);
      }
      if (c.tracks && d.tracks && d.tracks.length) fillIfEmpty('mTracks', d.tracks.join('\n'));
      fillIfEmpty('mGenres', (d.genres || []).join(', '));
      if (d.plot) {
        const cur = val('mPlot').trim();
        const curUk = /[а-яіїєґ]/i.test(cur);
        const dUk = /[а-яіїєґ]/i.test(String(d.plot));
        if (!cur || (curUk && !dUk)) set('mPlot', d.plot);
      }
      if (!val('mCover') && d.cover) { set('mCover', d.cover); showCover(box, d.cover); }

      // УКР. НАЗВА ПЕРЕКЛАДОМ (книги/комікси): після всіх джерел
      // української назви досі немає — перекладаємо оригінал автоматично
      // (той самий механізм, що й у фільмів; рукописну назву не чіпаємо)
      let autoTranslated = false;
      if (c.ukTitle && !val('mTitleUk') && val('mTitle').trim()) {
        st.textContent = 'Перекладаю назву українською…';
        const tr = await translateTitle(val('mTitle').trim());
        // дослівний збіг («1984» -> «1984») — назвою не вважаємо
        if (tr && tr.toLowerCase() !== val('mTitle').trim().toLowerCase() && !val('mTitleUk')) {
          set('mTitleUk', tr);
          autoTranslated = true;
        }
      }

      const got = [d.artist, d.author, (d.genres || []).length, (d.tracks || []).length, d.plot, val('mCover'), val('mTitle'), val('mTitleUk')].some(Boolean);
      st.textContent = got
        ? (autoTranslated
          ? 'Готово — деталі підтягнуто. Укр. назву перекладено автоматично — перевірте й виправте за потреби.'
          : 'Готово — деталі підтягнуто. Перевірте й за потреби виправте поля.')
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

  // ---------- Прев'ю обкладинки ----------
  const coverInput = $('mCover');
  if (coverInput) {
    coverInput.addEventListener('change', () => {
      const u = coverInput.value.trim();
      if (u) showCover(box, u); else hideCover(box);
    });
  }

  // ---------- Видалення (в режимі редагування) ----------
  const delBtn = box.querySelector('[data-delete-media]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Видалити ${c.oneAcc}?`,
        text: `«${mTitle(item)}» та всі його оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteMedia(c.node, item.id);
        toast('Видалено');
        notifyMediaDeleted(currentUserId, item);
        close();
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити', 'err');
      }
    });
  }

  // ---------- Збереження ----------
  const form = $('mediaForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = val('mTitle').trim();
    const titleUk = val('mTitleUk').trim();
    if (c.ukTitle ? (!title && !titleUk) : !title) { toast(`Вкажіть назву ${c.oneGen}`, 'err'); return; }

    const tracks = c.tracks
      ? val('mTracks').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 40)
      : [];

    const data = {
      title: title || titleUk,
      // Книги/комікси — двомовні (як фільми): укр. назва зберігається;
      // в музики — null (на редагуванні затираємо старе значення)
      titleUk: c.ukTitle ? (titleUk || null) : null,
      kind, // пуші й глибокі лінки відновлюють рід із цього поля
      year: U.intOrNull(val('mYear'), 1400, 2100),
      cover: val('mCover').trim() || null,
      preview: (picked ? picked.preview : null) || (item ? item.preview : null) || null,
      qid: (picked ? picked.qid : null) || (item ? item.qid : null) || null,
      genres: U.parseGenres(val('mGenres')),
      plot: val('mPlot').trim() || null,
      wikiUrl: (picked ? picked.wikiUrl : null) || (item ? item.wikiUrl : null) || null
    };
    if (printish) {
      data.author = val('mAuthor').trim() || null;
      data.publisher = val('mPublisher').trim() || null;
      data.pages = U.intOrNull(val('mPages'), 1, 20000);
    } else {
      data.artist = val('mArtist').trim() || null;
      if (c.tracks) data.tracks = tracks;
    }

    if (!isEdit) {
      const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '');
      const dup = allItems.find(m =>
        (data.qid && m.qid && m.qid === data.qid) ||
        (norm(m.title) === norm(data.title) && m.year && data.year && m.year === data.year));
      if (dup) {
        const ok = await confirmDialog({
          title: `Цей запис уже є у списку`,
          text: `«${mTitle(dup)}» вже додано. Все одно додати ще раз?`,
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
        await store.updateMedia(c.node, item.id, data);
        // Оцінка, поставлена прямо у формі: якщо змінилася — зберігаємо
        // і надсилаємо Telegram-сповіщення (як у фільмів)
        const oldR = typeof initialRating === 'number' ? initialRating : null;
        if (currentUserId && formRating !== oldR) {
          await store.setMediaRating(c.node, item.id, currentUserId, formRating);
          const updated = { ...item, ratings: { ...(item.ratings || {}), [currentUserId]: formRating } };
          if (formRating == null) notifyMediaRatingRemoved(currentUserId, updated);
          else notifyMediaRatingSet(currentUserId, updated, formRating, oldR);
        }
        toast('Зміни збережено');
      } else {
        // Оцінка одразу в момент додавання: ratings заходить у сам запис,
        // щоб друзі побачили оцінку автора, щойно запис з'явиться
        const withRating = (formRating != null && currentUserId)
          ? { ...data, ratings: { [currentUserId]: formRating } }
          : data;
        const newId = await store.addMedia(c.node, { ...withRating, addedBy: currentUserId });
        toast(formRating != null ? `Додано · Ваша оцінка: ${formRating}` : 'Додано');
        notifyMediaAdded(currentUserId, { ...withRating, id: newId });
      }
      close();
    } catch (err) {
      console.error(err);
      toast('Помилка збереження: ' + ((err && (err.code || err.message)) || 'спробуйте ще раз'), 'err');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span>Зберегти</span>';
    }
  });

  function mTitle(m) { return m.title || m.titleUk || 'Без назви'; }
}

function showCover(box, url) {
  const img = box.querySelector('#mCoverPreview');
  if (!img) return;
  img.src = U.posterUrl(url, 300) || url;
  img.parentElement.classList.add('has-img');
  img.onerror = () => { img.parentElement.classList.remove('has-img'); img.removeAttribute('src'); };
}

function hideCover(box) {
  const img = box.querySelector('#mCoverPreview');
  if (!img) return;
  img.parentElement.classList.remove('has-img');
  img.removeAttribute('src');
}

function formHTML(c, isEdit, item, withRating = false, rating = null) {
  const kind = c.kind;
  const printish = kind === 'book' || kind === 'comic';
  const personInput = printish
    ? `<label class="field">
        <span class="field-label">Автор</span>
        <input id="mAuthor" type="text" placeholder="${c.personPh}" autocomplete="off">
      </label>`
    : `<label class="field">
        <span class="field-label">Виконавець / гурт</span>
        <input id="mArtist" type="text" placeholder="${c.personPh}" autocomplete="off">
      </label>`;

  const bookRow = printish
    ? `<label class="field">
        <span class="field-label">Видавництво</span>
        <input id="mPublisher" type="text" placeholder="Напр.: Penguin Books" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">Сторінок</span>
        <input id="mPages" type="number" min="1" max="20000" placeholder="328">
      </label>`
    : '';

  // Книги/комікси — двомовні, як фільми: укр. назва + оригінал поруч;
  // музика залишається з однією назвою (оригінальною)
  const titleFields = c.ukTitle
    ? `<label class="field">
        <span class="field-label">Назва (українською)</span>
        <input id="mTitleUk" type="text" placeholder="${kind === 'comic' ? 'Напр.: Акіра' : 'Напр.: Володар кілець'}">
      </label>
      <label class="field">
        <span class="field-label">Оригінальна назва</span>
        <input id="mTitle" type="text" placeholder="${kind === 'comic' ? 'Akira' : 'Nineteen Eighty-Four'}">
      </label>`
    : `<label class="field span-2">
        <span class="field-label">Назва</span>
        <input id="mTitle" type="text" placeholder="Abbey Road">
      </label>`;

  const tracksField = c.tracks
    ? `<label class="field span-2">
        <span class="field-label">Трекліст (один трек на рядок)</span>
        <textarea id="mTracks" rows="5" placeholder="1. Come Together&#10;2. Something&#10;3. Oh! Darling"></textarea>
        <span class="hint">Заповнюється автоматично після вибору альбому зі списку.</span>
      </label>`
    : '';

  return `
  <form id="mediaForm" novalidate>
    <div class="modal-head">
      <h2>${isEdit ? c.editTitle : c.newTitle}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    ${`
    <label class="field">
      <span class="field-label">Пошук ${c.oneGen}${isEdit ? ' — заміна даних' : ''}</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="mSearch" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="search"
               placeholder="Почніть вводити назву — українською або англійською…">
        <div class="suggest-list" id="suggestList" hidden></div>
      </div>
      <span class="hint">${isEdit
        ? `Оберіть правильний ${c.oneAcc} зі списку — назва, обкладинка, рік та інші поля буде замінено новими даними (оцінки залишаться).`
        : 'Оберіть запис зі списку — обкладинка, виконавець/автор, рік, жанри й опис підтягнуться автоматично з Вікіпедії та Вікіданих. Якщо українською не знаходиться — пробуємо англійську транслітерацію. Або просто заповніть поля нижче вручну.'}</span>
    </label>`}

    <div class="form-grid">
      ${titleFields}
      <label class="field">
        <span class="field-label">Рік</span>
        <input id="mYear" type="number" min="1400" max="2100" placeholder="${kind === 'book' ? '1949' : kind === 'comic' ? '1982' : '1969'}">
      </label>
      ${personInput}
      ${bookRow}
      <label class="field span-2">
        <span class="field-label">Жанри (через кому)</span>
        <input id="mGenres" type="text" placeholder="${kind === 'book' ? 'роман, антиутопія' : kind === 'comic' ? 'манґа, сьонен' : 'рок, поп'}">
      </label>
      ${tracksField}
    </div>

    <label class="field">
      <span class="field-label">Опис</span>
      <textarea id="mPlot" rows="4" placeholder="Короткий опис…"></textarea>
    </label>

    ${withRating ? `
    <div class="field form-rating" id="mRatingBox">
      <span class="field-label">Ваша оцінка</span>
      <div class="rt" role="group" aria-label="Ваша оцінка від 1 до 10">${rateTrailHTML(rating)}</div>
      <button type="button" class="remove-rating" id="mRatingRemove" ${rating == null ? 'hidden' : ''}>Прибрати оцінку</button>
      <span class="hint">Можна поставити одразу — друзі побачать оцінку, щойно запис з'явиться у списку.</span>
    </div>` : ''}

    <div class="poster-edit" id="coverEditBox">
      <div class="poster-preview"><img id="mCoverPreview" alt="Прев'ю обкладинки">${c.icon}</div>
      <label class="field grow">
        <span class="field-label">Посилання на обкладинку</span>
        <input id="mCover" type="url" placeholder="https://…">
        <span class="hint">Заповнюється автоматично після вибору зі списку.</span>
      </label>
    </div>

    <div class="enrich-status" id="enrichStatus"></div>

    <div class="modal-footer between">
      ${isEdit ? `<button type="button" class="btn danger-ghost" data-delete-media>${icons.trash}<span>Видалити</span></button>` : '<span></span>'}
      <span class="footer-actions">
        <button type="button" class="btn" data-close>Скасувати</button>
        <button type="submit" class="btn primary" data-save><span>Зберегти</span></button>
      </span>
    </div>
  </form>`;
}
