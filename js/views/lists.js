// Lists — shopping lists, packing lists and other checklists.
// Address: #/lists (all lists) or #/lists/<id> (one list).

import * as store from '../store.js';
import { openListDialog, confirmAction } from '../dialogs.js';
import { emptyState } from '../components.js';
import { LIST_TEMPLATES } from '../templates.js';
import { esc, icon, toast } from '../ui.js';

let editingItemId = null;
let lastAddError = '';
let shownListId = null; // reset per-list state when another list is opened

export function pageTitle(params) {
  const list = params[0] ? store.getList(params[0]) : null;
  return list ? `${list.name} — Lists` : 'Lists';
}

const progressOf = (list) => {
  const done = list.items.filter((i) => i.done).length;
  return { done, total: list.items.length, pct: list.items.length ? Math.round((done / list.items.length) * 100) : 0 };
};

function progressBar(list, label) {
  const p = progressOf(list);
  return `<div class="progress progress--blue" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-valuetext="${p.done} of ${p.total} done"><span style="width:${p.pct}%"></span></div>`;
}

function listCard(list, current) {
  const p = progressOf(list);
  const status = p.total === 0 ? 'Empty' : p.done === p.total ? 'All done' : `${p.done} of ${p.total} done`;
  return `
    <li>
      <a class="list-card${list.id === current ? ' is-current' : ''}" href="#/lists/${encodeURIComponent(list.id)}" ${list.id === current ? 'aria-current="page"' : ''}>
        <span class="list-card__icon">${icon('list')}</span>
        <span class="list-card__body">
          <span class="list-card__name">${esc(list.name)}</span>
          <span class="list-card__status">${esc(status)}</span>
          ${progressBar(list, `${list.name} progress`)}
        </span>
        ${icon('chevron-right', 'list-card__chev')}
      </a>
    </li>`;
}

function quickTemplates() {
  return `
    <div class="quick-templates">
      ${LIST_TEMPLATES.map((t) => `<button class="btn btn--outline" type="button" data-action="quick" data-template="${t.id}">${icon(t.icon)}${esc(t.name)}</button>`).join('')}
      <button class="btn btn--primary" type="button" data-action="new-list">${icon('plus')}My own list</button>
    </div>`;
}

function renderOverview() {
  const lists = store.getLists();
  if (!lists.length) {
    return `
      <section class="card">
        ${emptyState({
          iconName: 'list',
          heading: 'Keep your checklists in one place',
          text: 'Make a list for groceries, errands or a trip, and tick things off as you go. Start with a ready-made list or make your own.',
        })}
        ${quickTemplates()}
      </section>`;
  }
  return `
    <section class="card" aria-labelledby="all-lists-h">
      <div class="card__head">
        <h2 class="card__title" id="all-lists-h">Your lists <span class="tab__count">${lists.length}</span></h2>
      </div>
      <ul class="list-cards list-cards--grid">${lists.map((l) => listCard(l, null)).join('')}</ul>
    </section>`;
}

