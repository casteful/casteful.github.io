// ============================================================
// Гра «Вгадай оцінку» — два режими:
//   1) «Рейтинг друга» — показуємо фільм і друга, ти вгадуєш
//      його оцінку на звичній шкалі 1–10;
//   2) «Середня команди» — фільм оцінили кілька друзів, ти
//      вгадуєш їхню середню оцінку (слайдер 1,0–10,0).
//
// Матч = 5 раундів. Бали за раунд: 5 / 3 / 1 / 0
//   друг:     точно = 5, помилка на 1 = 3, на 2 = 1;
//   середня:  похибка ≤ 0,25 = 5, ≤ 1,0 = 3, ≤ 2,0 = 1.
// Власні оцінки не вгадуємо і в середнє не включаємо.
//
// Доведений до кінця матч транзакцією пишеться у вузол quizScores —
// окремо для кожного режиму: quizScores/{userId} =
//   { name, updatedAt, friend: {best, games, exact, updatedAt},
//     average: {best, games, exact, updatedAt} }.
// З них будуються ДВІ live-таблиці лідерів — своя для кожного режиму.
// Недограний матч у базу не пишеться (щоб не «витирав» легкі
// запитання до результату).
//
// Фільми в грі не повторюються: відповіджені фільми запам'ятовуються
// (localStorage, окремо за профіль і режим) і не показуються знову,
// доки є незіграні. Коли всі фільми вже були — починається новий круг.
// ============================================================

import { USERS } from './config.js?v=5.9';
import * as U from './utils.js?v=5.9';
import * as store from './store.js?v=5.9';
import * as A from './avatars.js?v=5.9';
import { icons, toast, confirmDialog } from './ui.js?v=5.9';

const RATE_LABELS = {
  1: 'Жах', 2: 'Дуже погано', 3: 'Погано', 4: 'Слабко', 5: 'Так собі',
  6: 'Нормально', 7: 'Добре', 8: 'Дуже добре', 9: 'Чудово', 10: 'Шедевр'
};

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.9l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.4l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/></svg>';

const ROUNDS_TOTAL = 5;               // раундів у матчі
const MAX_POINTS = ROUNDS_TOTAL * 5;  // 25 — максимум за матч

const BOARD_TITLES = {                // окремі таблиці лідерів за режимами
  friend: 'Хто найкраще знає друзів',
  average: 'Хто найкраще відчуває команду'
};

let container = null;
let stageEl = null;
let filmsList = [];
let currentUserId = null;
let boardScores = {};        // quizScores із бази (live-підписка)
let boardStarted = false;
let playedByMode = { friend: new Set(), average: new Set() }; // зіграні фільми (id)

let phase = 'idle';          // idle | guessing | revealed | summary | empty
let mode = 'friend';         // friend | average — режим поточного матчу
let match = null;            // { round, points, exact, streak, rounds[], saved, newRecord }
let q = null;                // запитання { filmId, friendId, guess, result, freshCycle }

// ---------- Публічний інтерфейс ----------

export function mount(el) {
  // mount() викликається з renderTab() на кожному снапшоті бази —
  // якщо каркас уже живе у DOM, просто перемальовуємо стан гри
  if (container === el && stageEl && document.contains(stageEl)) { render(); return; }
  container = el;
  buildSkeleton();
  if (!boardStarted) {
    boardStarted = true;
    store.onQuizScores((scores) => {
      boardScores = scores || {};
      // Таблиця лідерів живе на стартовому екрані
      if (phase === 'idle') render();
    });
  }
  render();
}

export function setFilms(list) {
  filmsList = Array.isArray(list) ? list : [];
  prunePlayed(); // прибрати з наборів зіграних id видалених фільмів
  if (!stageEl || !document.contains(stageEl)) return; // вкладка не активна
  // Фільм поточного питання зник або друзі прибрали оцінки — нове питання
  // (рахунок матчу не чіпаємо)
  if (q && !questionStillValid()) pickQuestion();
  if (phase === 'empty') match = null; // пул спорожнів посеред матчу
  render();
}

export function setUser(userId) {
  if (currentUserId === userId) return;
  currentUserId = userId;
  // Новий гравець — назад у меню (матч не переносимо)
  phase = 'idle';
  match = null;
  q = null;
  if (stageEl && document.contains(stageEl)) render();
}

// ---------- Пул запитань ----------

