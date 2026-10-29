// ============================================================
// Спільний компонент оцінювання: шкала 1–10 (зорі) і спливашка/
// шіт швидкого оцінювання. Використовується вкладками «Фільми»
// та «Ігри» (quiz має власну копію шкали, історично).
//
// Шкала: 10 зірочок, заливаються кольором до обраного значення
// (від червоного до зеленого), над шкалою — велике число і слово.
// Наведення показує прев'ю, клік зберігає миттєво.
// Спливашка: десктоп — біля кнопки; мобільний (≤640px) — шіт,
// що виїжджає знизу. Клавіатура: 1–9, 0 (=10), ←/→, Esc.
// ============================================================

import * as U from './utils.js?v=5.9';
import { toast, lockScroll, unlockScroll } from './ui.js?v=5.9';

export const RATE_LABELS = {
  1: 'Жах', 2: 'Дуже погано', 3: 'Погано', 4: 'Слабко', 5: 'Так собі',
  6: 'Нормально', 7: 'Добре', 8: 'Дуже добре', 9: 'Чудово', 10: 'Шедевр'
};

// Зірочка для шкали оцінки (розмір/колір керується CSS)
export const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.9l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.4l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/></svg>';

export function rateTrailHTML(selected) {
  const stars = Array.from({ length: 10 }, (_, i) => {
    const s = i + 1;
    const on = selected != null && s <= selected;
    return `<button type="button" class="rt-seg ${on ? 'on' : ''}" data-score="${s}" style="--c:${U.ratingColor(s)}" aria-label="${s} — ${RATE_LABELS[s]}">${STAR_SVG}</button>`;
  }).join('');
  return `
    <div class="rt-display">
      <span class="rt-value"${selected != null ? ` style="color:${U.ratingColor(selected)}"` : ''}>${selected != null ? selected : '—'}</span>
      <span class="rt-word">${selected != null ? RATE_LABELS[selected] : 'Оберіть оцінку'}</span>
    </div>
    <div class="rt-track">${stars}</div>`;
}

// Перемалювати шкалу в контейнері root на значення s (null — «порожньо»)
export function paintTrail(root, s) {
  const track = root.querySelector('.rt-track');
  if (track) {
    track.querySelectorAll('.rt-seg').forEach(c =>
      c.classList.toggle('on', s != null && +c.dataset.score <= s));
  }
  const v = root.querySelector('.rt-value');
  const w = root.querySelector('.rt-word');
  if (!v || !w) return;
  if (s != null) {
    v.textContent = s;
    v.style.color = U.ratingColor(s);
    w.textContent = RATE_LABELS[s];
  } else {
    v.textContent = '—';
    v.style.color = '';
    w.textContent = 'Оберіть оцінку';
  }
}

// Пружний «піп» великого числа при виборі оцінки
export function popValue(root) {
  const v = root.querySelector('.rt-value');
  if (v && v.animate) {
    v.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );
  }
}

// Наведення/клік для шкали (для модалок: делегуйте події на box,
// бо його вміст перестикується на кожному снапшоті Firebase)
export function wireTrail(root, { selected, onPick }) {
  const track = root.querySelector('.rt-track');
  if (!track) return;
  track.addEventListener('mouseover', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (seg) paintTrail(root, +seg.dataset.score);
  });
  track.addEventListener('mouseleave', () => paintTrail(root, selected));
  track.addEventListener('click', (e) => {
    const seg = e.target.closest('.rt-seg');
    if (!seg) return;
    const s = +seg.dataset.score;
    paintTrail(root, s);
    popValue(root);
    onPick(s);
  });
}

// ---------- Спливашка/шіт швидкого оцінювання ----------

let ratePop = null; // { el, backdrop, sheet }

function closeRatePop() {
  if (!ratePop) return;
  const { el, backdrop, sheet } = ratePop;
  ratePop = null;
  document.removeEventListener('mousedown', onPopOutside, true);
  document.removeEventListener('keydown', onPopKey, true);
  window.removeEventListener('scroll', onPopScroll, true);
  window.removeEventListener('resize', onPopScroll);
  if (sheet) unlockScroll(); // фоновий скрол був заблокований на час шіта
  if (backdrop) {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 220);
  }
  el.classList.remove('show');
  setTimeout(() => el.remove(), 220);
}

function onPopOutside(e) {
  if (ratePop && !ratePop.sheet && !ratePop.el.contains(e.target)) closeRatePop();
}

function onPopKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeRatePop(); }
}

function onPopScroll() {
  if (ratePop && !ratePop.sheet) closeRatePop();
}

// Відкрити спливашку оцінювання. Параметри:
//   anchor  — елемент, біля якого показати (на мобільному ігнорується)
//   title   — назва фільму/гри
//   ratings — об'єкт оцінок { userId: score } (для середньої й підпису)
//   currentUserId — чия оцінка (показ/зняття своєї)
//   onSave(next, prev) — async, зберігає; true = успіх (поп закриється)
//   onRemove() — async, клік «Прибрати мою оцінку»; true = успіх
export function openRatePop({ anchor, title, ratings = {}, currentUserId, onSave, onRemove }) {
  if (!currentUserId) { toast('Спочатку оберіть профіль', 'err'); return; }

  const my = ratings[currentUserId];
  const a = U.avg(ratings);
  const votes = Object.keys(ratings).length;

  closeRatePop();
  const pop = document.createElement('div');
  pop.className = 'rate-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Оцінити «${title}»`);
  pop.innerHTML = `
    <div class="pop-grab" aria-hidden="true"></div>
    <div class="rate-pop-title" title="${U.escapeHtml(title)}">${U.escapeHtml(title)}</div>
    <div class="rate-pop-sub">${
      a != null
        ? `Середня <b>${U.fmtAvg(a)}</b> · ${votes} ${U.pluralRatings(votes)}${my != null ? ` · ваша ${my}` : ''}`
        : (my != null ? `Ваша оцінка ${my}` : 'Перший відгук — ваш!')
    }</div>
    <div class="rt" role="group" aria-label="Оцінка від 1 до 10">${rateTrailHTML(my)}</div>
    ${my != null ? '<button type="button" class="remove-rating" data-pop-remove>Прибрати мою оцінку</button>' : ''}`;

  const isSheet = window.matchMedia('(max-width: 640px)').matches;
  let backdrop = null;

  document.body.appendChild(pop);

  if (isSheet) {
    pop.classList.add('sheet');
    backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    lockScroll(); // iOS: сторінка не має скролитися крізь шіт
    backdrop.addEventListener('mousedown', closeRatePop);
    backdrop.addEventListener('click', closeRatePop);
  } else {
    // Позиція біля якоря, з врахуванням меж екрана
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 250;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(10, Math.min(left, vw - pw - 10));
    let top = r.bottom + 8;
    if (top + ph > vh - 10) top = r.top - ph - 8; // не влазить знизу — відкриваємо вгору
    top = Math.max(10, top);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  ratePop = { el: pop, backdrop, sheet: isSheet };
  requestAnimationFrame(() => pop.classList.add('show'));

  // Вибір оцінки: клік по зірці. Повторний клік по тій самій прибирає.
  const pick = async (score) => {
    const cur = ratings[currentUserId];
    const next = (cur === score) ? null : score;
    const ok = await onSave(next, cur != null ? cur : null);
    if (ok) closeRatePop();
  };

  pop.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-pop-remove]');
    if (rm && typeof onRemove === 'function') {
      const ok = await onRemove();
      if (ok) closeRatePop();
    }
  });

  // Шкала: наведення — прев'ю, клік — миттєве збереження
  wireTrail(pop, { selected: my, onPick: pick });

  // Клавіатура: цифри 1–9 та 0 (=10) ставлять оцінку одразу
  pop.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '9') { e.preventDefault(); pick(+e.key); return; }
    if (e.key === '0') { e.preventDefault(); pick(10); return; }
    const segs = [...pop.querySelectorAll('.rt-seg')];
    const idx = segs.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? Math.min(idx + 1, segs.length - 1) : Math.max(idx - 1, 0);
      segs[next].focus();
      paintTrail(pop, +segs[next].dataset.score);
    }
  });

  document.addEventListener('mousedown', onPopOutside, true);
  document.addEventListener('keydown', onPopKey, true);
  window.addEventListener('scroll', onPopScroll, true);
  window.addEventListener('resize', onPopScroll);

  // Фокус всередину для роботи з клавіатури
  if (!isSheet) {
    const onSegs = [...pop.querySelectorAll('.rt-seg.on')];
    const active = onSegs[onSegs.length - 1] || pop.querySelectorAll('.rt-seg')[6] || pop.querySelector('.rt-seg');
    if (active) active.focus({ preventScroll: true });
  }
}
