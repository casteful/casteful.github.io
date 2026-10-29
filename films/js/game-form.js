// ============================================================
// Модальне вікно «Додати / Редагувати гру»:
//  - автозаповнення з Вікіпедії/Вікіданих (без ключів і OAuth)
//  - обкладинка, рік, розробник, видавець, платформи, жанри, сюжет
//  - збереження у вузол games/ + Telegram-сповіщення
// ============================================================

import { USERS } from './config.js?v=5.1';
import * as store from './store.js?v=5.1';
import * as U from './utils.js?v=5.1';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=5.1';
import { searchGames, enrichGame, translateTitle } from './game-lookup.js?v=5.1';
import { notifyGameAdded, notifyGameDeleted } from './telegram.js?v=5.1';

const SUG_CACHE_MAX = 40;
const sugCache = new Map();

function cachedSearch(q, onPartial) {
  const key = q.trim().toLowerCase().replace(/\s+/g, ' ');
  let p = sugCache.get(key);
  if (!p) {
    p = searchGames(q, onPartial);
    sugCache.set(key, p);
    if (sugCache.size > SUG_CACHE_MAX) {
      sugCache.delete(sugCache.keys().next().value);
    }
  }
  return p;
}

export function openFormModal({ game = null, currentUserId, allGames = [] }) {
  const isEdit = !!game;
  let picked = null; // обрана гра з підказок

  const { box, close, overlay } = openModal(formHTML(isEdit, game), {
    width: 640,
    label: isEdit ? 'Редагувати гру' : 'Нова гра'
  });

  const $ = id => box.querySelector('#' + id);
  const val = id => ($(id) ? $(id).value : '');
  const set = (id, v) => { if ($(id)) $(id).value = v ?? ''; };

  if (game) {
    set('gTitleUk', game.titleUk || '');
    set('gTitle', game.title || '');
    set('gYear', game.year || '');
    set('gDeveloper', game.developer || '');
    set('gPublisher', game.publisher || '');
    set('gPlatforms', (game.platforms || []).join(', '));
    set('gGenres', (game.genres || []).join(', '));
    set('gPlot', game.plot || '');
    set('gCover', game.cover || '');
    if (game.cover) showCover(box, game.cover);
  }

  // ---------- Автозаповнення (лише в режимі додавання) ----------
  const searchInput = $('gSearch');
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
        sugList.innerHTML = list.map((s, i) => {
          const main = U.stripDab(s.titleUk || s.title);
          const altRaw = (s.titleUk && s.title) ? U.stripDab(s.title) : '';
          const alt = altRaw && altRaw !== main ? altRaw : '';
          const sub = [s.year || '', s.developer || '', s.platforms && s.platforms.length ? s.platforms.slice(0, 3).join(', ') : '']
            .filter(Boolean).join(' · ');
          return `
          <button type="button" class="s-item" data-i="${i}">
            <span class="s-thumb">${icons.gamepad}${s.cover
              ? `<img src="${U.escapeHtml(U.posterUrl(s.cover, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
              : ''}</span>
            <span class="s-text">
              <span class="s-name">${U.escapeHtml(main)}</span>
              ${alt ? `<span class="s-orig">${U.escapeHtml(alt)}</span>` : ''}
              <span class="s-year">${sub || 'Вікіпедія'}</span>
            </span>
          </button>`;
        }).join('') +
          (list.length > 7
            ? `<div class="s-foot">Усього ${list.length} ${U.plural(list.length, ['збіг', 'збіги', 'збігів'])} — гортайте список</div>`
            : '');
      };

      let items = [];
      try {
        items = await cachedSearch(q, (partial) => {
          if (gen !== searchGen || sugList.hidden) return;
          if (partial && partial.length) renderItems(partial);
        });
      } catch (e) { items = []; }

      if (gen !== searchGen) return;
      if (!items.length) {
        sugList.innerHTML = note(icons.alert, 'Нічого не знайдено у Вікіпедії. Спробуйте оригінальну англійську назву гри або заповніть поля вручну.');
        return;
      }
      renderItems(items);
    }, 250));

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

    // Вибір підказки: touchend (iOS) -> mousedown -> click, pickOnce()
    // захищає від подвійного спрацювання — той самий патерн, що й у фільмів
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

    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae && sugList.contains(ae)) return;
        hideSug();
      }, 150);
    });
  }

  let lastPickAt = 0;
  function pickOnce(item) {
    const now = Date.now();
    if (now - lastPickAt < 350) return;
    lastPickAt = now;
    pickSuggestion(sugItems[+item.dataset.i]);
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

    // Явний вибір підказки замінює дані полів (як у фільмів — так можна
    // «перезібрати» неправильно додану гру в режимі редагування)
    if (s.titleUk) set('gTitleUk', U.stripDab(s.titleUk));
    const cleanOrig = U.stripDab(s.title);
    const cleanUk = U.stripDab(s.titleUk);
    if (s.title && (!s.titleUk || s.title.toLowerCase() !== s.titleUk.toLowerCase())) {
      set('gTitle', cleanOrig);
    } else {
      set('gTitle', cleanUk || cleanOrig);
    }
    if (s.year != null) set('gYear', s.year);
    if (s.developer) set('gDeveloper', s.developer);
    if (s.publisher) set('gPublisher', s.publisher);
    if (s.platforms && s.platforms.length) set('gPlatforms', s.platforms.join(', '));
    if (s.genres && s.genres.length) set('gGenres', s.genres.join(', '));
    if (s.plot) set('gPlot', s.plot);
    if (s.cover) { set('gCover', s.cover); showCover(box, s.cover); }

    searchInput.value = `${U.stripDab(s.titleUk || s.title)}${s.year ? ` (${s.year})` : ''}`;
    hideSug();
    runEnrichment();
  }

  // ---------- Збагачення даними Вікіданих / Вікіпедії ----------
  let enriching = false;

  async function runEnrichment() {
    if (!picked || enriching) return;
    if (!picked.qid) return; // вручну заповнена гра — нічого добирати
    enriching = true;
    const st = $('enrichStatus');
    st.className = 'enrich-status show';
    st.textContent = 'Завантажую деталі з Вікіданих та Вікіпедії…';
    try {
      const d = await enrichGame({
        qid: picked.qid,
        title: picked.title,
        titleUk: picked.titleUk,
        year: U.intOrNull(val('gYear'), 1958, 2100) || picked.year || null
      });
      fillIfEmpty('gTitleUk', U.stripDab(d.titleUk));
      if (!val('gTitle')) fillIfEmpty('gTitle', U.stripDab(d.title));
      if (!val('gYear') && d.year) set('gYear', d.year);
      fillIfEmpty('gDeveloper', d.developer);
      fillIfEmpty('gPublisher', d.publisher);
      fillIfEmpty('gPlatforms', (d.platforms || []).join(', '));
      fillIfEmpty('gGenres', (d.genres || []).join(', '));
      if (d.plot) {
        const cur = val('gPlot').trim();
        const curUk = /[а-яіїєґ]/i.test(cur);
        const dUk = /[а-яіїєґ]/i.test(String(d.plot));
        if (!cur || (curUk && !dUk)) set('gPlot', d.plot);
      }
      if (!val('gCover') && d.cover) { set('gCover', d.cover); showCover(box, d.cover); }

      // Укр. назви досі немає — автопереклад оригінальної
      let autoTranslated = false;
      if (!val('gTitleUk') && val('gTitle').trim()) {
        st.textContent = 'Перекладаю назву українською…';
        const tr = await translateTitle(val('gTitle').trim());
        if (tr && !val('gTitleUk')) {
          set('gTitleUk', tr);
          autoTranslated = true;
        }
      }

      const got = [d.titleUk, d.developer, (d.genres || []).length, (d.platforms || []).length, d.plot, val('gCover'), val('gTitleUk')].some(Boolean);
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
  const coverInput = $('gCover');
  if (coverInput) {
    coverInput.addEventListener('change', () => {
      const u = coverInput.value.trim();
      if (u) showCover(box, u); else hideCover(box);
    });
  }

  // ---------- Видалення (в режимі редагування) ----------
  const delBtn = box.querySelector('[data-delete-game]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Видалити гру?',
        text: `«${gTitle(game)}» та всі її оцінки буде видалено назавжди.`,
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.deleteGame(game.id);
        toast('Гру видалено');
        notifyGameDeleted(currentUserId, gTitle(game));
        close();
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити гру', 'err');
      }
    });
  }

  // ---------- Збереження ----------
  const form = $('gameForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titleUk = val('gTitleUk').trim();
    const title = val('gTitle').trim();
    if (!titleUk && !title) { toast('Вкажіть назву гри', 'err'); return; }

    const data = {
      title: title || titleUk,
      titleUk: titleUk || null,
      year: U.intOrNull(val('gYear'), 1958, 2100),
      cover: val('gCover').trim() || null,
      qid: (picked ? picked.qid : null) || (game ? game.qid : null) || null,
      developer: val('gDeveloper').trim() || null,
      publisher: val('gPublisher').trim() || null,
      platforms: U.parseGenres(val('gPlatforms')),
      genres: U.parseGenres(val('gGenres')),
      plot: val('gPlot').trim() || null,
      wikiUrl: (picked ? picked.wikiUrl : null) || (game ? game.wikiUrl : null) || null
    };

    if (!isEdit) {
      const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '');
      const dup = allGames.find(g =>
        (data.qid && g.qid && g.qid === data.qid) ||
        (norm(g.title) === norm(data.title) && g.year && data.year && g.year === data.year));
      if (dup) {
        const ok = await confirmDialog({
          title: 'Ця гра вже є у списку',
          text: `«${gTitle(dup)}» вже додано. Все одно додати ще раз?`,
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
        await store.updateGame(game.id, data);
        toast('Зміни збережено');
      } else {
        const newId = await store.addGame({ ...data, addedBy: currentUserId });
        toast('Гру додано');
        notifyGameAdded(currentUserId, { ...data, id: newId });
      }
      close();
    } catch (err) {
      console.error(err);
      toast('Помилка збереження: ' + ((err && (err.code || err.message)) || 'спробуйте ще раз'), 'err');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span>Зберегти</span>';
    }
  });

  function gTitle(g) { return g.titleUk || g.title || 'Без назви'; }
}

function showCover(box, url) {
  const img = box.querySelector('#gCoverPreview');
  if (!img) return;
  img.src = U.posterUrl(url, 300) || url;
  img.parentElement.classList.add('has-img');
  img.onerror = () => { img.parentElement.classList.remove('has-img'); img.removeAttribute('src'); };
}

function hideCover(box) {
  const img = box.querySelector('#gCoverPreview');
  if (!img) return;
  img.parentElement.classList.remove('has-img');
  img.removeAttribute('src');
}

function formHTML(isEdit, game) {
  return `
  <form id="gameForm" novalidate>
    <div class="modal-head">
      <h2>${isEdit ? 'Редагувати гру' : 'Нова гра'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    ${`
    <label class="field">
      <span class="field-label">Пошук гри${isEdit ? ' — заміна даних' : ''}</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="gSearch" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="search"
               placeholder="Почніть вводити назву — українською або англійською…">
        <div class="suggest-list" id="suggestList" hidden></div>
      </div>
      <span class="hint">${isEdit
        ? 'Оберіть правильну гру зі списку — назва, обкладинка, рік, розробник та інші поля буде замінено новими даними (оцінки залишаться).'
        : 'Оберіть гру зі списку — обкладинка, рік, розробник, платформи й жанри підтягнуться автоматично з Вікіпедії та Вікіданих. Або просто заповніть поля нижче вручну.'}</span>
    </label>`}

    <div class="form-grid">
      <label class="field">
        <span class="field-label">Назва (українською)</span>
        <input id="gTitleUk" type="text" placeholder="Напр.: The Witcher 3">
      </label>
      <label class="field">
        <span class="field-label">Оригінальна назва</span>
        <input id="gTitle" type="text" placeholder="The Witcher 3: Wild Hunt">
      </label>
      <label class="field">
        <span class="field-label">Рік випуску</span>
        <input id="gYear" type="number" min="1958" max="2100" placeholder="2015">
      </label>
      <label class="field">
        <span class="field-label">Видавець</span>
        <input id="gPublisher" type="text" placeholder="CD Projekt">
      </label>
      <label class="field span-2">
        <span class="field-label">Розробник</span>
        <input id="gDeveloper" type="text" placeholder="CD Projekt Red">
      </label>
      <label class="field span-2">
        <span class="field-label">Платформи (через кому)</span>
        <input id="gPlatforms" type="text" placeholder="PC, PlayStation 5, Xbox Series">
      </label>
      <label class="field span-2">
        <span class="field-label">Жанри (через кому)</span>
        <input id="gGenres" type="text" placeholder="RPG, пригодницька">
      </label>
    </div>

    <label class="field">
      <span class="field-label">Опис</span>
      <textarea id="gPlot" rows="4" placeholder="Короткий опис гри…"></textarea>
    </label>

    <div class="poster-edit" id="coverEditBox">
      <div class="poster-preview"><img id="gCoverPreview" alt="Прев'ю обкладинки">${icons.gamepad}</div>
      <label class="field grow">
        <span class="field-label">Посилання на обкладинку</span>
        <input id="gCover" type="url" placeholder="https://…">
        <span class="hint">Заповнюється автоматично після вибору гри зі списку.</span>
      </label>
    </div>

    <div class="enrich-status" id="enrichStatus"></div>

    <div class="modal-footer between">
      ${isEdit ? `<button type="button" class="btn danger-ghost" data-delete-game>${icons.trash}<span>Видалити</span></button>` : '<span></span>'}
      <span class="footer-actions">
        <button type="button" class="btn" data-close>Скасувати</button>
        <button type="submit" class="btn primary" data-save><span>Зберегти</span></button>
      </span>
    </div>
  </form>`;
}