// Друзі (не поточний гравець), які мають числову оцінку фільму
function otherRaters(film) {
  const rs = film.ratings || {};
  return USERS.filter(u => u.id !== currentUserId && rs[u.id] != null && Number.isFinite(Number(rs[u.id])));
}

function poolFor(m) {
  const need = m === 'average' ? 2 : 1;
  return filmsList.filter(f => otherRaters(f).length >= need);
}

function questionStillValid() {
  const film = filmsList.find(f => f.id === q.filmId);
  if (!film) return false;
  const raters = otherRaters(film);
  return mode === 'friend'
    ? raters.some(u => u.id === q.friendId)
    : raters.length >= 2;
}

// ---------- Унікальність фільмів ----------
// Відповіджені (та й пропущені наскрізь) фільми не показуємо знову, поки є
// незіграні. Набір зіграних зберігаємо в localStorage окремо за профіль і
// режим — тож без повторів навіть між матчами й після перезавантаження.
// Коли вільних фільмів не лишається — новий круг (питання про це повідомить).

function playedKey(m) {
  return `quiz_played_${currentUserId || 'anon'}_${m}`;
}
function loadPlayed(m) {
  const s = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(playedKey(m)) || '[]');
    if (Array.isArray(raw)) raw.forEach((id) => { if (typeof id === 'string') s.add(id); });
  } catch (e) {}
  return s;
}
function savePlayed(m) {
  try { localStorage.setItem(playedKey(m), JSON.stringify([...playedByMode[m]])); } catch (e) {}
}
function prunePlayed() {
  if (!filmsList.length) return;
  const ids = new Set(filmsList.map(f => f.id));
  ['friend', 'average'].forEach((m) => {
    const s = playedByMode[m];
    let changed = false;
    s.forEach((id) => { if (!ids.has(id)) { s.delete(id); changed = true; } });
    if (changed) savePlayed(m);
  });
}

// Чистий вибір фільму: 1) випадковий із незіграних (без excludeId — фільм,
// щойно пропущений гравцем); 2) якщо все зіграно — новий круг (freshCycle).
export function chooseFilm(base, playedIds, excludeId) {
  if (!Array.isArray(base) || !base.length) return null;
  const played = playedIds instanceof Set ? playedIds : new Set(playedIds || []);
  let pool = base.filter(f => !played.has(f.id) && f.id !== excludeId);
  let freshCycle = false;
  if (!pool.length) pool = base.filter(f => !played.has(f.id));
  if (!pool.length) {
    played.clear();
    freshCycle = true;
    pool = base.filter(f => f.id !== excludeId);
    if (!pool.length) pool = base;
  }
  return { film: pool[Math.floor(Math.random() * pool.length)], freshCycle };
}

function pickQuestion(excludeId) {
  const pool = poolFor(mode);
  if (!pool.length) { q = null; phase = 'empty'; return; }
  const picked = chooseFilm(pool, playedByMode[mode], excludeId);
  const film = picked.film;
  let friend = null;
  if (mode === 'friend') {
    const raters = otherRaters(film);
    friend = raters[Math.floor(Math.random() * raters.length)];
  }
  q = {
    filmId: film.id,
    friendId: friend ? friend.id : null,
    guess: mode === 'average' ? 6 : null, // стартова позиція слайдера
    result: null,
    freshCycle: picked.freshCycle
  };
  phase = 'guessing';
}

// ---------- Хід матчу ----------

function startMatch(m) {
  mode = m;
  playedByMode[m] = loadPlayed(m); // свіжий набір зіграних для цього профілю
  // Якщо свіжих (незіграних) фільмів менше, ніж потрібно на матч, — новий
  // круг на старті: тоді матч складається лише з унікальних фільмів щоразу,
  // коли бібліотека це взагалі дозволяє (недограні матчі не «палать» пул).
  const base = poolFor(m);
  const unplayed = base.filter(f => !playedByMode[m].has(f.id)).length;
  if (base.length >= ROUNDS_TOTAL && unplayed < ROUNDS_TOTAL) {
    playedByMode[m].clear();
    savePlayed(m);
    toast('Усі фільми вже були в грі — починаємо новий круг');
  }
  match = { round: 0, points: 0, exact: 0, streak: 0, rounds: [], saved: false, newRecord: false };
  pickQuestion();
  if (phase === 'empty') match = null;
  render();
}

