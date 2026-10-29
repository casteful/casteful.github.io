// ============================================================
// Компонент «шкала оцінки» (зорі 1–10) — СПІЛЬНИЙ для трьох місць:
//  • спливашка швидкого оцінювання (films.js)
//  • модальне вікно фільму (films.js)
//  • форма додавання/редагування (film-form.js)
// 10 зірочок, заливаються кольором до обраного значення (від
// червоного до зеленого), над шкалою — велике число і слово-підпис.
// Наведення показує прев'ю, клік зберігає (через onPick).
// ============================================================

export const RATE_LABELS = {
  1: 'Жах', 2: 'Дуже погано', 3: 'Погано', 4: 'Слабко', 5: 'Так собі',
  6: 'Нормально', 7: 'Добре', 8: 'Дуже добре', 9: 'Чудово', 10: 'Шедевр'
};

// Зірочка для шкали оцінки (розмір/колір керується CSS)
export const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.9l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.4l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/></svg>';

import * as U from './utils.js';

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

// Наведення/клік для шкали. onPick(s) викликається з обраним числом —
// рішення «зберігати чи прибрати» ухвалює виклик (модалка прибирає
// оцінку повторним кліком, форма просто запам'ятовує значення).
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
