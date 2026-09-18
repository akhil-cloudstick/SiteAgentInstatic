// The console's one client script. Plain DOM, no framework: the pages are
// server-rendered forms, and this adds the MMS-CMS interaction layer on top —
// dialogs, ⋮ row menus, the themed dropdown, copy buttons, table filters and
// the busy overlay. Every popover closes on an outside click, on scroll and on
// Escape.

type Closer = () => void;
let closeOpenPopover: Closer | null = null;

function closePopover(): void {
  const close = closeOpenPopover;
  closeOpenPopover = null;
  close?.();
}

function registerPopover(close: Closer): void {
  if (closeOpenPopover && closeOpenPopover !== close) closePopover();
  closeOpenPopover = close;
}

function placeBelow(anchor: HTMLElement, pop: HTMLElement, align: 'start' | 'end', matchWidth = false): void {
  const r = anchor.getBoundingClientRect();
  if (matchWidth) pop.style.minWidth = `${r.width}px`;
  pop.style.visibility = 'hidden';
  pop.hidden = false;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.visibility = '';
}

// Outside click, scroll (anywhere but inside the open popover), resize, Escape.
document.addEventListener('pointerdown', (e) => {
  if (!closeOpenPopover) return;
  const t = e.target as Element | null;
  if (t?.closest('[data-popover-open]')) return;
  closePopover();
}, true);
window.addEventListener('scroll', (e) => {
  if (!closeOpenPopover) return;
  const t = e.target as Element | Document | null;
  if (t instanceof Element && t.closest('[data-popover-open]')) return;
  closePopover();
}, true);
window.addEventListener('resize', () => closePopover());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeOpenPopover) {
    e.preventDefault();
    e.stopPropagation();
    closePopover();
  }
}, true);

// ── Dialogs ────────────────────────────────────────────────────────────────
function prefill(dialog: HTMLDialogElement, trigger: HTMLElement): void {
  for (const attr of Array.from(trigger.attributes)) {
    if (attr.name.startsWith('data-prefill-')) {
      // Attribute names arrive lower-cased (HTML is case-insensitive), so the
      // field is matched on its lower-cased name: data-prefill-displayName
      // fills name="displayName".
      const name = attr.name.slice('data-prefill-'.length).toLowerCase();
      const fields = Array.from(
        dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]'),
      ).filter((f) => (f.getAttribute('name') ?? '').toLowerCase() === name);
      fields.forEach((field) => {
        if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox')) {
          field.checked = field.type === 'radio' ? field.value === attr.value : attr.value === 'true' || attr.value === 'on';
        } else {
          field.value = attr.value;
        }
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else if (attr.name.startsWith('data-fill-')) {
      const key = attr.name.slice('data-fill-'.length);
      dialog.querySelectorAll<HTMLElement>(`[data-fill="${key}"]`).forEach((el) => {
        el.textContent = attr.value;
      });
    }
  }
}

export function openModal(id: string, trigger?: HTMLElement): void {
  const dialog = document.getElementById(id);
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (trigger) prefill(dialog, trigger);
  syncConditionals(dialog);
  if (!dialog.open) dialog.showModal();
  const first = dialog.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([disabled]), mms-select button, textarea');
  first?.focus();
}

document.addEventListener('click', (e) => {
  const t = e.target as Element | null;
  const opener = t?.closest<HTMLElement>('[data-open-modal]');
  if (opener) {
    e.preventDefault();
    closePopover();
    openModal(opener.dataset.openModal!, opener);
    return;
  }
  const closer = t?.closest<HTMLElement>('[data-close-modal]');
  if (closer) {
    closer.closest('dialog')?.close();
  }
});

document.querySelectorAll<HTMLDialogElement>('dialog.mms-modal').forEach((dialog) => {
  if (dialog.hasAttribute('data-locked')) {
    dialog.addEventListener('cancel', (e) => e.preventDefault());
  } else {
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  if (dialog.hasAttribute('data-open-on-load')) {
    syncConditionals(dialog);
    dialog.showModal();
  }
});

// ── Conditional fields (`data-show-when="name:value[|value]"`) ────────────
// Hidden fields are disabled too, so they are neither required nor submitted.
function syncConditionals(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-show-when]').forEach((el) => {
    const [name, values] = (el.dataset.showWhen ?? '').split(':');
    const scope = el.closest('form') ?? document;
    const checked = scope.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    const select = scope.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
    const current = checked?.value ?? select?.value ?? '';
    const show = (values ?? '').split('|').includes(current);
    el.hidden = !show;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((f) => {
      f.disabled = !show;
      f.closest('mms-select')?.dispatchEvent(new Event('mms-select:sync'));
    });
  });
}
document.addEventListener('change', () => syncConditionals());
syncConditionals();