function itemRow(listId, item, index, count) {
  const iid = esc(item.id);
  if (item.id === editingItemId) {
    return `
      <li class="item is-editing">
        <form class="item__edit" data-form="edit-item" data-id="${iid}">
          <label class="visually-hidden" for="edit-${iid}">Edit item</label>
          <input class="input" id="edit-${iid}" name="text" value="${esc(item.text)}" maxlength="${store.LIMITS.ITEM_MAX}" data-focus-key="edit-${iid}" required>
          <button class="btn btn--primary btn--sm" type="submit">Save</button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="cancel-edit" data-id="${iid}">Cancel</button>
          ${item.done ? '' : `<span class="item__edit-move">
            <button class="btn btn--outline btn--sm" type="button" data-action="up" data-id="${iid}" ${index === 0 ? 'disabled' : ''}>${icon('chevron-up')}Move up</button>
            <button class="btn btn--outline btn--sm" type="button" data-action="down" data-id="${iid}" ${index === count - 1 ? 'disabled' : ''}>${icon('chevron-down')}Move down</button>
          </span>`}
        </form>
      </li>`;
  }
  return `
    <li class="item${item.done ? ' is-done' : ''}">
      <label class="check">
        <input type="checkbox" data-action="toggle-item" data-id="${iid}" data-focus-key="itoggle-${iid}" ${item.done ? 'checked' : ''}>
        <span class="check__box" aria-hidden="true">${icon('check')}</span>
        <span class="visually-hidden">${item.done ? 'Done' : 'Mark as done'}: ${esc(item.text)}</span>
      </label>
      <span class="item__text">${esc(item.text)}</span>
      <span class="item__actions">
        ${item.done ? '' : `
          <button class="icon-btn" type="button" data-action="up" data-id="${iid}" data-focus-key="up-${iid}" aria-label="Move up: ${esc(item.text)}" title="Move up" ${index === 0 ? 'disabled' : ''}>${icon('chevron-up')}</button>
          <button class="icon-btn" type="button" data-action="down" data-id="${iid}" data-focus-key="down-${iid}" aria-label="Move down: ${esc(item.text)}" title="Move down" ${index === count - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>`}
        <button class="icon-btn" type="button" data-action="edit-item" data-id="${iid}" data-focus-key="iedit-${iid}" aria-label="Edit: ${esc(item.text)}" title="Edit">${icon('edit')}</button>
        <button class="icon-btn icon-btn--danger" type="button" data-action="delete-item" data-id="${iid}" aria-label="Delete: ${esc(item.text)}" title="Delete">${icon('trash')}</button>
      </span>
    </li>`;
}

function renderDetail(list) {
  const p = progressOf(list);
  const todo = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);
  const full = list.items.length >= store.LIMITS.ITEMS_PER_LIST_MAX;
  return `
    <section class="card list-detail" aria-labelledby="list-h">
      <a class="back-link" href="#/lists">${icon('arrow-left')}All lists</a>
      <div class="card__head card__head--wrap">
        <div class="list-detail__title">
          <h2 class="list-detail__name" id="list-h">${esc(list.name)}</h2>
          <p class="card__subtitle">${p.total ? `${p.done} of ${p.total} done${p.done === p.total ? ' — all done!' : ''}` : 'No items yet'}</p>
        </div>
        <div class="list-detail__tools">
          <button class="btn btn--outline btn--sm" type="button" data-action="rename" data-focus-key="rename">${icon('edit')}Rename</button>
          <button class="btn btn--outline btn--sm btn--danger-outline" type="button" data-action="delete-list" data-focus-key="delete-list">${icon('trash')}Delete list</button>
        </div>
      </div>
      ${p.total ? progressBar(list, 'List progress') : ''}

      <form class="add-item" data-form="add-item" novalidate>
        <label class="visually-hidden" for="add-item-input">Add an item to ${esc(list.name)}</label>
        <input class="input" id="add-item-input" name="text" type="text" maxlength="${store.LIMITS.ITEM_MAX}" autocomplete="off"
               placeholder="${full ? 'This list is full' : 'Add an item, then press Enter'}" data-focus-key="add-item" ${full ? 'disabled' : ''}
               ${lastAddError ? 'aria-invalid="true" aria-describedby="add-item-error"' : ''}>
        <button class="btn btn--primary" type="submit" ${full ? 'disabled' : ''}>${icon('plus')}Add</button>
      </form>
      ${lastAddError ? `<p class="field__error" id="add-item-error">${esc(lastAddError)}</p>` : ''}

      ${list.items.length === 0 ? emptyState({ iconName: 'check-circle', heading: 'This list is empty', text: 'Type the first item above and press Enter. You can add as many as you like.' }) : ''}
      ${todo.length ? `<ul class="items" aria-label="To get">${todo.map((i, n) => itemRow(list.id, i, n, todo.length)).join('')}</ul>` : ''}
      ${!todo.length && done.length ? `<p class="all-done">${icon('check-circle')}Everything on this list is done.</p>` : ''}
      ${done.length ? `
        <section class="task-group" aria-labelledby="done-items-h">
          <div class="items-done-head">
            <h3 class="task-group__title" id="done-items-h">Done <span class="tab__count">${done.length}</span></h3>
            <div class="items-done-tools">
              <button class="btn btn--ghost btn--sm" type="button" data-action="uncheck-all" data-focus-key="uncheck-all">Uncheck all</button>
              <button class="btn btn--ghost btn--sm" type="button" data-action="clear-done" data-focus-key="clear-done">Remove done items</button>
            </div>
          </div>
          <ul class="items">${done.map((i, n) => itemRow(list.id, i, n, done.length)).join('')}</ul>
        </section>` : ''}
    </section>`;
}

export function render(params) {
  if (params[0] !== shownListId) {
    shownListId = params[0];
    lastAddError = '';
    editingItemId = null;
  }
  const lists = store.getLists();
  const list = params[0] ? store.getList(params[0]) : null;
  const missing = params[0] && !list;

  return `
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Lists</p>
          <h1 class="page-title">${list ? esc(list.name) : 'Your lists'}</h1>
          <p class="page-subtitle">${lists.length ? 'Tick things off as you go. Your lists are saved on this device.' : 'Groceries, errands, a packing list — whatever you need to remember.'}</p>
        </div>
        <button class="btn btn--primary btn--lg" type="button" data-action="new-list" data-focus-key="new-list">${icon('plus')}New list</button>
      </header>
      ${missing ? `
        <section class="card">${emptyState({ iconName: 'alert', heading: 'This list doesn’t exist', text: 'It may have been deleted, or the link is from another device.', action: '<a class="btn btn--primary" href="#/lists">See all lists</a>' })}</section>` : ''}
      ${list ? `
        <div class="lists-layout">
          <aside class="lists-side" aria-label="All lists">
            <ul class="list-cards">${lists.map((l) => listCard(l, list.id)).join('')}</ul>
          </aside>
          ${renderDetail(list)}
        </div>` : missing ? '' : renderOverview()}
    </div>`;
}

export function afterRender(params) {
  if (editingItemId) {
    const input = document.getElementById(`edit-${editingItemId}`);
    if (input && document.activeElement !== input) { input.focus(); input.select(); }
  }
}

