// ============================================================
// Telegram-сповіщення: елегантні маленькі пуші українською, коли
// хтось додає/видаляє фільм або ставить оцінку.
//
// Як це працює:
//  • Хтось один (зазвичай власник) відкриває налаштування (шестерня
//    у шапці), вбудована форма Telegram приймає токен бота з
//    @BotFather;
//  • Додаток сам знаходить чат через getUpdates (треба написати
//    /start у групі) і зберігає конфіг у Firebase (вузол tgConfig) —
//    він стає спільним для всіх друзів;
//  • Пуш надсилає ТЕЙ клієнт, який зробив дію (одна дія = один пуш,
//    без дублів). Помилки Telegram ніколи не ламають UI.
//
// CORS: api.telegram.org віддає Access-Control-Allow-Origin: *,
// тож sendMessage працює прямо з браузера; на випадок жорстких
// блокувань є запасний no-cors-запит (form-urlencoded).
//
// Повідомлення йдуть у HTML-режимі (parse_mode: "HTML"): назва фільму
// САМА є клікабельним посиланням ?film=<id> — друг тисне на назву і
// одразу потрапляє на картку фільму з шкалою оцінювання. Увесь текст,
// що приходить з бази, екрануємо (& < >) — інакше Telegram відхилить
// повідомлення через «битий» HTML.
// ============================================================

import { USERS } from './config.js?v=5.5';
import * as store from './store.js?v=5.5';
import { toast, openModal, icons } from './ui.js?v=5.5';
import { escapeHtml } from './utils.js?v=5.5';

let cfg = null; // { enabled, token, chatId, chatTitle } | null

export function init() {
  store.onTgConfig(v => {
    cfg = v;
    // Жовтий індикатор на шестерні «Налаштування»: Telegram підключено
    const btn = document.getElementById('settingsBtn');
    if (btn) btn.classList.toggle('has-tg', !!(cfg && cfg.enabled !== false && cfg.token && cfg.chatId));
  });
}

export function getConfig() { return cfg; }

export function userName(id) {
  const u = USERS.find(x => x.id === id);
  return (u && u.name) || id || 'Хтось';
}

export function filmTitle(f) {
  return (f && (f.titleUk || f.title)) || 'Без назви';
}

