// ============================================================
// Налаштування: експорт усієї бази даних у JSON
//
// Кнопка ⚙ у шапці відкриває маленьке вікно, з якого можна
// завантажити повну резервну копію Realtime Database (фільми,
// оцінки, конфіг Telegram) одним JSON-файлом. Файл формується
// прямо в браузері й одразу завантажується — сервер не потрібен.
// ============================================================

import * as store from './store.js';
import { firebaseConfig } from './config.js';
import { toast, openModal, icons } from './ui.js';

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

export function openSettings() {
  const dbName = firebaseConfig.projectId || 'Firebase';

  const { box } = openModal(`
    <div class="modal-head">
      <h2>Налаштування</h2>
      <button type="button" class="icon-btn" data-close aria-label="Закрити">${icons.close}</button>
    </div>
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

      <div class="export-note" id="exportNote"></div>
    </div>
  `, { width: 480, label: 'Налаштування' });

  const exportBtn = box.querySelector('#dbExport');
  const note = box.querySelector('#exportNote');

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    note.textContent = 'Зчитую базу…';
    try {
      const data = await store.exportAll();
      const d = new Date();
      const stamp = d.toISOString().slice(0, 10);
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
}
