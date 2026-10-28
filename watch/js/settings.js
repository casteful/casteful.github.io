// ============================================================
// Налаштування: одна кнопка-шестерня у шапці, три розділи:
//   0) Профілі друзів — завантаження фото-аватарок (квадрат ~192px
//      стискається на пристрої і зберігається у базі, щоб фото
//      бачили всі учасники замість літери);
//   1) Telegram-сповіщення — повна форма підключення вбудована
//      прямо сюди (токен, пошук чатів, тест, перемикач) — без
//      окремого вікна й кнопки «Змінити підключення»;
//   2) Дані — експорт усієї бази у JSON-файл та імпорт/відновлення
//      з файлу (повна заміна вмісту бази після підтвердження).
// ============================================================

import { USERS } from './config.js';
import * as store from './store.js';
import * as telegram from './telegram.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { escapeHtml, avatarHTML, getAvatarsMap, setAvatarsMap } from './utils.js';

export function init() {
  const btn = document.getElementById('settingsBtn');
  if (!btn) return;
  btn.innerHTML = icons.gear;
  btn.addEventListener('click', openSettings);
  telegram.init(); // підписка на спільний конфіг Telegram у базі
}

// Бігунець «підключено» на шестерні (жовтва крапка, як на старому літаку)
export function setTgIndicator(on) {
  const btn = document.getElementById('settingsBtn');
  if (btn) btn.classList.toggle('has-tg', !!on);
}

