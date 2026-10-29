// ============================================================
// Модальне вікно «Додати / Редагувати гру» (вкладка «Ігри»).
//
// Автозаповнення через Вікіпедію + Вікідані (js/game-search.js):
// назва, рік, розробник, платформи, жанри, опис і обкладинка
// підтягуються з підказок. Усе можна виправити вручну — форма
// лишається повністю ручною, пошук лише пришвидшує заповнення.
// ============================================================

import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons, ratingTrailHTML, wireRatingTrail } from './ui.js';
import { notifyItemAdded, notifyItemDeleted } from './telegram.js';
import { cachedGameSearch } from './game-search.js';
import { translateToUk } from './translate.js';

export function openGameFormModal({ game = null, currentUserId, allGames = [] }) {
  const isEdit = !!game;

  const { box, close } = openModal(gameFormHTML(isEdit), {
    width: 640,
    label: isEdit ? 'Редагувати гру' : 'Нова гра'
  });

  const $ = id => box.querySelector('#' + id);
  const val = id => ($(id) ? $(id).value : '');
  const set = (id, v) => { if ($(id)) $(id).value = v ?? ''; };

  // Автопереклад укр. назви (як у фільмів): джерела не завжди мають
  // готову укр. назву — тоді машинно перекладаємо оригінал і тихо
  // підставляємо, доки користувач не встиг увести своє
  let tukGen = 0;
  async function autoFillTitleUk(srcText) {
    const src = String(srcText || '').trim();
    if (!src) return;
    if (val('gTitleUk').trim()) return;
    const gen = ++tukGen;
    const translated = await translateToUk(src);
    if (gen !== tukGen) return;
    if (val('gTitleUk').trim()) return;
    if (translated) set('gTitleUk', translated);
  }

  if (game) {
    set('gTitleUk', game.titleUk || '');
    set('gTitle', game.title || '');
    set('gYear', game.year || '');
    set('gDeveloper', game.developer || '');
    set('gPlatform', (game.platform || []).join(', '));
    set('gGenres', (game.genres || []).join(', '));
    set('gPlot', game.plot || '');
    set('gPoster', game.poster || '');
    if (game.poster) showPoster(box, game.poster);
    if (!game.titleUk && game.title) autoFillTitleUk(game.title);
  }

  // ---------- Прев'ю обкладинки ----------
  const posterInput = $('gPoster');
  if (posterInput) {
    posterInput.addEventListener('change', () => {
      const u = posterInput.value.trim();
      if (u) showPoster(box, u); else hidePoster(box);
    });
  }

  // ---------- Пошук гри (Вікіпедія + Вікідані) ----------
  const searchInput = $('gSearch');
  const sugList = $('suggestList');
  let sugItems = [];
  let sugIndex = -1;

  function hideSug() { sugList.hidden = true; sugList.innerHTML = ''; sugIndex = -1; }

  function fillFromGame(s) {
    if (!s) return;
    set('gTitle', s.title || '');
    if (s.titleUk) set('gTitleUk', s.titleUk);
    set('gYear', s.year || '');
    set('gDeveloper', s.developer || '');
    set('gPlatform', (s.platforms || []).join(', '));
    set('gGenres', (s.genres || []).join(', '));
    set('gPlot', s.plot || '');
    if (s.poster) {
      set('gPoster', s.poster);
      showPoster(box, s.poster);
    }
    // Укр. назва не знайшлась (стаття лише англійською) — машинний переклад
    if (!s.titleUk && s.title) autoFillTitleUk(s.title);
  }

  if (searchInput) {
    const note = (icon, text) => `<div class="s-note">${icon}<span>${text}</span></div>`;
    let searchGen = 0; // захист від перегонів повільних запитів

    searchInput.addEventListener('input', U.debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { hideSug(); return; }
      const gen = ++searchGen;
      sugList.hidden = false;
      sugList.innerHTML = note(icons.search, 'Шукаю гру у Вікіпедії…');

      const renderItems = (list) => {
        sugItems = list;
        sugIndex = -1;
        sugList.innerHTML = list.map((s, i) => {
          const main = s.titleUk || s.title;
          const alt = (s.titleUk && s.title && s.titleUk !== s.title) ? s.title : '';
          return `
          <button type="button" class="s-item" data-i="${i}">
            <span class="s-thumb">${icons.gamepad}${s.poster
              ? `<img src="${U.escapeHtml(s.poster)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
              : ''}</span>
            <span class="s-text">
              <span class="s-name">${U.escapeHtml(main)}</span>
              ${alt ? `<span class="s-orig">${U.escapeHtml(alt)}</span>` : ''}
              <span class="s-year">${[s.year || '', s.developer || '', 'Вікіпедія'].filter(Boolean).join(' · ')}</span>
            </span>
          </button>`;
        }).join('') +
          (list.length > 7
            ? `<div class="s-foot">Усього ${list.length} ${U.plural(list.length, ['збіг', 'збіги', 'збігів'])} — гортайте список</div>`
            : '');
      };

      let items = [];
      try {
        items = await cachedGameSearch(q, (partial) => {
          if (gen !== searchGen || sugList.hidden) return;
          if (partial && partial.length) renderItems(partial);
        });
      } catch (e) { items = []; }

      if (gen !== searchGen) return; // застарілий результат — ігноруємо
      if (!items.length) {
        sugList.innerHTML = note(icons.alert, 'Нічого не знайдено у Вікіпедії. Спробуйте оригінальну англійську назву гри або заповніть поля нижче вручну.');
        return;
      }
      renderItems(items);
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
    //  1) touchend + preventDefault: на iOS саме це надійно працює;
    //  2) mousedown + preventDefault: десктоп (фокус лишається у полі);
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

    let pickedOnce = false;
    function pickOnce(item) {
      const s = sugItems[Number(item.dataset.i)];
      if (!s) return;
      if (pickedOnce) return; // touchend + click подвійний виклик
      pickedOnce = true;
      setTimeout(() => { pickedOnce = false; }, 350);
      pickSuggestion(s);
    }

    function pickSuggestion(s) {
      fillFromGame(s);
      hideSug();
      searchInput.value = '';
    }
  }

  // ---------- Оцінка при додаванні (необов'язково) ----------
  let myRating = null;
  const rateBox = box.querySelector('#gRate');
  if (rateBox) {
    wireRatingTrail(rateBox, { selected: null, onPick: (s) => { myRating = s; } });
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
        await store.deleteFrom('games', game.id);
        toast('Гру видалено');
        notifyItemDeleted(currentUserId, gTitle(game), 'game');
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
      developer: val('gDeveloper').trim() || null,
      platform: U.parseGenres(val('gPlatform')),
      genres: U.parseGenres(val('gGenres')),
      plot: val('gPlot').trim() || null,
      poster: val('gPoster').trim() || null
    };

    if (!isEdit) {
      const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '');
      const dup = allGames.find(g =>
        norm(g.title) === norm(data.title) && g.year && data.year && g.year === data.year);
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
        await store.updateIn('games', game.id, data);
        toast('Зміни збережено');
      } else {
        const newId = await store.addTo('games', { ...data, addedBy: currentUserId });
        if (myRating != null) {
          try { await store.setRatingIn('games', newId, currentUserId, myRating); } catch (e2) { console.error(e2); }
        }
        toast(myRating != null ? `Гру додано — ваша оцінка ${myRating}/10` : 'Гру додано');
        notifyItemAdded(currentUserId, data, newId, 'game', myRating);
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

function showPoster(box, url) {
  const img = box.querySelector('#gPosterPreview');
  if (!img) return;
  img.src = U.posterUrl(url, 300) || url;
  img.parentElement.classList.add('has-img');
  img.onerror = () => { img.parentElement.classList.remove('has-img'); img.removeAttribute('src'); };
}

function hidePoster(box) {
  const img = box.querySelector('#gPosterPreview');
  if (!img) return;
  img.parentElement.classList.remove('has-img');
  img.removeAttribute('src');
}

function gameFormHTML(isEdit) {
  return `
  <form id="gameForm" novalidate>
    <div class="modal-head">
      <h2>${isEdit ? 'Редагувати гру' : 'Нова гра'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    <label class="field">
      <span class="field-label">Пошук гри у Вікіпедії</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="gSearch" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="search"
               placeholder="Почніть вводити назву — українською або англійською…">
        <div class="suggest-list" id="suggestList" hidden></div>
      </div>
      <span class="hint">Оберіть гру зі списку — назва, рік, розробник, платформи, жанри, опис
      і обкладинка підтягнуться автоматично (джерело — Вікіпедія та Вікідані). Якщо українською
      не знаходиться — пробуємо англійську транслітерацію. Або просто заповніть поля нижче вручну.</span>
    </label>

    <div class="form-grid">
      <label class="field">
        <span class="field-label">Назва (українською)</span>
        <input id="gTitleUk" type="text" placeholder="Напр.: Відьмак 3: Дике полювання">
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
        <span class="field-label">Розробник</span>
        <input id="gDeveloper" type="text" placeholder="CD Projekt RED">
      </label>
      <label class="field">
        <span class="field-label">Платформи (через кому)</span>
        <input id="gPlatform" type="text" placeholder="PC, PlayStation 5">
      </label>
      <label class="field">
        <span class="field-label">Жанри (через кому)</span>
        <input id="gGenres" type="text" placeholder="екшен, RPG">
      </label>
    </div>

    <label class="field">
      <span class="field-label">Опис</span>
      <textarea id="gPlot" rows="4" placeholder="Короткий опис гри…"></textarea>
    </label>

    <div class="poster-edit" id="posterEditBox">
      <div class="poster-preview"><img id="gPosterPreview" alt="Прев'ю обкладинки" referrerpolicy="no-referrer">${icons.gamepad}</div>
      <label class="field grow">
        <span class="field-label">Посилання на обкладинку</span>
        <input id="gPoster" type="url" placeholder="https://…">
        <span class="hint">Наприклад, посилання на обкладинку з магазину чи бази ігор.</span>
      </label>
    </div>

    ${!isEdit ? `
    <div class="field add-rate">
      <span class="field-label">Ваша оцінка — необов'язково</span>
      <div class="rt" id="gRate" role="group" aria-label="Ваша оцінка від 1 до 10">${ratingTrailHTML(null)}</div>
      <span class="hint">Додасте гру одразу зі своєю оцінкою — вона з'явиться в чіпах на картці та в Telegram-повідомленні.</span>
    </div>` : ''}

    <div class="modal-footer between">
      ${isEdit ? `<button type="button" class="btn danger-ghost" data-delete-game>${icons.trash}<span>Видалити</span></button>` : '<span></span>'}
      <span class="footer-actions">
        <button type="button" class="btn" data-close>Скасувати</button>
        <button type="submit" class="btn primary" data-save><span>Зберегти</span></button>
      </span>
    </div>
  </form>`;
}
