// ============================================================
// Налаштування (⚙ у шапці) — одне вікно з двома секціями:
//
//  • Telegram-сповіщення — токен бота, пошук чату, тест, увімкнення
//    (секцію рендерить js/telegram.js через renderTgSetup);
//  • База даних — експорт усього вмісту Realtime Database одним
//    JSON-файлом та відновлення з такого файлу (з чітким
//    підтвердженням, бо запис замінює ВСІ поточні дані).
//
// Усе відбувається прямо в браузері — сервер не потрібен.
// ============================================================

import * as store from './store.js';
import { firebaseConfig } from './config.js';
import { toast, openModal, confirmDialog, icons } from './ui.js';
import { renderTgSetup } from './telegram.js';

// Завантаження об'єкта як файл (працює і на мобільних браузерах)
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Читання файлу як тексту (FileReader — сумісний з усіма браузерами)
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('Не вдалося прочитати файл'));
    r.readAsText(file);
  });
}

export function openSettings() {
  const dbName = firebaseConfig.projectId || 'Firebase';

  const { box } = openModal(`
    <div class="modal-head">
      <h2>Налаштування</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>

    <section class="set-section">
      <h3 class="set-title">${icons.send}<span>Telegram-сповіщення</span></h3>
      <div class="tg-setup" id="tgSection"></div>
    </section>

    <div class="set-sep"></div>

    <section class="set-section">
      <h3 class="set-title">${icons.db}<span>База даних</span></h3>
      <div class="tg-setup">
        <div class="tg-status ok"><i></i><span>База даних: <b>${dbName}</b></span></div>

        <p class="tg-hint">Експортує всю базу в один JSON-файл: усі фільми з оцінками
        та налаштування Telegram. Зручно для резервної копії або перенесення
        в інший проєкт Firebase.</p>

        <div class="tg-actions">
          <button type="button" class="btn primary" id="dbExport">
            ${icons.download}<span>Експортувати базу (JSON)</span>
          </button>
        </div>

        <p class="tg-hint">Відновлення з файлу <b>повністю замінює</b> усі фільми,
        оцінки та конфіг Telegram у базі даними з раніше збереженого експорту.
        Спочатку файл буде перевірено — зміни стануться лише після підтвердження.</p>

        <div class="tg-actions">
          <button type="button" class="btn" id="dbImport">
            ${icons.upload}<span>Відновити з файлу…</span>
          </button>
          <input type="file" id="dbImportFile" accept=".json,application/json" hidden>
        </div>

        <div class="export-note" id="exportNote"></div>
      </div>
    </section>
  `, { width: 520, label: 'Налаштування' });

  // Секція Telegram: рендериться й живе своїми обробниками
  renderTgSetup(box.querySelector('#tgSection'));

  const exportBtn = box.querySelector('#dbExport');
  const importBtn = box.querySelector('#dbImport');
  const fileInput = box.querySelector('#dbImportFile');
  const note = box.querySelector('#exportNote');

  // ---------- Експорт ----------
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    note.textContent = 'Зчитую базу…';
    try {
      const data = await store.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      const fname = `filmmoteka-db-${stamp}.json`;
      downloadJson(data, fname);
      const m = data.meta || {};
      const msg = `Експортовано: ${m.films || 0} фільмів, ${m.ratings || 0} оцінок → ${fname}`;
      note.textContent = msg;
      toast(msg);
    } catch (err) {
      console.error('[export]', err);
      note.textContent = '';
      toast('Не вдалося експортувати базу: ' + ((err && err.code) || err.message || 'помилка'), 'err');
    } finally {
      exportBtn.disabled = false;
    }
  });

  // ---------- Імпорт / відновлення ----------
  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // щоб можна було обрати той самий файл повторно
    if (!file) return;

    importBtn.disabled = true;
    try {
      // 1. Читаємо і парсимо файл
      let data;
      try {
        data = JSON.parse(await readFileText(file));
      } catch (e) {
        toast('Не вдалося прочитати файл: це не коректний JSON', 'err');
        return;
      }

      // 2. Перевіряємо структуру (без запису)
      const check = store.validateImport(data);
      if (!check.ok) { toast(check.msg, 'err'); return; }
      if (!check.films) { toast('У файлі немає жодного фільму — нічого відновлювати', 'err'); return; }

      // 3. Підтвердження з повною інформацією про наслідки
      const ok = await confirmDialog({
        title: 'Відновити базу даних?',
        text: `У файлі: ${check.films} фільмів, ${check.ratings} оцінок` +
              (check.hasTg ? ', Telegram-конфіг' : '') +
              '. Усі поточні фільми, оцінки та Telegram-конфіг у базі буде замінено. Дію не можна скасувати.',
        confirmText: 'Замінити дані'
      });
      if (!ok) return;

      // 4. Атомарний запис
      note.textContent = 'Записую до бази…';
      const res = await store.importAll(data);
      const msg = `Базу відновлено: ${res.films} фільмів, ${res.ratings} оцінок`;
      note.textContent = msg;
      toast(msg);
    } catch (err) {
      console.error('[import]', err);
      note.textContent = '';
      toast('Помилка відновлення: ' + ((err && (err.code || err.message)) || 'невідома'), 'err');
    } finally {
      importBtn.disabled = false;
    }
  });
}