// Надсилання: fire-and-forget, жодних тостів про помилки Telegram.
// parse_mode: HTML — щоб назва фільму була клікабельним посиланням.
async function send(text) {
  if (!cfg || cfg.enabled === false || !cfg.token || !cfg.chatId) return;
  const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.token)}/sendMessage`;
  const body = JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) console.warn('[tg] sendMessage ->', res.status);
  } catch (e) {
    // Мережа/CORS: пробуємо form-urlencoded без читання відповіді
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        body: new URLSearchParams({ chat_id: String(cfg.chatId), text, parse_mode: 'HTML' })
      });
    } catch (e2) { console.warn('[tg]', e2 && e2.message); }
  }
}

// ---------- Готові повідомлення (українською, коротко, HTML) ----------

// Telegram-HTML: достатньо екранувати & < > — лапки в тексті повідомлення
// безпечні, а href ми загортаємо у свої лапки самі.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Пряме посилання на фільм у застосунку: отримувач пуша клікає на назву —
// і одразу бачить картку фільму зі шкалою оцінювання. Адресу будуємо з
// поточної сторінки, тож однаково працює і на GitHub Pages, і локально.
function filmLink(film) {
  if (!film || typeof film !== 'object' || !film.id) return '';
  try {
    return `${location.origin}${location.pathname}?film=${encodeURIComponent(String(film.id))}`;
  } catch (e) {
    return '';
  }
}

// Назва фільму для повідомлення: якщо є посилання — назва САМА і є
// клікабельним посиланням (окремого рядка з URL більше немає).
// Голий рядок замість об'єкта теж переживаємо (захист від старих викликів):
// тоді просто виводимо його без посилання.
function filmNameHTML(film) {
  const title = (typeof film === 'string' ? film : filmTitle(film)) || 'Без назви';
  const link = filmLink(film);
  const name = esc(`«${title}»`);
  return link ? `<a href="${esc(link)}">${name}</a>` : name;
}

// Чисті збирачі тексту (експортовані для тестів — нічого не надсилають)
export function filmAddedText(userId, film) {
  const year = film && typeof film === 'object' && film.year ? ` (${film.year})` : '';
  return `${esc(userName(userId))} додав фільм ${filmNameHTML(film)}${year}`;
}

export function filmDeletedText(userId, title) {
  return `${esc(userName(userId))} видалив фільм ${filmNameHTML(String(title || ''))}`;
}

export function ratingSetText(userId, film, score, prev) {
  const name = filmNameHTML(film);
  return (prev != null && prev !== score)
    ? `${esc(userName(userId))} змінив оцінку ${name}: ${prev} → ${score}`
    : `${esc(userName(userId))} оцінив фільм ${name} на ${score}/10`;
}

export function ratingRemovedText(userId, film) {
  return `${esc(userName(userId))} прибрав свою оцінку фільму ${filmNameHTML(film)}`;
}

// Надсилання готових повідомлень
export function notifyFilmAdded(userId, film) {
  return send(filmAddedText(userId, film));
}

export function notifyFilmDeleted(userId, title) {
  return send(filmDeletedText(userId, title));
}

export function notifyRatingSet(userId, film, score, prev) {
  return send(ratingSetText(userId, film, score, prev));
}

export function notifyRatingRemoved(userId, film) {
  return send(ratingRemovedText(userId, film));
}

// ---------- Ігри: ті самі повідомлення, посилання ?game=<id> ----------

export function gameTitle(g) {
  return (g && (g.titleUk || g.title)) || 'Без назви';
}

function gameLink(game) {
  if (!game || typeof game !== 'object' || !game.id) return '';
  try {
    return `${location.origin}${location.pathname}?game=${encodeURIComponent(String(game.id))}`;
  } catch (e) {
    return '';
  }
}

function gameNameHTML(game) {
  const title = (typeof game === 'string' ? game : gameTitle(game)) || 'Без назви';
  const link = gameLink(game);
  const name = esc(`«${title}»`);
  return link ? `<a href="${esc(link)}">${name}</a>` : name;
}

export function gameAddedText(userId, game) {
  const year = game && typeof game === 'object' && game.year ? ` (${game.year})` : '';
  return `${esc(userName(userId))} додав гру ${gameNameHTML(game)}${year}`;
}

export function gameDeletedText(userId, title) {
  return `${esc(userName(userId))} видалив гру ${gameNameHTML(String(title || ''))}`;
}

export function gameRatingSetText(userId, game, score, prev) {
  const name = gameNameHTML(game);
  return (prev != null && prev !== score)
    ? `${esc(userName(userId))} змінив оцінку ${name}: ${prev} → ${score}`
    : `${esc(userName(userId))} оцінив гру ${name} на ${score}/10`;
}

export function gameRatingRemovedText(userId, game) {
  return `${esc(userName(userId))} прибрав свою оцінку гри ${gameNameHTML(game)}`;
}

export function notifyGameAdded(userId, game) {
  return send(gameAddedText(userId, game));
}

export function notifyGameDeleted(userId, title) {
  return send(gameDeletedText(userId, title));
}

export function notifyGameRatingSet(userId, game, score, prev) {
  return send(gameRatingSetText(userId, game, score, prev));
}

export function notifyGameRatingRemoved(userId, game) {
  return send(gameRatingRemovedText(userId, game));
}

// ---------- Вбудований блок Telegram у вікні «Налаштування» ----------

// Пошук чатів: ~45 с опитуємо getUpdates, поки користувач напише
// /start боту в групі (команди доходять навіть із privacy-режимом)
async function detectChats(token, setStatus) {
  const found = new Map();
  const deadline = Date.now() + 45000;
  let offset = 0;
  while (Date.now() < deadline) {
    let data;
    try {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?timeout=0&offset=${offset}`);
      data = await res.json();
    } catch (e) {
      setStatus('Немає звʼязку з Telegram. Перевірте інтернет або блокувальники.');
      return null;
    }
    if (!data.ok) {
      setStatus('Telegram відповів помилкою: ' + (data.description || 'невідома'));
      return null;
    }
    for (const u of (data.result || [])) {
      offset = Math.max(offset, (u.update_id || 0) + 1);
      const m = u.message || u.edited_message || u.channel_post;
      const chat = m && m.chat;
      if (chat && chat.id != null) {
        found.set(String(chat.id), {
          id: chat.id,
          title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || (`id ${chat.id}`),
          type: chat.type || 'private'
        });
      }
    }
    if (found.size) return [...found.values()];
    setStatus('Чекаю на повідомлення боту… Напишіть /start у групі з ботом.');
    await new Promise(r => setTimeout(r, 2500));
  }
  return []; // таймаут
}