function answerFriend(g) {
  if (phase !== 'guessing' || !q || mode !== 'friend') return;
  const film = filmsList.find(f => f.id === q.filmId);
  const friend = USERS.find(u => u.id === q.friendId);
  if (!film || !friend) { pickQuestion(); if (phase === 'empty') match = null; render(); return; }
  const actual = Math.round(Number((film.ratings || {})[q.friendId]));
  const diff = Math.abs(g - actual);
  const pts = diff === 0 ? 5 : diff === 1 ? 3 : diff === 2 ? 1 : 0;
  commitRound({
    title: fTitle(film),
    friendName: friend.name,
    guess: g,
    actual,
    pts,
    over: g > actual
  });
}

function answerAverage() {
  if (phase !== 'guessing' || !q || mode !== 'average') return;
  const film = filmsList.find(f => f.id === q.filmId);
  if (!film) { pickQuestion(); if (phase === 'empty') match = null; render(); return; }
  const guess = Math.round((Number(q.guess) || 6) * 10) / 10;
  const vals = otherRaters(film).map(u => Number((film.ratings || {})[u.id]));
  const actual = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  const diff = Math.round(Math.abs(guess - actual) * 100) / 100;
  const pts = diff <= 0.25 ? 5 : diff <= 1.0 ? 3 : diff <= 2.0 ? 1 : 0;
  commitRound({
    title: fTitle(film),
    friendName: null,
    guess,
    actual,
    pts,
    over: guess > actual
  });
}

function commitRound(r) {
  match.round++;
  match.points += r.pts;
  if (r.pts === 5) { match.exact++; match.streak++; }
  else match.streak = 0;
  match.rounds.push(r);
  if (q && q.filmId) { playedByMode[mode].add(q.filmId); savePlayed(mode); }
  q.guess = r.guess;
  q.result = r;
  phase = 'revealed';
  render();
}

function nextQuestion(excludeId) {
  if (!match) { render(); return; }
  pickQuestion(excludeId);
  if (phase === 'empty') match = null;
  render();
}

function finishMatch() {
  if (!match) { render(); return; }
  phase = 'summary';
  if (!match.saved) {
    match.saved = true;
    const mine = boardScores[currentUserId];
    const prev = (mine && mine[mode] && mine[mode].best) || 0;
    match.newRecord = match.points > prev && match.points > 0;
    if (currentUserId) {
      const me = USERS.find(u => u.id === currentUserId);
      store.saveQuizResult(currentUserId, me ? me.name : currentUserId, mode, match.points, match.exact)
        .then(() => toast(`Результат збережено: «${BOARD_TITLES[mode]}»`))
        .catch((err) => {
          console.warn('[quiz] Не вдалося зберегти результат:', err);
          toast('Не вдалося зберегти результат у таблиці лідерів', 'err');
        });
    }
  }
  render();
}

async function exitMatch() {
  // Достроковий вихід: матч анулюється, у базу нічого не пишеться
  phase = 'idle';
  match = null;
  q = null;
  render();
}

async function confirmExit() {
  try {
    const ok = await confirmDialog({
      title: 'Завершити матч?',
      text: 'Прогрес поточного матчу зникне — у таблицю лідерів нічого не запишеться.',
      confirmText: 'Завершити',
      cancelText: 'Грати далі'
    });
    if (ok) exitMatch();
  } catch (e) { /* модалка не відкрилась — просто виходимо */ exitMatch(); }
}

// 7 -> «7», 7.25 -> «7,3»
function fmtNum(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number.isInteger(Number(v)) ? String(v) : U.fmtAvg(v);
}

// ---------- Малювання ----------

function buildSkeleton() {
  container.innerHTML = `
    <div class="quiz">
      <div class="quiz-head">
        <h2>${icons.spark}<span>Вгадай оцінку</span></h2>
        <p class="quiz-sub">Два режими: вгадай оцінку друга або середню оцінку команди.
        Матч — ${ROUNDS_TOTAL} фільмів без повторів; результат потрапляє в таблицю лідерів свого режиму.</p>
      </div>
      <div class="quiz-score" id="quizScore"></div>
      <div id="quizStage"></div>
    </div>`;
  stageEl = container.querySelector('#quizStage');
}

function chip(val, label, ic) {
  return `<span class="quiz-chip">${ic ? icons[ic] : ''}<span>${label}:</span> <b>${val}</b></span>`;
}

