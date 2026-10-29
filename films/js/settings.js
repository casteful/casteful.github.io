// ============================================================
// Налаштування: одна кнопка-шестерня у шапці, три розділи:
//   0) Мій аватар — завантаження фото профілю (квадрат 144×144,
//      стискається тут, у браузері; зберігається в базі і його
//      бачать усі друзі замість буквеної аватарки);
//   1) Telegram-сповіщення — повна форма підключення вбудована
//      прямо сюди (токен, пошук чатів, тест, перемикач) — без
//      окремого вікна й кнопки «Змінити підключення»;
//   2) Дані — експорт усієї бази у JSON-файл та імпорт/відновлення
//      з файлу (повна заміна вмісту бази після підтвердження).
// ============================================================

import { USERS } from './config.js?v=5.1';
import * as store from './store.js?v=5.1';
import * as telegram from './telegram.js?v=5.1';
import * as avatars from './avatars.js?v=5.1';
import { toast, openModal, confirmDialog, icons } from './ui.js?v=5.1';

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
  // Аватар — особиста річ: читаємо профіль на момент відкриття вікна
  let me = null;
  try {
    const id = localStorage.getItem('films_user');
    me = USERS.find(u => u.id === id) || null;
  } catch (e) { me = null; }

  const { box, close } = openModal(`
    <div class="modal-head">
      <h2>Налаштування</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    <div class="set-sec" id="setAvatarSec">
      <h3 class="set-title">${icons.camera}<span>Мій аватар</span></h3>
      ${me ? `
      <div class="avatar-edit">
        <span class="avatar xl" id="avPreview"></span>
        <div class="avatar-actions">
          <div class="set-actions">
            <button type="button" class="btn" id="avPick">${icons.upload}<span>Завантажити фото…</span></button>
            <button type="button" class="btn danger-ghost" id="avRemove" ${avatars.get(me.id) ? '' : 'hidden'}>${icons.trash}<span>Видалити</span></button>
            <input type="file" id="avFile" accept="image/*" hidden>
          </div>
          <span class="hint">Квадрат 144×144 — обрізаємо та стискаємо автоматично.
          Аватар зберігається в базі, і його бачать усі друзі замість ініціалів.</span>
        </div>
      </div>`
      : `<p class="set-hint">Спочатку оберіть профіль у шапці — потім тут можна завантажити його фото.</p>`}
    </div>

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

  // --- Аватар: попередній перегляд, вибір файлу, стискання, збереження ---
  const paintPreview = () => {
    const el = $('avPreview');
    if (!el || !me) return;
    // preview показує ТЕ, що збережеться: поточний аватар або ініціали
    const inner = avatars.get(me.id);
    if (inner) {
      el.innerHTML = `<img src="${inner}" alt="">`;
    } else {
      el.textContent = (me.name || '?').trim().charAt(0).toUpperCase();
      el.style.background = me.color;
    }
  };
  paintPreview();

  const unsub = avatars.onChange(() => paintPreview());

  const fileInput = $('avFile');
  if (fileInput) {
    $('avPick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file || !me) return;
      try {
        const dataUrl = await avatars.fileToAvatarDataUrl(file);
        // одразу зберігаємо — аватар легко змінити новим фото
        await store.setAvatar(me.id, dataUrl);
        toast('Аватар оновлено — друзі його вже бачать');
        const rm = $('avRemove');
        if (rm) rm.hidden = false;
      } catch (err) {
        console.error(err);
        toast((err && err.message) || 'Не вдалося обробити зображення', 'err');
      }
    });

    $('avRemove').addEventListener('click', async () => {
      if (!me) return;
      const ok = await confirmDialog({
        title: 'Видалити аватар?',
        text: 'Повернеться буквена аватарка з ініціалами. Фото зникне для всіх друзів.',
        confirmText: 'Видалити'
      });
      if (!ok) return;
      try {
        await store.setAvatar(me.id, null);
        toast('Аватар видалено');
        const rm = $('avRemove');
        if (rm) rm.hidden = true;
      } catch (err) {
        console.error(err);
        toast('Не вдалося видалити аватар', 'err');
      }
    });
  }

  // Поки вікно відкрите — живий прев'ю (unsub оголошено вище); після
  // закриття (бокс зникає з DOM) відписуємось від змін аватарів
  const mo = new MutationObserver(() => {
    if (!document.contains(box)) { unsub(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

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