// Малює повну форму Telegram безпосередньо у секції «Налаштувань» —
// статус, токен, пошук чатів, збереження, тест і відключення. Без
// окремого вікна: усе на одному екрані. section — елемент .set-sec.
export function mountSettingsSection(section) {
  let detected = null;   // знайдені чати поточного токена
  let pickedChat = null; // обраний чат

  const q = name => section.querySelector(`[data-tg="${name}"]`);

  function setStatusRow(ok, html) {
    const st = q('status');
    if (st) {
      st.className = 'tg-status' + (ok ? ' ok' : '');
      st.innerHTML = `<i></i><span>${html}</span>`;
    }
  }

  function render() {
    const cur = cfg || {};
    const connected = !!(cur.token && cur.chatId);

    section.innerHTML = `
      <h3 class="set-title">${icons.send}<span>Telegram-сповіщення</span></h3>
      <div class="tg-inline">
        <div class="tg-status ${connected ? 'ok' : ''}" data-tg="status">
          <i></i><span>${connected
            ? `Підключено: <b>${escapeHtml(cur.chatTitle || String(cur.chatId))}</b>${cur.enabled === false ? ' · вимкнено' : ''}`
            : 'Не підключено'}</span>
        </div>

        <p class="set-hint">Створіть бота у <b>@BotFather</b> (команда /newbot), скопіюйте
        токен, додайте бота у вашу групу друзів і напишіть там <b>/start</b>. Конфіг
        зберігається у спільній базі — налаштування потрібне лише один раз.</p>

        <label class="field">
          <span class="field-label">Токен бота</span>
          <input data-tg="token" type="text" autocomplete="off" spellcheck="false"
                 placeholder="123456789:AAE..." value="${escapeHtml(cur.token || '')}">
        </label>

        <div class="tg-actions">
          <button type="button" class="btn" data-tg="find"><span>Знайти чати</span></button>
          ${connected ? '<button type="button" class="btn" data-tg="test"><span>Тестове повідомлення</span></button>' : ''}
          <button type="button" class="btn primary" data-tg="save" disabled><span>Зберегти</span></button>
        </div>

        <div class="tg-chats" data-tg="chats"></div>

        ${connected ? `
        <div class="tg-foot">
          <label class="tg-toggle">
            <input type="checkbox" data-tg="enabled" ${cur.enabled === false ? '' : 'checked'}>
            <span>Увімкнено</span>
          </label>
          <button type="button" class="btn danger-ghost" data-tg="disconnect"><span>Відключити</span></button>
        </div>` : ''}
      </div>
    `;

    detected = null;
    pickedChat = null;
    wire(cur, connected);
  }

  async function findChats() {
    const token = q('token').value.trim();
    if (!token || !/^\d+:[\w-]+$/.test(token)) {
      toast('Вкажіть коректний токен бота (з @BotFather)', 'err');
      return;
    }
    const chatsBox = q('chats');
    const findBtn = q('find');
    findBtn.disabled = true;
    chatsBox.innerHTML = '<div class="tg-wait">Шукаю повідомлення боту…</div>';
    const res = await detectChats(token, (msg) => {
      const w = chatsBox.querySelector('.tg-wait');
      if (w) w.textContent = msg;
    });
    findBtn.disabled = false;
    if (res === null) { chatsBox.innerHTML = ''; return; } // помилка — статус уже показано
    if (!res.length) {
      chatsBox.innerHTML = '<div class="tg-wait">Повідомлень не знайдено. Переконайтеся, що бот доданий у групу і ви написали /start.</div>';
      return;
    }
    detected = res;
    pickedChat = res.length === 1 ? res[0] : pickedChat;
    chatsBox.innerHTML = res.map((c, i) => `
      <label class="tg-chat ${res.length === 1 ? 'picked' : ''}">
        <input type="radio" name="tgchat" value="${i}" ${res.length === 1 ? 'checked' : ''}>
        <span class="tg-chat-title">${escapeHtml(c.title)}</span>
        <span class="tg-chat-type">${c.type === 'private' ? 'особистий' : 'група'}</span>
      </label>`).join('');
    q('save').disabled = false;
    if (res.length === 1) setStatusRow(true, `Знайдено чат: <b>${escapeHtml(res[0].title)}</b> — тисніть «Зберегти»`);
    else setStatusRow(false, 'Оберіть чат зі списку нижче і збережіть');
  }

  function wire(cur, connected) {
    q('find').addEventListener('click', findChats);

    const chatsBox = q('chats');
    chatsBox.addEventListener('change', (e) => {
      const rb = e.target.closest('input[type="radio"]');
      if (!rb || !detected) return;
      pickedChat = detected[+rb.value];
      chatsBox.querySelectorAll('.tg-chat').forEach(el => el.classList.remove('picked'));
      rb.closest('.tg-chat').classList.add('picked');
      setStatusRow(true, `Обрано: <b>${escapeHtml(pickedChat.title)}</b>`);
    });

    const saveBtn = q('save');
    saveBtn.addEventListener('click', async () => {
      const token = q('token').value.trim();
      if (!pickedChat) { toast('Спочатку знайдіть і оберіть чат', 'err'); return; }
      saveBtn.disabled = true;
      try {
        await store.setTgConfig({
          enabled: !cfg || cfg.enabled !== false,
          token,
          chatId: pickedChat.id,
          chatTitle: pickedChat.title,
          savedAt: Date.now()
        });
        toast('Telegram підключено');
        render(); // перечитати конфіг: показати «Тест» і «Відключити»
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти налаштування', 'err');
        saveBtn.disabled = false;
      }
    });

    const testBtn = q('test');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        const token = q('token').value.trim() || cur.token;
        const chatId = pickedChat ? pickedChat.id : cur.chatId;
        try {
          await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: 'Перевірка звʼязку з Фільмотекою — усе працює' })
          });
          toast('Тест надіслано — перевірте Telegram');
        } catch (e) {
          toast('Не вдалося надіслати тест', 'err');
        }
        testBtn.disabled = false;
      });
    }

    const enabledBox = q('enabled');
    if (enabledBox) {
      enabledBox.addEventListener('change', async () => {
        try {
          await store.setTgConfig({ ...cfg, enabled: enabledBox.checked });
          toast(enabledBox.checked ? 'Сповіщення увімкнено' : 'Сповіщення вимкнено');
          setStatusRow(enabledBox.checked,
            `Підключено: <b>${escapeHtml(cur.chatTitle || String(cur.chatId))}</b>${enabledBox.checked ? '' : ' · вимкнено'}`);
        } catch (err) {
          console.error(err);
          toast('Не вдалося змінити стан', 'err');
          enabledBox.checked = !enabledBox.checked;
        }
      });
    }

    const discBtn = q('disconnect');
    if (discBtn) {
      discBtn.addEventListener('click', async () => {
        try {
          await store.setTgConfig(null);
          toast('Telegram відключено');
          render();
        } catch (err) {
          console.error(err);
          toast('Не вдалося відключити', 'err');
        }
      });
    }
  }

  render();
}