export function openSettings() {
  const { box, close } = openModal(`
    <div class="modal-head">
      <h2>Налаштування</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    <div class="set-sec" id="setProfilesSec"></div>

    <div class="set-sec" id="setTgSec"></div>

    <div class="set-sec">
      <h3 class="set-title">${icons.table}<span>Дані</span></h3>
      <p class="set-hint">
        <b>Експорт</b> зберігає всю базу — фільми, оцінки й налаштування Telegram —
        у JSON-файл. <b>Імпорт</b> відновлює базу з такого файлу, повністю
        замінюючи поточний вміст. Корисно для резервних копій або перенесення.
      </p>
      <div class="set-actions">
        <button type="button" class="btn" id="setExport">${icons.download}<span>Експортувати JSON</span></button>
        <button type="button" class="btn" id="setImport">${icons.upload}<span>Імпортувати JSON</span></button>
        <input type="file" id="setFile" accept=".json,application/json" hidden>
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn primary" data-close><span>Готово</span></button>
    </div>
  `, { width: 520, label: 'Налаштування' });

  const $ = id => box.querySelector('#' + id);

  // --- Профілі: фото-аватарки (секція зверху) ---
  mountProfilesSection(box.querySelector('#setProfilesSec'));

  // --- Telegram: уся форма прямо в секції, без перехідного вікна ---
  telegram.mountSettingsSection(box.querySelector('#setTgSec'));

  // --- Експорт: знімок кореня бази -> JSON-файл ---
  $('setExport').addEventListener('click', async () => {
    const btnExp = $('setExport');
    btnExp.disabled = true;
    try {
      const root = await store.exportAll();
      const payload = {
        app: 'filmoteka',
        schema: 1,
        exportedAt: new Date().toISOString(),
        ...root
      };
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      const name = `filmoteka-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const n = Object.keys(payload.films || {}).length;
      toast(`Резервну копію збережено (${n})`);
    } catch (err) {
      console.error(err);
      toast('Не вдалося експортувати базу: ' + ((err && (err.code || err.message)) || ''), 'err');
    }
    btnExp.disabled = false;
  });

  // --- Імпорт: файл -> перевірка -> підтвердження -> повна заміна ---
  $('setImport').addEventListener('click', () => $('setFile').click());
  $('setFile').addEventListener('change', async () => {
    const file = $('setFile').files[0];
    $('setFile').value = ''; // дозволити обрати той самий файл повторно
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      toast('Файл не читається: це не коректний JSON', 'err');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      toast('Це не схоже на резервну копію Фільмотеки', 'err');
      return;
    }

    // Відрізаємо службові поля нашого експорту; все інше — вміст бази
    const { app, schema, exportedAt, ...root } = data;

    // films може бути масивом (ручний файл) — нормалізуємо до об'єкта
    let films = root.films;
    if (Array.isArray(films)) {
      const obj = {};
      films.forEach((f, i) => { if (f && typeof f === 'object') obj[String(i + 1)] = f; });
      films = obj;
    } else if (films && typeof films === 'object') {
      // прибрати порожні/биті записи й нормалізувати ratings-масиви
      const obj = {};
      for (const [k, f] of Object.entries(films)) {
        if (!f || typeof f !== 'object') continue;
        if (Array.isArray(f.ratings)) {
          const r = {};
          f.ratings.forEach((v, i) => { if (v != null) r[String(i)] = v; });
          f = { ...f, ratings: r };
        }
        obj[k] = f;
      }
      films = obj;
    } else if (films == null) {
      films = {};
    }

    const count = Object.keys(films).length;
    if (!count && !root.tgConfig) {
      toast('У файлі немає фільмів — перевірте, що це копія Фільмотеки', 'err');
      return;
    }

    const ok = await confirmDialog({
      title: 'Відновити базу з файлу?',
      text: `Файл «${file.name}»: ${count} ${count === 1 ? 'фільм' : 'фільмів'}. Поточний вміст бази буде ПОВНІСТЮ перезаписано — це неможливо скасувати.`,
      confirmText: 'Перезаписати базу'
    });
    if (!ok) return;

    try {
      await store.importAll({ ...root, films });
      toast(`Базу відновлено з файлу (${count})`);
      close();
    } catch (err) {
      console.error(err);
      toast('Не вдалося відновити базу: ' + ((err && (err.code || err.message)) || ''), 'err');
    }
  });
}

// ============================================================
// Розділ «Профілі друзів»: завантаження фото-аватарок.
// Файл стискається на пристрої: центрований квадрат 192×192,
// WebP (fallback JPEG) — у базі лише кілька КБ. Фото миттєво
// підхоплюють всі пристрої через підписку store.onAvatars().
// ============================================================

const AVATAR_SIZE = 192;

function mountProfilesSection(sec) {
  sec.innerHTML = `
    <h3 class="set-title">${icons.users}<span>Профілі друзів</span></h3>
    <p class="set-hint">
      Завантажте фото — воно буде видно всім учасникам замість літери на аватарці:
      у шапці, у виборі профілю, у таблиці та у вікні фільму.
      Картинка автоматично обріжається до квадрата й стискається, тож база лишається легкою.
    </p>
    <div class="prof-list">
      ${USERS.map(u => `
        <div class="prof-row" data-uid="${u.id}">
          <span class="prof-avatar">${avatarHTML(u, 'lg')}</span>
          <span class="prof-info">
            <b>${escapeHtml(u.name)}</b>
            <span class="prof-state" data-state></span>
          </span>
          <span class="prof-actions">
            <button type="button" class="btn sm" data-upload>${icons.upload}<span>Фото</span></button>
            <button type="button" class="btn sm danger-ghost" data-remove hidden>${icons.trash}<span>Прибрати</span></button>
            <input type="file" accept="image/*" data-file hidden>
          </span>
        </div>`).join('')}
    </div>`;

  USERS.forEach(u => {
    const row = sec.querySelector(`.prof-row[data-uid="${u.id}"]`);
    const fileInput = row.querySelector('[data-file]');
    const stateEl = row.querySelector('[data-state]');
    const rmBtn = row.querySelector('[data-remove]');
    const upBtn = row.querySelector('[data-upload]');
    const avEl = row.querySelector('.prof-avatar');

    const refresh = (map) => {
      const has = !!(map && map[u.id]);
      avEl.innerHTML = avatarHTML(u, 'lg');
      rmBtn.hidden = !has;
      stateEl.textContent = has ? 'Фото завантажено — видно всім' : 'Поки літера-аватарка';
    };
    refresh(getAvatarsMap());

    upBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = ''; // дозволити обрати той самий файл повторно
      if (!file) return;
      if (!file.type || !file.type.startsWith('image/')) {
        toast('Це не схоже на зображення', 'err');
        return;
      }
      upBtn.disabled = true;
      upBtn.innerHTML = '<span class="spinner"></span><span>Обробляю…</span>';
      try {
        const dataUrl = await fileToAvatarDataUrl(file);
        await store.setAvatar(u.id, dataUrl);
        // миттєве оновлення секції (снапшот бази підтягнеться слідом)
        const next = { ...getAvatarsMap(), [u.id]: dataUrl };
        setAvatarsMap(next);
        refresh(next);
        toast(`Фото профілю «${u.name}» оновлено`);
      } catch (err) {
        console.error(err);
        toast('Не вдалося обробити зображення', 'err');
      }
      upBtn.disabled = false;
      upBtn.innerHTML = `${icons.upload}<span>Фото</span>`;
    });

    rmBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Прибрати фото профілю?',
        text: `Аватарка ${u.name} знову стане літерою. Це для всіх учасників.`,
        confirmText: 'Прибрати'
      });
      if (!ok) return;
      rmBtn.disabled = true;
      try {
        await store.removeAvatar(u.id);
        const next = { ...getAvatarsMap() };
        delete next[u.id];
        setAvatarsMap(next);
        refresh(next);
        toast('Фото прибрано');
      } catch (err) {
        console.error(err);
        toast('Не вдалося прибрати фото', 'err');
      }
      rmBtn.disabled = false;
    });
  });
}

// Файл -> центрований квадрат AVATAR_SIZE×AVATAR_SIZE -> data-URL.
// Спочатку пробуємо WebP (менший); якщо браузер його не кодує — JPEG
// (прозорість PNG попередньо заливається білим, інакше фон чорніє).
function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) throw new Error('Порожнє зображення');
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        let out = '';
        try {
          const webp = canvas.toDataURL('image/webp', 0.85);
          if (webp && webp.startsWith('data:image/webp') && webp.length < 80000) out = webp;
        } catch (e) { /* WebP не кодується — JPEG */ }
        if (!out) out = canvas.toDataURL('image/jpeg', 0.86);
        cleanup();
        resolve(out);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
    img.onerror = () => { cleanup(); reject(new Error('Не вдалося прочитати зображення')); };
    img.src = url;
  });
}
