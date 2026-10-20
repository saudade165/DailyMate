// Placeholder for sections that are not built yet. It says so plainly and
// points back to what already works.

import { esc, icon } from '../ui.js';

export function render(route) {
  return `
    <div class="page">
      <header class="page-head">
        <div>
          <h1 class="page-title">${esc(route.label)}</h1>
        </div>
      </header>
      <section class="card soon">
        <div class="soon__icon">${icon(route.icon)}</div>
        <p class="badge badge--lg">${icon('tools')}Coming soon${route.plus ? ' · DailyMate Plus' : ''}</p>
        <h2 class="soon__title">This section isn’t ready yet</h2>
        <p class="soon__text">${esc(route.blurb)}</p>
        <p class="soon__hint">${esc(route.meanwhile)}</p>
        <a class="btn btn--primary btn--lg" href="#/my-day">${icon('home')}Go to My Day</a>
      </section>
    </div>`;
}