function scoreBarHTML() {
  if (!match) return '';
  const roundNo = phase === 'summary' ? match.round : Math.min(match.round + 1, ROUNDS_TOTAL);
  const chips = [
    chip(`${roundNo}/${ROUNDS_TOTAL}`, 'Раунд'),
    chip(match.points, 'Бали', 'star'),
    chip(match.exact, 'Точних')
  ];
  if (match.streak >= 2) chips.push(chip(match.streak, 'Серія', 'flame'));
  return chips.join('');
}

function fTitle(f) { return f.titleUk || f.title || 'Без назви'; }

function posterHTML(f) {
  return f.poster
    ? `<img class="quiz-poster" src="${U.escapeHtml(U.posterUrl(f.poster, 300))}" alt="Постер: ${U.escapeHtml(fTitle(f))}" referrerpolicy="no-referrer" onerror="this.classList.add('broken'); this.removeAttribute('src')">`
    : `<span class="quiz-poster placeholder">${icons.film}</span>`;
}

function filmHeadHTML(f) {
  const orig = (f.titleUk && f.title && f.titleUk !== f.title) ? f.title : '';
  const meta = [f.year, f.director ? `реж. ${U.escapeHtml(f.director)}` : ''].filter(Boolean).join(' · ');
  return `
    <div class="quiz-filmtext">
      <div class="quiz-title">${U.escapeHtml(fTitle(f))}</div>
      ${orig ? `<div class="quiz-orig">${U.escapeHtml(orig)}</div>` : ''}
      ${meta ? `<div class="quiz-meta">${meta}</div>` : ''}
    </div>`;
}

function scaleHTML(selected, disabled) {
  const stars = Array.from({ length: 10 }, (_, i) => {
    const s = i + 1;
    const on = selected != null && s <= selected;
    return `<button type="button" class="rt-seg ${on ? 'on' : ''}" data-qscore="${s}" style="--c:${U.ratingColor(s)}" aria-label="${s} — ${RATE_LABELS[s]}" ${disabled ? 'disabled' : ''}>${STAR_SVG}</button>`;
  }).join('');
  const word = selected != null ? RATE_LABELS[selected] : 'Твоя здогадка';
  return `
    <div class="rt-display">
      <span class="rt-value"${selected != null ? ` style="color:${U.ratingColor(selected)}"` : ''}>${selected != null ? selected : '—'}</span>
      <span class="rt-word">${word}</span>
    </div>
    <div class="rt-track">${stars}</div>`;
}

function friendRowHTML(u, value) {
  return `
    <li class="quiz-row">
      ${A.avatarHTML(u, 'sm')}
      <span class="quiz-row-name">${u.id === currentUserId ? `${U.escapeHtml(u.name)} (ти)` : U.escapeHtml(u.name)}</span>
      ${value != null
        ? `<span class="quiz-row-score" style="background:${U.ratingColor(value)}">${value}</span>`
        : `<span class="quiz-row-score empty">—</span>`}
    </li>`;
}

// ---------- Стартовий екран: режими + таблиця лідерів ----------

function modeCardsHTML() {
  const mine = currentUserId ? (boardScores[currentUserId] || {}) : {};
  const bestLine = (k) => {
    const b = mine[k] && mine[k].best != null ? mine[k].best : null;
    return b != null
      ? `<span class="qm-best">Твій рекорд: <b>${b}</b>/${MAX_POINTS}</span>`
      : `<span class="qm-best">Ти ще не грав у цьому режимі</span>`;
  };
  return `
    <div class="quiz-modes">
      <button type="button" class="quiz-mode" data-quiz="start-friend">
        <span class="qm-icon">${icons.users}</span>
        <span class="qm-title">Рейтинг друга</span>
        <span class="qm-desc">Показуємо фільм і одного з друзів — вгадай, скільки він поставив.</span>
        <span class="qm-pts">точно <b>+5</b> · помилка на 1 <b>+3</b> · на 2 <b>+1</b></span>
        ${bestLine('friend')}
      </button>
      <button type="button" class="quiz-mode" data-quiz="start-average">
        <span class="qm-icon">${icons.chart}</span>
        <span class="qm-title">Середня команди</span>
        <span class="qm-desc">Фільм оцінили щонайменше двоє друзів — вгадай їхню середню оцінку.</span>
        <span class="qm-pts">похибка ≤0,25 <b>+5</b> · ≤1 <b>+3</b> · ≤2 <b>+1</b></span>
        ${bestLine('average')}
      </button>
    </div>`;
}

