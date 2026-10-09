// ============================================================
// Налаштування: одна кнопка-шестерня у шапці, два розділи:
//   1) Telegram-сповіщення — статус, швидкий перемикач і перехід
//      до повного підключення (старе вікно «літака», тепер звідси);
//   2) Дані — експорт усієї бази у JSON-файл та імпорт/відновлення
//      з файлу (повна заміна вмісту бази після підтвердження).
// ============================================================

import * as store from './store.js';
import * as telegram from './telegram.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { escapeHtml } from './utils.js';

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
  const cur = telegram.getConfig() || {};
  const connected = !!(cur.token && cur.chatId);

  const { box, close } = openModal(`
    <div class="modal-head">
      <h2>Налаштування</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    <div class="set-sec">
      <h3 class="set-title">${icons.send}<span>Telegram-сповіщення</span></h3>
      <div class="tg-status ${connected ? 'ok' : ''}" id="setTgStatus">
        <i></i><span>${connected
          ? `Підключено: <b>${escapeHtml(cur.chatTitle || String(cur.chatId))}</b>${cur.enabled === false ? ' · вимкнено' : ''}`
          : 'Не підключено'}</span>
      </div>
      <p class="set-hint">Коли хтось додає фільм або ставить оцінку — у спільний чат приходить коротке повідомлення.</p>
      <div class="set-actions">
        <button type="button" class="btn" id="setTgSetup"><span>${connected ? 'Змінити підключення' : 'Підключити'}</span></button>
        ${connected ? `
        <label class="tg-toggle">
          <input type="checkbox" id="setTgEnabled" ${cur.enabled === false ? '' : 'checked'}>
          <span>Увімкнено</span>
        </label>` : ''}
      </div>
    </div>

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

  // --- Telegram: перехід до повного вікна підключення ---
  $('setTgSetup').addEventListener('click', () => {
    close();
    telegram.openTgSetup();
  });

  const enabledBox = $('setTgEnabled');
  if (enabledBox) {
    enabledBox.addEventListener('change', async () => {
      try {
        await store.setTgConfig({ ...cur, enabled: enabledBox.checked });
        const st = $('setTgStatus');
        st.className = 'tg-status ok';
        st.innerHTML = `<i></i><span>Підключено: <b>${escapeHtml(cur.chatTitle || String(cur.chatId))}</b>${enabledBox.checked ? '' : ' · вимкнено'}</span>`;
        toast(enabledBox.checked ? 'Сповіщення увімкнено' : 'Сповіщення вимкнено');
      } catch (err) {
        console.error(err);
        toast('Не вдалося змінити стан', 'err');
        enabledBox.checked = !enabledBox.checked;
      }
    });
  }

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
