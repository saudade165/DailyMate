// Small, dependency-free charts shared by Progress and Admin.
// One series per chart (the heading names it, so there's no legend), thin bars
// with rounded tops anchored to the baseline, a tooltip on hover/keyboard focus,
// and a "Show as a table" view so no number is only available as a picture.

import { esc } from './ui.js';

/**
 * points: [{ label: 'Oct 21', value: 3, tip: 'Oct 21: 3 tasks' }]
 * opts: { ariaLabel, valueLabel (table header), highlightLast }
 */
export function barChart(points, { ariaLabel, valueLabel = 'Value', highlightLast = false } = {}) {
  if (!points.length) return '<p class="muted">No data for this range.</p>';
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 640; const H = 180; const top = 12; const bottom = 24; const left = 28;
  const plotH = H - top - bottom;
  const step = (W - left) / points.length;
  const barW = Math.max(2, Math.min(28, step - 2)); // 2px gap between neighbouring bars
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const y = (v) => top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(points.length / 7);
  const bars = points.map((p, i) => {
    const x = left + i * step + (step - barW) / 2;
    const h = (p.value / max) * plotH;
    const r = Math.min(4, barW / 2, h);
    const path = p.value > 0
      ? `M${x},${top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
    const last = highlightLast && i === points.length - 1;
    return `<g class="chart__col" data-tip="${esc(p.tip)}" tabindex="0" role="listitem" aria-label="${esc(p.tip)}">
      <rect x="${left + i * step}" y="${top}" width="${step}" height="${plotH}" fill="transparent"></rect>
      ${path ? `<path class="chart__bar${last ? ' chart__bar--current' : ''}" d="${path}"></path>` : ''}
      ${i % labelEvery === 0 || i === points.length - 1 ? `<text class="chart__x" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : ''}
    </g>`;
  }).join('');
  return `
    <div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">
        ${ticks.map((t) => `<line class="chart__grid" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line>
          <text class="chart__y" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        <g role="list">${bars}</g>
      </svg>
      <div class="chart__tip" hidden></div>
    </div>
    <details class="details"><summary>Show as a table</summary>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">When</th><th scope="col">${esc(valueLabel)}</th></tr></thead>
      <tbody>${points.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.value}</td></tr>`).join('')}</tbody></table></div>
    </details>`;
}

/** A progress ring. `pct` 0–100. The fill animates in unless the person prefers reduced motion. */
export function ring(pct, { size = 112, stroke = 10, label = '', sub = '', tone = 'primary' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `
    <div class="ring ring--${tone}" style="--ring-size:${size}px">
      <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"></circle>
        <circle class="ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
                stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" style="--ring-c:${c.toFixed(2)}"
                transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
      </svg>
      <span class="ring__label"><strong>${esc(label)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    </div>`;
}

// Tooltips for every chart on the page (pointer and keyboard).
function showTip(target) {
  const col = target?.closest?.('[data-tip]');
  const chart = target?.closest?.('[data-chart]');
  const tip = chart?.querySelector('.chart__tip');
  if (!tip) return;
  if (!col) { tip.hidden = true; return; }
  const box = chart.getBoundingClientRect();
  const r = col.getBoundingClientRect();
  tip.textContent = col.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - box.left, 60), box.width - 60)}px`;
}
const hideTips = (root) => root.querySelectorAll?.('.chart__tip').forEach((t) => { t.hidden = true; });
document.addEventListener('pointerover', (e) => { if (e.target.closest?.('[data-chart]')) showTip(e.target); });
document.addEventListener('focusin', (e) => { if (e.target.closest?.('[data-chart]')) showTip(e.target); });
document.addEventListener('pointerleave', (e) => { if (e.target.matches?.('[data-chart]')) hideTips(e.target); }, true);
document.addEventListener('focusout', (e) => { if (e.target.closest?.('[data-chart]')) hideTips(e.target.closest('[data-chart]')); });