// ── ⋮ Row menus ───────────────────────────────────────────────────────────
document.querySelectorAll<HTMLElement>('[data-rowmenu]').forEach((wrap) => {
  const trigger = wrap.querySelector<HTMLButtonElement>('.mms-kebab');
  const menu = wrap.querySelector<HTMLElement>('.mms-menu');
  if (!trigger || !menu) return;
  const close = () => {
    menu.hidden = true;
    menu.removeAttribute('data-popover-open');
    wrap.removeAttribute('data-popover-open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    if (!menu.hidden) {
      closePopover();
      return;
    }
    registerPopover(close);
    wrap.setAttribute('data-popover-open', '');
    menu.setAttribute('data-popover-open', '');
    trigger.setAttribute('aria-expanded', 'true');
    placeBelow(trigger, menu, 'end');
    menu.querySelector<HTMLElement>('.mms-menu__item:not([disabled])')?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('.mms-menu__item:not([disabled])'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'Tab') closePopover();
  });
});

// ── Themed select ─────────────────────────────────────────────────────────
class MmsSelect extends HTMLElement {
  private select!: HTMLSelectElement;
  private button!: HTMLButtonElement;
  private valueEl!: HTMLSpanElement;
  private list: HTMLUListElement | null = null;
  private active = -1;
  private typed = '';
  private typedAt = 0;

  connectedCallback(): void {
    if (this.hasAttribute('data-ready')) return;
    const select = this.querySelector('select');
    if (!select) return;
    this.select = select;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'mms-select__button';
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    const label = select.getAttribute('aria-label') ?? (select.id ? document.querySelector(`label[for="${select.id}"]`)?.textContent : null);
    if (label) this.button.setAttribute('aria-label', label.trim());
    this.valueEl = document.createElement('span');
    this.valueEl.className = 'mms-select__value';
    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down mms-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    this.button.append(this.valueEl, chevron);
    this.append(this.button);
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    this.setAttribute('data-ready', '');
    this.sync();

    select.addEventListener('change', () => this.sync());
    this.addEventListener('mms-select:sync', () => this.sync());
    new MutationObserver(() => this.sync()).observe(select, { childList: true, subtree: true, attributes: true });
    // A required select left empty: send its validation to the visible control.
    select.addEventListener('invalid', () => this.button.focus());
    this.button.addEventListener('click', () => (this.list ? closePopover() : this.open()));
    this.button.addEventListener('keydown', (e) => this.onKey(e));
  }

  private options(): HTMLOptionElement[] {
    return Array.from(this.select.options).filter((o) => !(o.value === '' && o.disabled));
  }

  private sync(): void {
    const opt = this.select.selectedOptions[0];
    const empty = !opt || opt.value === '';
    this.valueEl.textContent = opt?.textContent ?? '';
    this.valueEl.toggleAttribute('data-placeholder', empty);
    this.button.disabled = this.select.disabled;
  }

  private open(): void {
    if (this.select.disabled) return;
    const list = document.createElement('ul');
    list.className = 'mms-select__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('data-popover-open', '');
    const opts = this.options();
    opts.forEach((o, i) => {
      const li = document.createElement('li');
      li.className = 'mms-select__option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(o.selected && o.value !== ''));
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      const text = document.createElement('span');
      text.textContent = o.textContent ?? '';
      if (o.dataset.hint) {
        const hint = document.createElement('small');
        hint.textContent = o.dataset.hint;
        text.append(hint);
      }
      const check = document.createElement('i');
      check.className = 'fa-solid fa-check';
      check.setAttribute('aria-hidden', 'true');
      li.append(text, check);
      li.addEventListener('pointerdown', (e) => e.preventDefault());
      li.addEventListener('click', () => this.choose(i));
      li.addEventListener('pointermove', () => this.setActive(i));
      list.append(li);
    });
    // Inside a dialog the list must live IN the dialog: a <dialog> renders in
    // the browser's top layer, and anything left in the page body paints
    // underneath it — the options would be invisible.
    (this.closest('dialog') ?? document.body).append(list);
    this.list = list;
    this.setAttribute('data-popover-open', '');
    this.button.setAttribute('aria-expanded', 'true');
    placeBelow(this.button, list, 'start', true);
    registerPopover(() => this.close());
    this.setActive(Math.max(0, opts.findIndex((o) => o.selected)));
  }

  private close(): void {
    this.list?.remove();
    this.list = null;
    this.removeAttribute('data-popover-open');
    this.button.setAttribute('aria-expanded', 'false');
  }