function leaderboardHTML(modeKey) {
  const played = [];
  const notPlayed = [];
  USERS.forEach((u) => {
    const rec = boardScores[u.id];
    const s = rec && rec[modeKey] && rec[modeKey].best != null ? rec[modeKey] : null;
    if (s) played.push({ u, s });
    else notPlayed.push({ u });
  });
  played.sort((a, b) =>
    (b.s.best - a.s.best) ||
    ((b.s.games || 0) - (a.s.games || 0)) ||
    a.u.name.localeCompare(b.u.name));
  notPlayed.sort((a, b) => a.u.name.localeCompare(b.u.name));
  const rows = [...played, ...notPlayed];
  const emptyText = modeKey === 'friend'
    ? 'Ще ніхто не дограв матч у цьому режимі — стань першим, хто знає друзів найкраще.'
    : 'Ще ніхто не дограв матч у цьому режимі — спробуй першим вгадати настрій усієї команди.';
  return `
    <div class="quiz-board">
      <div class="quiz-board-head">${icons[modeKey === 'friend' ? 'users' : 'chart']}<h3>${BOARD_TITLES[modeKey]}</h3></div>
      <div class="lb-list">
        ${rows.map((r, i) => {
          const me = r.u.id === currentUserId;
          const val = r.s
            ? `<span class="lb-val"><b>${r.s.best}</b><span class="lb-of">/${MAX_POINTS}</span></span>
               <span class="lb-sub">${r.s.games || 0} ${U.plural(r.s.games || 0, ['матч', 'матчі', 'матчів'])}</span>`
            : `<span class="lb-val muted">—</span><span class="lb-sub">ще не грав</span>`;
          return `
            <div class="lb-row ${me ? 'me' : ''} ${i === 0 && r.s ? 'top' : ''}">
              <span class="lb-place">${i + 1}</span>
              ${A.avatarHTML(r.u, 'sm')}
              <span class="lb-name">${U.escapeHtml(r.u.name)}${me ? ' (ти)' : ''}</span>
              <span class="lb-right">${val}</span>
            </div>`;
        }).join('')}
      </div>
      ${played.length ? '' : `<p class="lb-empty">${emptyText}</p>`}
    </div>`;
}

// Дві окремі таблиці лідерів — своя для кожного режиму
function boardsHTML() {
  return `
    <div class="quiz-boards">
      ${leaderboardHTML('friend')}
      ${leaderboardHTML('average')}
    </div>`;
}

// ---------- Стани гри ----------

function render() {
  if (!stageEl) return;
  const scoreEl = container.querySelector('#quizScore');
  if (scoreEl) scoreEl.innerHTML = scoreBarHTML();

  if (phase === 'idle') {
    stageEl.innerHTML = `
      <div class="quiz-card quiz-start">
        <span class="quiz-bigicon">${icons.clapper}</span>
        <h3>Хто знає смаки друзів найкраще?</h3>
        <p>Обери режим і зіграй матч із ${ROUNDS_TOTAL} фільмів без повторів. У кінці результат іде
        в таблицю лідерів обраного режиму — і ми побачимо, хто тут справжній кінооракул.</p>
      </div>
      ${modeCardsHTML()}
      ${boardsHTML()}`;
    return;
  }

  if (phase === 'empty') {
    const why = mode === 'average'
      ? 'Для цього режиму потрібен фільм, який оцінили щонайменше двоє друзів (крім тебе).'
      : 'Щоб грати, потрібен хоча б один фільм з оцінкою від друга (не від тебе).';
    stageEl.innerHTML = `
      <div class="state-box slim">
        <span class="state-icon">${icons.clapper}</span>
        <h3>Поки що немає що вгадати</h3>
        <p>${why} Постав оцінки разом із друзями — і матч з'явиться.</p>
        <div class="state-actions">
          <button class="btn primary" data-quiz="retry"><span>Спробувати ще</span></button>
          <button class="btn danger-ghost" data-quiz="menu"><span>Змінити режим</span></button>
        </div>
      </div>`;
    return;
  }

  if (phase === 'guessing' && mode === 'friend') { renderGuessFriend(); return; }
  if (phase === 'guessing' && mode === 'average') { renderGuessAverage(); return; }
  if (phase === 'revealed') { renderRevealed(); return; }
  if (phase === 'summary') { renderSummary(); return; }
}

