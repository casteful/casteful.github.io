// ============================================================
// Модальне вікно «Додати / Редагувати фільм»:
//  - автозаповнення через IMDb Suggestion API
//  - автоматичне підтягування деталей (Wikidata + Вікіпедія)
//  - збереження в Firebase
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as U from './utils.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { suggestFilms, typeLabel } from './imdb.js';
import { enrichFilm } from './enrich.js';

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
    searchInput.addEventListener('input', U.debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { hideSug(); return; }
      sugList.hidden = false;
      sugList.innerHTML = `<div class="s-note">${icons.search}<span>Шукаю на IMDb…</span></div>`;
      sugItems = await suggestFilms(q);
      sugIndex = -1;
      if (!sugItems.length) {
        sugList.innerHTML = `<div class="s-note">${icons.alert}<span>Нічого не знайдено. Спробуйте англійську назву або заповніть поля вручну.</span></div>`;
        return;
      }
      sugList.innerHTML = sugItems.map((s, i) => `
        <button type="button" class="s-item" data-i="${i}">
          <span class="s-thumb">${s.poster ? `<img src="${U.escapeHtml(U.posterUrl(s.poster, 100))}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}</span>
          <span class="s-text">
            <span class="s-name">${U.escapeHtml(s.title)}</span>
            <span class="s-year">${[s.year || '', typeLabel(s.type)].filter(Boolean).join(' · ')}</span>
          </span>
        </button>`).join('');
    }, 350));

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

    sugList.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.s-item');
      if (!item) return;
      e.preventDefault();
      pickSuggestion(sugItems[+item.dataset.i]);
    });

    searchInput.addEventListener('blur', () => setTimeout(hideSug, 180));
  }

  function hideSug() {
    if (sugList) { sugList.hidden = true; sugList.innerHTML = ''; }
    sugIndex = -1;
  }

  function pickSuggestion(s) {
    if (!s) return;
    picked = s;
    set('fTitle', s.title);
    if (!val('fYear')) set('fYear', s.year ?? '');
    if (!val('fPoster') && s.poster) { set('fPoster', s.poster); showPoster(box, s.poster); }
    searchInput.value = `${s.title}${s.year ? ` (${s.year})` : ''}`;
    hideSug();
    runEnrichment();
  }

  // ---------- Збагачення даними з Wikidata / Вікіпедії ----------
  let enriching = false;

  async function runEnrichment() {
    if (!picked || !picked.imdbId || enriching) return;
    enriching = true;
    const st = $('enrichStatus');
    st.className = 'enrich-status show';
    st.textContent = 'Завантажую деталі з Wikidata та Вікіпедії…';
    try {
      const d = await enrichFilm({
        imdbId: picked.imdbId,
        title: picked.title,
        year: picked.year,
        titleUkHint: val('fTitleUk').trim() || null
      });
      fillIfEmpty('fTitleUk', d.titleUk);
      fillIfEmpty('fDirector', d.director);
      fillIfEmpty('fGenres', (d.genres || []).join(', '));
      fillIfEmpty('fRuntime', d.runtime);
      fillIfEmpty('fPlot', d.plot);
      if (!val('fPoster') && d.poster) { set('fPoster', d.poster); showPoster(box, d.poster); }

      const got = [d.titleUk, d.director, (d.genres || []).length, d.runtime, d.plot].some(Boolean);
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
      <span class="field-label">Пошук на IMDb</span>
      <div class="suggest-wrap">
        ${icons.search}
        <input id="fSearch" type="text" autocomplete="off" spellcheck="false"
               placeholder="Почніть вводити назву англійською…">
      </div>
      <div class="suggest-list" id="suggestList" hidden></div>
      <span class="hint">Оберіть фільм зі списку — постер, рік і деталі підтягнуться автоматично. Або просто заповніть поля нижче вручну.</span>
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