  private setActive(i: number): void {
    if (!this.list) return;
    const items = Array.from(this.list.children) as HTMLElement[];
    items.forEach((el, n) => el.toggleAttribute('data-active', n === i));
    this.active = i;
    items[i]?.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const opt = this.options()[i];
    if (!opt || opt.disabled) return;
    this.select.value = opt.value;
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
    this.select.dispatchEvent(new Event('input', { bubbles: true }));
    closePopover();
    this.button.focus();
  }

  private move(delta: number): void {
    const opts = this.options();
    if (!opts.length) return;
    let i = this.active;
    for (let n = 0; n < opts.length; n++) {
      i = (i + delta + opts.length) % opts.length;
      if (!opts[i]!.disabled) break;
    }
    this.setActive(i);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.list) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        this.open();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); this.setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); this.setActive(this.options().length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.choose(this.active); }
    else if (e.key === 'Tab') closePopover();
    else if (e.key.length === 1) {
      // Type-ahead: jump to the first option starting with what was typed.
      const now = Date.now();
      this.typed = now - this.typedAt > 700 ? e.key.toLowerCase() : this.typed + e.key.toLowerCase();
      this.typedAt = now;
      const i = this.options().findIndex((o) => (o.textContent ?? '').trim().toLowerCase().startsWith(this.typed));
      if (i >= 0) this.setActive(i);
    }
  }
}
if (!customElements.get('mms-select')) customElements.define('mms-select', MmsSelect);

// ── Quick picks: `data-check-set="a,b"` ticks exactly those boxes ─────────
document.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-check-set]');
  if (!btn) return;
  const wanted = new Set((btn.dataset.checkSet ?? '').split(',').filter(Boolean));
  const scope = btn.closest('form') ?? document;
  scope.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${btn.dataset.checkName}"]`).forEach((box) => {
    box.checked = wanted.has(box.value);
  });
});

// ── Copy buttons ──────────────────────────────────────────────────────────
// navigator.clipboard needs a secure context; plain http (local access) falls
// back to a hidden textarea.
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy refused');
}

document.addEventListener('click', async (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-copy], [data-copy-target]');
  if (!btn) return;
  const text = btn.dataset.copy ?? document.getElementById(btn.dataset.copyTarget ?? '')?.textContent ?? '';
  try {
    await copyText(text.trim());
    btn.setAttribute('data-copied', '');
    const label = btn.querySelector('.mms-copy-label');
    const before = label?.textContent;
    if (label) label.textContent = 'Copied';
    setTimeout(() => {
      btn.removeAttribute('data-copied');
      if (label && before) label.textContent = before;
    }, 1400);
  } catch {
    /* clipboard blocked: the text stays selectable on screen */
  }
});

// ── Busy overlay for long submissions ─────────────────────────────────────
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  const label = form.dataset.busy;
  if (!label || e.defaultPrevented) return;
  form.closest('dialog')?.close();
  closePopover();
  const busy = document.getElementById('mms-busy');
  if (!busy) return;
  const text = busy.querySelector('[data-busy-label]');
  if (text) text.textContent = label;
  busy.hidden = false;
});

// ── Table search + filters, state kept in the URL ─────────────────────────
document.querySelectorAll<HTMLElement>('[data-filter-for]').forEach((bar) => {
  const table = document.getElementById(bar.dataset.filterFor ?? '');
  if (!table) return;
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row]'));
  const empty = table.querySelector<HTMLTableRowElement>('tbody tr.mms-no-results');
  const count = bar.querySelector<HTMLElement>('[data-filter-count]');
  const controls = Array.from(bar.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-filter]'));
  const params = new URLSearchParams(window.location.search);
  controls.forEach((c) => {
    const v = params.get(c.dataset.filter!);
    if (v !== null) {
      c.value = v;
      c.dispatchEvent(new Event('change'));
    }
  });
  const apply = () => {
    let shown = 0;
    const next = new URLSearchParams(window.location.search);
    for (const row of rows) {
      let ok = true;
      for (const c of controls) {
        const key = c.dataset.filter!;
        const v = c.value.trim().toLowerCase();
        if (!v) continue;
        const cell = (row.dataset[key] ?? '').toLowerCase();
        ok = key === 'search' ? cell.includes(v) : cell === v;
        if (!ok) break;
      }
      row.hidden = !ok;
      if (ok) shown++;
    }
    for (const c of controls) {
      const v = c.value.trim();
      if (v) next.set(c.dataset.filter!, v);
      else next.delete(c.dataset.filter!);
    }
    const qs = next.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    if (empty) empty.hidden = shown > 0 || rows.length === 0;
    if (count) count.textContent = `${shown} of ${rows.length}`;
  };
  controls.forEach((c) => {
    c.addEventListener('input', apply);
    c.addEventListener('change', apply);
  });
  apply();
});