function renderGuessFriend() {
  const f2 = filmsList.find(f => f.id === q.filmId);
  const u2 = USERS.find(u => u.id === q.friendId);
  if (!f2 || !u2) { pickQuestion(); if (phase === 'empty') match = null; render(); return; }
  stageEl.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-film">${posterHTML(f2)}${filmHeadHTML(f2)}</div>
      ${q.freshCycle ? '<div class="quiz-cycle">Усі фільми вже були в грі — починаємо новий круг</div>' : ''}
      <div class="quiz-qrow">
        ${A.avatarHTML(u2, 'lg')}
        <div class="quiz-qtext">Раунд ${match.round + 1} з ${ROUNDS_TOTAL}. Скільки поставив <b>${U.escapeHtml(u2.name)}</b>?</div>
      </div>
      <div class="quiz-scale rt" role="group" aria-label="Твоя здогадка від 1 до 10">${scaleHTML(null, false)}</div>
      <div class="quiz-actions">
        <button class="btn danger-ghost" data-quiz="skip"><span>Інший фільм</span></button>
        <button class="btn ghost" data-quiz="exit"><span>Завершити матч</span></button>
      </div>
    </div>`;
}

function renderGuessAverage() {
  const f2 = filmsList.find(f => f.id === q.filmId);
  if (!f2) { pickQuestion(); if (phase === 'empty') match = null; render(); return; }
  const raters = otherRaters(f2);
  const g = q.guess != null ? q.guess : 6;
  const word = RATE_LABELS[Math.min(10, Math.max(1, Math.round(g)))];
  stageEl.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-film">${posterHTML(f2)}${filmHeadHTML(f2)}</div>
      ${q.freshCycle ? '<div class="quiz-cycle">Усі фільми вже були в грі — починаємо новий круг</div>' : ''}
      <div class="quiz-qrow">
        <div class="quiz-avs">${raters.map(u => A.avatarHTML(u, 'sm')).join('')}</div>
        <div class="quiz-qtext">Раунд ${match.round + 1} з ${ROUNDS_TOTAL}. Яка середня оцінка друзів?
          <div class="quiz-qsub">${raters.length} ${U.plural(raters.length, ['друг оцінив', 'друзі оцінили', 'друзів оцінили'])} цей фільм — здогадка від 1,0 до 10,0</div>
        </div>
      </div>
      <div class="quiz-sliderbox">
        <div class="rt-display">
          <span class="rt-value" style="color:${U.ratingColor(g)}">${fmtNum(g)}</span>
          <span class="rt-word">${word}</span>
        </div>
        <input type="range" class="quiz-range" min="1" max="10" step="0.1" value="${g}" aria-label="Середня оцінка друзів">
        <div class="quiz-range-ends"><span>1,0</span><span>10,0</span></div>
      </div>
      <div class="quiz-actions">
        <button class="btn primary" data-quiz="answer"><span>Відповісти</span></button>
        <button class="btn danger-ghost" data-quiz="skip"><span>Інший фільм</span></button>
        <button class="btn ghost" data-quiz="exit"><span>Завершити</span></button>
      </div>
    </div>`;
}