// ---- Events -------------------------------------------------------------------------

const openList = (list) => { location.hash = `#/lists/${encodeURIComponent(list.id)}`; };

export async function onClick(e, ctx) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const listId = ctx.params()[0];
  const list = listId ? store.getList(listId) : null;
  const { action, id } = el.dataset;

  switch (action) {
    case 'new-list':
      openListDialog({ onSaved: openList });
      break;
    case 'quick': {
      const tpl = LIST_TEMPLATES.find((t) => t.id === el.dataset.template);
      try {
        openList(store.addList(tpl.name, tpl.items));
        toast(`${tpl.name} list created`);
      } catch {
        toast(`You can have up to ${store.LIMITS.LISTS_MAX} lists.`, { tone: 'error' });
      }
      break;
    }
    case 'rename':
      if (list) openListDialog({ list });
      break;
    case 'delete-list': {
      if (!list) return;
      const ok = await confirmAction({
        title: 'Delete this list?',
        message: `“${list.name}” and its ${list.items.length} ${list.items.length === 1 ? 'item' : 'items'} will be deleted.`,
        confirmLabel: 'Delete list',
      });
      if (!ok) return;
      const index = store.getLists().findIndex((l) => l.id === list.id);
      store.deleteList(list.id);
      location.hash = '#/lists';
      toast('List deleted', { action: { label: 'Undo', onClick: () => { store.restoreList(list, index); openList(list); } } });
      break;
    }
    case 'edit-item':
      editingItemId = id;
      ctx.rerender();
      break;
    case 'cancel-edit':
      editingItemId = null;
      ctx.rerender();
      document.querySelector(`[data-focus-key="iedit-${CSS.escape(id ?? '')}"]`)?.focus();
      break;
    case 'delete-item': {
      if (!list) return;
      const removed = store.deleteItem(list.id, id);
      if (removed) {
        toast(`Removed “${removed.item.text}”`, { action: { label: 'Undo', onClick: () => store.restoreItem(list.id, removed.item, removed.index) } });
        document.getElementById('add-item-input')?.focus();
      }
      break;
    }
    case 'up':
    case 'down': {
      if (!list) return;
      // Move within the "to get" items only, skipping done ones in between.
      const todo = list.items.filter((i) => !i.done);
      const pos = todo.findIndex((i) => i.id === id);
      const target = todo[pos + (action === 'up' ? -1 : 1)];
      if (!target) return;
      const from = list.items.findIndex((i) => i.id === id);
      const to = list.items.findIndex((i) => i.id === target.id);
      store.moveItem(list.id, id, to - from);
      break;
    }
    case 'uncheck-all':
      if (list) { store.uncheckAll(list.id); toast('All items unchecked'); }
      break;
    case 'clear-done': {
      if (!list) return;
      const n = list.items.filter((i) => i.done).length;
      const ok = await confirmAction({
        title: 'Remove done items?',
        message: `${n} ticked-off ${n === 1 ? 'item' : 'items'} will be removed from “${list.name}”.`,
        confirmLabel: 'Remove',
      });
      if (ok) {
        const before = list;
        store.clearCompleted(list.id);
        toast(`Removed ${n} ${n === 1 ? 'item' : 'items'}`, {
          action: { label: 'Undo', onClick: () => store.putList(before) },
        });
      }
      break;
    }
    default:
  }
}

export function onChange(e, ctx) {
  const el = e.target;
  if (el.dataset.action !== 'toggle-item') return;
  const listId = ctx.params()[0];
  store.updateItem(listId, el.dataset.id, { done: el.checked });
  const list = store.getList(listId);
  if (el.checked && list.items.every((i) => i.done)) toast('Everything on this list is done!');
}

export function onSubmit(e, ctx) {
  const form = e.target;
  const listId = ctx.params()[0];
  if (form.dataset.form === 'add-item') {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) {
      lastAddError = 'Type something to add first.';
      ctx.rerender();
      return;
    }
    // Clear the field first: saving re-renders the page and keeps whatever is typed.
    form.elements.text.value = '';
    try {
      store.addItem(listId, text);
      lastAddError = '';
      ctx.rerender();
      document.getElementById('add-item-input')?.focus();
    } catch {
      form.elements.text.value = text;
      toast('This list is full.', { tone: 'error' });
    }
  }
  if (form.dataset.form === 'edit-item') {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    const { id } = form.dataset;
    store.updateItem(listId, id, { text });
    editingItemId = null;
    ctx.rerender();
    document.querySelector(`[data-focus-key="iedit-${CSS.escape(id)}"]`)?.focus();
    toast('Item updated');
  }
}

export function onKeydown(e, ctx) {
  if (e.key === 'Escape' && editingItemId && e.target.closest('.item__edit')) {
    const id = editingItemId;
    editingItemId = null;
    ctx.rerender();
    document.querySelector(`[data-focus-key="iedit-${CSS.escape(id)}"]`)?.focus();
  }
}

export function onInput(e) {
  if (lastAddError && e.target.id === 'add-item-input') {
    lastAddError = '';
    e.target.removeAttribute('aria-invalid');
    document.getElementById('add-item-error')?.remove();
  }
}