function renderRevealed() {
  const f2 = filmsList.find(f => f.id === q.filmId);
  if (!f2 || !q.result) { nextQuestion(); return; }
  const r = q.result;
  const verdict = r.pts === 5
    ? {
        cls: 'good', icon: 'check',
        title: mode === 'friend' ? 'Точно! ✨' : 'Влучив у середнє!',
        sub: mode === 'friend' ? 'Ти читаєш їхні смаки як книгу' : 'Майже ідеальне попадання'
      }
    : r.pts === 3
      ? {
          cls: 'mid', icon: 'spark', title: 'Дуже близько!',
          sub: mode === 'friend'
            ? 'Одного бала не вистачило'
            : (r.over ? 'Трохи переоцінив команду' : 'Трохи недооцінив команду')
        }
      : r.pts === 1
        ? {
            cls: 'mid', icon: 'spark', title: 'Поруч!',
            sub: mode === 'friend' ? 'Два бали похибки' : 'Похибка близько двох балів'
          }
        : {
            cls: 'bad', icon: 'close', title: 'Мимо',
            sub: mode === 'friend'
              ? (r.over ? 'Ти думав про нього краще' : 'Ти недооцінив фільм у його очах')
              : (r.over ? 'Команда стриманіша, ніж ти думав' : 'Команда щедріша, ніж ти думав')
          };

  const leftLabel = mode === 'friend' ? 'Ти вгадав' : 'Твоя здогадка';
  const rightLabel = mode === 'friend' ? U.escapeHtml(r.friendName || '') : 'Середня друзів';
  const actualLabel = mode === 'friend' ? `${r.actual} · ${RATE_LABELS[r.actual]}` : fmtNum(r.actual);
  const actualColor = mode === 'friend' ? U.ratingColor(r.actual) : U.ratingColor(Math.round(r.actual));

  const streakLine = match.streak >= 2
    ? `<div class="quiz-streak">${icons.flame}<span>Серія точних вгадів: <b>${match.streak}</b></span></div>`
    : '';

  const isLast = match.round >= ROUNDS_TOTAL;

  stageEl.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-film">${posterHTML(f2)}${filmHeadHTML(f2)}</div>
      <div class="quiz-verdict ${verdict.cls}">
        <span class="qv-icon">${icons[verdict.icon]}</span>
        <span class="qv-title">${verdict.title}</span>
        <span class="qv-sub">${verdict.sub}</span>
        <span class="qv-pts">+${r.pts} ${U.plural(r.pts, ['бал', 'бали', 'балів'])}</span>
      </div>
      <div class="quiz-compare">
        <span class="quiz-cmp"><span class="quiz-cmp-label">${leftLabel}</span><span class="quiz-cmp-val">${fmtNum(r.guess)}</span></span>
        <span class="quiz-cmp-arrow">→</span>
        <span class="quiz-cmp"><span class="quiz-cmp-label">${rightLabel}</span><span class="quiz-cmp-val" style="background:${actualColor}">${actualLabel}</span></span>
      </div>
      ${streakLine}
      <ul class="quiz-others">${USERS.map(u => friendRowHTML(u, (f2.ratings || {})[u.id])).join('')}</ul>
      <div class="quiz-actions">
        <button class="btn primary" data-quiz="${isLast ? 'finish' : 'next'}"><span>${isLast ? 'Результати' : 'Наступний фільм'}</span></button>
        <button class="btn ghost" data-quiz="exit"><span>Завершити матч</span></button>
      </div>
    </div>`;
}

function renderSummary() {
  const pts = match.points;
  const headline = pts === MAX_POINTS ? 'Ідеальний матч!'
    : pts >= MAX_POINTS * 0.7 ? 'Ти справжній кінознавець'
    : pts >= MAX_POINTS * 0.45 ? 'Дуже солідний результат'
    : pts >= MAX_POINTS * 0.2 ? 'Непогано, є куди рости'
    : 'Є над чим працювати';
  const note = currentUserId
    ? `Результат збережено в таблиці «${BOARD_TITLES[mode]}» — друзі його вже бачать.`
    : 'Обери профіль у шапці, щоб результат потрапив у таблицю лідерів.';
  stageEl.innerHTML = `
    <div class="quiz-card quiz-sum">
      <div class="quiz-sum-head">
        <span class="quiz-bigicon small">${icons.trophy}</span>
        <div class="quiz-total">${pts}<span class="quiz-total-of">/${MAX_POINTS}</span></div>
        <div class="quiz-sum-title">${headline}</div>
        ${match.newRecord ? `<div class="quiz-newrec">${icons.spark}<span>Новий особистий рекорд!</span></div>` : ''}
        <p class="quiz-sum-note">${note}</p>
      </div>
      <ul class="quiz-rounds">
        ${match.rounds.map((r, i) => `
          <li class="quiz-round">
            <span class="qr-i">${i + 1}</span>
            <span class="qr-title">${U.escapeHtml(U.trunc(r.title, 36))}</span>
            <span class="qr-val">${fmtNum(r.guess)} → <b>${fmtNum(r.actual)}</b></span>
            <span class="qr-pts ${r.pts >= 3 ? 'good' : r.pts >= 1 ? 'mid' : 'bad'}">+${r.pts}</span>
          </li>`).join('')}
      </ul>
      <div class="quiz-actions">
        <button class="btn primary" data-quiz="again"><span>Грати ще</span></button>
        <button class="btn ghost" data-quiz="menu"><span>Змінити режим</span></button>
      </div>
    </div>`;
}

// ---------- Події ----------

// Гра живе лише коли її розмітка в DOM (вкладка «Гра» активна) —
// це єдина перевірка, яку потрібно пройти всім слухачам нижче
function gameOnScreen() {
  return !!(container && stageEl && document.contains(stageEl));
}

function onClick(e) {
  if (!gameOnScreen()) return;
  const btn = e.target.closest('[data-quiz]');
  if (!btn || !container.contains(btn)) return;
  const act = btn.dataset.quiz;
  if (act === 'start-friend') startMatch('friend');
  else if (act === 'start-average') startMatch('average');
  else if (act === 'retry' || act === 'again') startMatch(mode);
  else if (act === 'skip') nextQuestion(q ? q.filmId : null); // пропущений фільм не раємо зіграним
  else if (act === 'next') nextQuestion();
  else if (act === 'answer') answerAverage();
  else if (act === 'finish') finishMatch();
  else if (act === 'menu') exitMatch();
  else if (act === 'exit') confirmExit();
}

// Наведення/клік по шкалі здогадок (режим друга; делегування — render()
// перемальовує вміст на кожному снапшоті, слухачі на document живуть далі)
function onScaleOver(e) {
  if (phase !== 'guessing' || mode !== 'friend' || !gameOnScreen() || !container.contains(e.target)) return;
  const seg = e.target.closest('.rt-seg[data-qscore]');
  if (seg) paintScale(+seg.dataset.qscore);
}

function onScaleOut(e) {
  if (phase !== 'guessing' || mode !== 'friend' || !gameOnScreen()) return;
  const from = e.target.closest && e.target.closest('.rt-seg[data-qscore]');
  if (!from || !container.contains(from)) return;
  const to = e.relatedTarget;
  if (to && to.closest && to.closest('.rt-seg[data-qscore]')) return;
  paintScale(null);
}

function onScaleClick(e) {
  if (phase !== 'guessing' || mode !== 'friend' || !gameOnScreen() || !container.contains(e.target)) return;
  const seg = e.target.closest('.rt-seg[data-qscore]');
  if (!seg) return;
  answerFriend(+seg.dataset.qscore);
}

function paintScale(s) {
  if (!stageEl) return;
  stageEl.querySelectorAll('.rt-seg[data-qscore]').forEach(el => {
    const on = s != null && +el.dataset.qscore <= s;
    el.classList.toggle('on', on);
  });
  const val = stageEl.querySelector('.rt-value');
  const word = stageEl.querySelector('.rt-word');
  if (val && word) {
    if (s != null) {
      val.textContent = s;
      val.style.color = U.ratingColor(s);
      word.textContent = RATE_LABELS[s];
    } else {
      val.textContent = '—';
      val.style.color = '';
      word.textContent = 'Твоя здогадка';
    }
  }
}

// Слайдер середньої оцінки: живе оновлення великого числа.
// Значення зберігаємо в q.guess, тому перемальовка зі снапшота
// бази не смикає повзунок назад.
function onRangeInput(e) {
  if (phase !== 'guessing' || mode !== 'average' || !gameOnScreen()) return;
  const inp = e.target.closest ? e.target.closest('.quiz-range') : null;
  if (!inp || !container.contains(inp)) return;
  const v = Math.round(parseFloat(inp.value) * 10) / 10;
  if (!Number.isFinite(v)) return;
  if (q) q.guess = v;
  const val = stageEl.querySelector('.rt-value');
  const word = stageEl.querySelector('.rt-word');
  if (val) { val.textContent = fmtNum(v); val.style.color = U.ratingColor(v); }
  if (word) word.textContent = RATE_LABELS[Math.min(10, Math.max(1, Math.round(v)))];
}

// Клавіатура: 1–9 і 0 (=10) — тільки в режимі «Рейтинг друга».
// Працює лише коли фокус не в полі вводу (пошук, форма додавання тощо).
function onKey(e) {
  if (phase !== 'guessing' || mode !== 'friend' || !gameOnScreen()) return;
  if (e.target !== document.body && !container.contains(e.target)) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (e.key >= '1' && e.key <= '9') { e.preventDefault(); answerFriend(+e.key); }
  else if (e.key === '0') { e.preventDefault(); answerFriend(10); }
}

document.addEventListener('click', onClick);
document.addEventListener('mouseover', onScaleOver);
document.addEventListener('mouseout', onScaleOut);
document.addEventListener('click', onScaleClick);
document.addEventListener('keydown', onKey);
document.addEventListener('input', onRangeInput);
