import { e as createComponent, r as renderTemplate, n as defineScriptVars, k as renderComponent, h as createAstro, m as maybeRenderHead, g as addAttribute } from '../chunks/astro/server_D03FvIM3.mjs';
import 'piccolore';
import { $ as $$Layout } from '../chunks/Layout_DHryPq56.mjs';
/* empty css                                    */
export { renderers } from '../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const $$Astro = createAstro();
const $$Settings = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Settings;
  const CP = "http://127.0.0.1:4400";
  let error = "";
  if (Astro2.request.method === "POST") {
    const f = await Astro2.request.formData();
    const str = (k) => (f.get(k) || "").toString().trim() || void 0;
    const section = (f.get("section") || "").toString();
    if (section === "guidance") {
      try {
        const r = await fetch(`${CP}/api/ai-guidance-default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guidance: (f.get("aiGuidance") || "").toString() })
        });
        if (!r.ok) {
          let msg = "save failed";
          try {
            msg = (await r.json()).error || msg;
          } catch {
          }
          throw new Error(msg);
        }
        return Astro2.redirect("/settings?saved=guidance");
      } catch (e) {
        error = e.message;
      }
    } else {
      let payload = {};
      if (section === "cloudflare") {
        payload = {
          cloudflareToken: str("cloudflareToken"),
          cloudflareAccountId: str("cloudflareAccountId")
        };
      } else {
        let aiCategories = [];
        try {
          aiCategories = JSON.parse((f.get("aiCategories") || "[]").toString());
        } catch {
        }
        payload = {
          openrouterKey: str("openrouterKey"),
          aiCategories,
          classifierModel: (f.get("classifierModel") || "").toString().trim()
        };
      }
      try {
        const r = await fetch(`${CP}/api/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          let msg = "save failed";
          try {
            msg = (await r.json()).error || msg;
          } catch {
          }
          throw new Error(msg);
        }
        return Astro2.redirect(`/settings?saved=${section === "cloudflare" ? "cloudflare" : "ai"}`);
      } catch (e) {
        error = e.message;
      }
    }
  }
  let s = {};
  try {
    s = await (await fetch(`${CP}/api/settings`)).json();
  } catch (e) {
    error = `Control plane not reachable: ${e.message}`;
  }
  let models = [];
  try {
    models = (await (await fetch(`${CP}/api/models`)).json()).models || [];
  } catch {
  }
  let guidance = "";
  try {
    guidance = (await (await fetch(`${CP}/api/ai-guidance-default`)).json()).guidance || "";
  } catch {
  }
  const GUIDANCE_MAX = 16e3;
  const seededCategories = Array.isArray(s.aiCategories) && s.aiCategories.length ? s.aiCategories : [
    {
      slug: "design",
      name: "Design",
      builtin: true,
      isDefault: true,
      modelId: s.openrouterModel || "",
      description: "Layout, visual design, and structure: creating or arranging pages, sections, hero areas, buttons, images, colors, spacing, and fonts."
    },
    {
      slug: "content",
      name: "Content",
      builtin: true,
      isDefault: false,
      modelId: s.openrouterModel || "",
      description: "Writing or editing text: headlines, paragraphs, blog posts, product descriptions, and other wording on the page."
    }
  ];
  const savedSection = Astro2.url.searchParams.get("saved");
  const savedLabel = savedSection === "cloudflare" ? "Cloudflare settings saved." : savedSection === "ai" ? "AI agent settings saved." : savedSection === "guidance" ? "Global AI guidance saved \u2014 all tenants use it on their next message." : savedSection ? "Saved." : "";
  return renderTemplate(_a || (_a = __template(["", " <!--\n  NOTE: this block is `is:global` on purpose. The category rows (and their model\n  combos) are built with innerHTML in the client script below, so they never\n  receive Astro's scoped-style attribute. Scoping these rules would leave the\n  generated combos unstyled \u2014 they'd fall back to the global blue `button` style\n  and the card grid would collapse. Generic selectors (textarea, button.ghost)\n  are namespaced under #settings-form so they don't leak to other pages.\n-->  <script>(function(){", `
  (function () {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Reusable searchable model combo, scoped to a root .combo element.
    // opts.list = model array to show; opts.onChange(id) fires on selection.
    function makeCombo(root, opts) {
      const list = opts.list;
      const trigger = root.querySelector('.combo-trigger');
      const label = root.querySelector('.combo-trigger-label');
      const panel = root.querySelector('.combo-panel');
      const search = root.querySelector('.combo-search');
      const listBox = root.querySelector('.combo-list');
      const valueInput = root.querySelector('.combo-value');
      const clearBtn = root.querySelector('.combo-clear');
      if (!trigger || !list.length) return { get: () => valueInput ? valueInput.value : '' };
      trigger.disabled = false;
      let filtered = list, active = -1;

      // The \u2715 only appears once something is picked. Operators can clear a
      // selection back to "unset" (they can't otherwise \u2014 the list only lets
      // them switch to another model).
      function syncClear() { if (clearBtn) clearBtn.hidden = !valueInput.value; }
      syncClear();

      function render() {
        listBox.innerHTML = filtered.length
          ? filtered.map((m, i) =>
              \`<div class="combo-item\${i === active ? ' active' : ''}\${m.id === valueInput.value ? ' selected' : ''}" data-id="\${esc(m.id)}">\` +
              \`<div class="combo-item-id">\${esc(m.id)}</div><div class="combo-item-name">\${esc(m.name)}</div>\` +
              (m.toolCalling === null ? \`<div class="combo-item-warn">\u26A0 tool support unknown</div>\` : \`\`) +
              \`</div>\`).join('')
          : '<div class="combo-empty">No models match</div>';
      }
      function open() { panel.hidden = false; search.value = ''; filtered = list; active = -1; render(); search.focus(); }
      function close() { panel.hidden = true; }
      function select(id) {
        valueInput.value = id;
        label.textContent = id;
        label.classList.remove('placeholder');
        syncClear();
        close();
        if (opts.onChange) opts.onChange(id);
      }
      function clearSelection() {
        valueInput.value = '';
        label.textContent = label.dataset.placeholder || 'Select a model\u2026';
        label.classList.add('placeholder');
        syncClear();
        close();
        if (opts.onChange) opts.onChange('');
      }
      trigger.addEventListener('click', () => (panel.hidden ? open() : close()));
      // Sits inside the trigger button, so swallow the click to avoid re-opening.
      if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSelection(); });
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim();
        filtered = q ? list.filter((m) => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)) : list;
        active = -1; render();
      });
      listBox.addEventListener('click', (e) => {
        const item = e.target.closest('.combo-item');
        if (item) select(item.dataset.id);
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && filtered[active]) select(filtered[active].id); }
        else if (e.key === 'Escape') { close(); trigger.focus(); }
      });
      document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
      return { get: () => valueInput.value };
    }

    // Category models must support tools: hide KNOWN-false, keep unknown (warned).
    const toolModels = models.filter((m) => m.toolCalling !== false);

    const rowsBox = document.getElementById('cat-rows');
    const rowCombos = []; // { getSlug, getName, getDesc, getModel, isDefault, builtin }

    function slugify(name, taken) {
      let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
      if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
      let slug = base, n = 2;
      while (taken.has(slug)) slug = \`\${base}-\${n++}\`;
      return slug;
    }

    function addRow(cat) {
      const idx = rowCombos.length;
      const row = document.createElement('div');
      row.className = 'cat-card';
      row.innerHTML =
        \`<div class="cat-card-top">\` +
          \`<label class="cat-default"><input type="radio" name="__cat_default" \${cat.isDefault ? 'checked' : ''} /> Default</label>\` +
          (cat.builtin ? \`\` : \`<button type="button" class="cat-remove" title="Remove category">\u2715</button>\`) +
        \`</div>\` +
        \`<div class="cat-card-body">\` +
          \`<div class="cat-row1">\` +
            \`<div class="cat-field">\` +
              \`<span class="cat-field-label">Category name</span>\` +
              \`<input class="cat-name" value="\${esc(cat.name || '')}" \${cat.builtin ? 'readonly' : 'placeholder="Category name (e.g. Products)"'} />\` +
            \`</div>\` +
            \`<div class="cat-field">\` +
              \`<span class="cat-field-label">Model</span>\` +
              \`<div class="combo cat-model-combo">\` +
                \`<input type="hidden" class="combo-value" value="\${esc(cat.modelId || '')}" />\` +
                \`<button type="button" class="combo-trigger"><span class="combo-trigger-label\${cat.modelId ? '' : ' placeholder'}" data-placeholder="Select a model\u2026">\${esc(cat.modelId || 'Select a model\u2026')}</span><span class="combo-clear" title="Clear selection" hidden>\u2715</span><span class="combo-caret">\u25BE</span></button>\` +
                \`<div class="combo-panel" hidden><input type="text" class="combo-search" placeholder="Type to search\u2026" autocomplete="off" /><div class="combo-list"></div></div>\` +
              \`</div>\` +
            \`</div>\` +
          \`</div>\` +
          \`<div class="cat-field">\` +
            \`<span class="cat-field-label">When to use (helps routing)</span>\` +
            \`<textarea class="cat-desc" placeholder="e.g. Writing or editing text on the page">\${esc(cat.description || '')}</textarea>\` +
          \`</div>\` +
        \`</div>\`;
      rowsBox.appendChild(row);

      const combo = makeCombo(row.querySelector('.cat-model-combo'), { list: toolModels });
      const nameEl = row.querySelector('.cat-name');
      const descEl = row.querySelector('.cat-desc');
      const radioEl = row.querySelector('input[type=radio]');
      const entry = {
        builtin: !!cat.builtin,
        fixedSlug: cat.builtin ? cat.slug : null,
        getName: () => nameEl.value.trim(),
        getDesc: () => descEl.value,
        getModel: () => combo.get(),
        isDefault: () => radioEl.checked,
      };
      rowCombos.push(entry);

      const rm = row.querySelector('.cat-remove');
      if (rm) rm.addEventListener('click', () => {
        const i = rowCombos.indexOf(entry);
        if (i >= 0) rowCombos.splice(i, 1);
        row.remove();
      });
    }

    seededCategories.forEach(addRow);

    document.getElementById('add-cat').addEventListener('click', () =>
      addRow({ name: '', description: '', modelId: '', isDefault: false, builtin: false }));

    // Classifier combo (full, unrestricted list).
    makeCombo(document.getElementById('classifier-combo'), { list: models });

    // Serialize categories to the hidden field + validate on submit.
    document.getElementById('settings-form').addEventListener('submit', (e) => {
      const taken = new Set();
      const out = [];
      let defaults = 0;
      for (const r of rowCombos) {
        const name = r.getName();
        if (!name) { e.preventDefault(); alert('Every category needs a name.'); return; }
        const model = r.getModel();
        if (!model) { e.preventDefault(); alert(\`Category "\${name}" needs a model.\`); return; }
        const slug = r.fixedSlug || slugify(name, taken);
        taken.add(slug);
        const isDefault = r.isDefault();
        if (isDefault) defaults++;
        out.push({ slug, name, description: r.getDesc(), modelId: model, isDefault, builtin: r.builtin });
      }
      if (defaults !== 1) { e.preventDefault(); alert('Pick exactly one Default category.'); return; }
      document.getElementById('cat-value').value = JSON.stringify(out);
    });
  })();
})();<\/script> <script>
  // Global AI guidance: live character counter (warns as it nears the limit).
  (function () {
    const area = document.querySelector('#guidance-form .guidance-area');
    const count = document.getElementById('guidance-count');
    if (!area || !count) return;
    const max = Number(area.getAttribute('maxlength')) || 16000;
    const sync = () => {
      const n = area.value.length;
      count.textContent = n.toLocaleString() + ' / ' + max.toLocaleString() + ' characters';
      count.classList.toggle('near', n > max * 0.9);
    };
    area.addEventListener('input', sync);
    sync();
  })();
<\/script>`], ["", " <!--\n  NOTE: this block is \\`is:global\\` on purpose. The category rows (and their model\n  combos) are built with innerHTML in the client script below, so they never\n  receive Astro's scoped-style attribute. Scoping these rules would leave the\n  generated combos unstyled \u2014 they'd fall back to the global blue \\`button\\` style\n  and the card grid would collapse. Generic selectors (textarea, button.ghost)\n  are namespaced under #settings-form so they don't leak to other pages.\n-->  <script>(function(){", `
  (function () {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Reusable searchable model combo, scoped to a root .combo element.
    // opts.list = model array to show; opts.onChange(id) fires on selection.
    function makeCombo(root, opts) {
      const list = opts.list;
      const trigger = root.querySelector('.combo-trigger');
      const label = root.querySelector('.combo-trigger-label');
      const panel = root.querySelector('.combo-panel');
      const search = root.querySelector('.combo-search');
      const listBox = root.querySelector('.combo-list');
      const valueInput = root.querySelector('.combo-value');
      const clearBtn = root.querySelector('.combo-clear');
      if (!trigger || !list.length) return { get: () => valueInput ? valueInput.value : '' };
      trigger.disabled = false;
      let filtered = list, active = -1;

      // The \u2715 only appears once something is picked. Operators can clear a
      // selection back to "unset" (they can't otherwise \u2014 the list only lets
      // them switch to another model).
      function syncClear() { if (clearBtn) clearBtn.hidden = !valueInput.value; }
      syncClear();

      function render() {
        listBox.innerHTML = filtered.length
          ? filtered.map((m, i) =>
              \\\`<div class="combo-item\\\${i === active ? ' active' : ''}\\\${m.id === valueInput.value ? ' selected' : ''}" data-id="\\\${esc(m.id)}">\\\` +
              \\\`<div class="combo-item-id">\\\${esc(m.id)}</div><div class="combo-item-name">\\\${esc(m.name)}</div>\\\` +
              (m.toolCalling === null ? \\\`<div class="combo-item-warn">\u26A0 tool support unknown</div>\\\` : \\\`\\\`) +
              \\\`</div>\\\`).join('')
          : '<div class="combo-empty">No models match</div>';
      }
      function open() { panel.hidden = false; search.value = ''; filtered = list; active = -1; render(); search.focus(); }
      function close() { panel.hidden = true; }
      function select(id) {
        valueInput.value = id;
        label.textContent = id;
        label.classList.remove('placeholder');
        syncClear();
        close();
        if (opts.onChange) opts.onChange(id);
      }
      function clearSelection() {
        valueInput.value = '';
        label.textContent = label.dataset.placeholder || 'Select a model\u2026';
        label.classList.add('placeholder');
        syncClear();
        close();
        if (opts.onChange) opts.onChange('');
      }
      trigger.addEventListener('click', () => (panel.hidden ? open() : close()));
      // Sits inside the trigger button, so swallow the click to avoid re-opening.
      if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSelection(); });
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim();
        filtered = q ? list.filter((m) => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)) : list;
        active = -1; render();
      });
      listBox.addEventListener('click', (e) => {
        const item = e.target.closest('.combo-item');
        if (item) select(item.dataset.id);
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && filtered[active]) select(filtered[active].id); }
        else if (e.key === 'Escape') { close(); trigger.focus(); }
      });
      document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
      return { get: () => valueInput.value };
    }

    // Category models must support tools: hide KNOWN-false, keep unknown (warned).
    const toolModels = models.filter((m) => m.toolCalling !== false);

    const rowsBox = document.getElementById('cat-rows');
    const rowCombos = []; // { getSlug, getName, getDesc, getModel, isDefault, builtin }

    function slugify(name, taken) {
      let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
      if (base.length > 60) base = base.slice(0, 60).replace(/-+$/g, '');
      let slug = base, n = 2;
      while (taken.has(slug)) slug = \\\`\\\${base}-\\\${n++}\\\`;
      return slug;
    }

    function addRow(cat) {
      const idx = rowCombos.length;
      const row = document.createElement('div');
      row.className = 'cat-card';
      row.innerHTML =
        \\\`<div class="cat-card-top">\\\` +
          \\\`<label class="cat-default"><input type="radio" name="__cat_default" \\\${cat.isDefault ? 'checked' : ''} /> Default</label>\\\` +
          (cat.builtin ? \\\`\\\` : \\\`<button type="button" class="cat-remove" title="Remove category">\u2715</button>\\\`) +
        \\\`</div>\\\` +
        \\\`<div class="cat-card-body">\\\` +
          \\\`<div class="cat-row1">\\\` +
            \\\`<div class="cat-field">\\\` +
              \\\`<span class="cat-field-label">Category name</span>\\\` +
              \\\`<input class="cat-name" value="\\\${esc(cat.name || '')}" \\\${cat.builtin ? 'readonly' : 'placeholder="Category name (e.g. Products)"'} />\\\` +
            \\\`</div>\\\` +
            \\\`<div class="cat-field">\\\` +
              \\\`<span class="cat-field-label">Model</span>\\\` +
              \\\`<div class="combo cat-model-combo">\\\` +
                \\\`<input type="hidden" class="combo-value" value="\\\${esc(cat.modelId || '')}" />\\\` +
                \\\`<button type="button" class="combo-trigger"><span class="combo-trigger-label\\\${cat.modelId ? '' : ' placeholder'}" data-placeholder="Select a model\u2026">\\\${esc(cat.modelId || 'Select a model\u2026')}</span><span class="combo-clear" title="Clear selection" hidden>\u2715</span><span class="combo-caret">\u25BE</span></button>\\\` +
                \\\`<div class="combo-panel" hidden><input type="text" class="combo-search" placeholder="Type to search\u2026" autocomplete="off" /><div class="combo-list"></div></div>\\\` +
              \\\`</div>\\\` +
            \\\`</div>\\\` +
          \\\`</div>\\\` +
          \\\`<div class="cat-field">\\\` +
            \\\`<span class="cat-field-label">When to use (helps routing)</span>\\\` +
            \\\`<textarea class="cat-desc" placeholder="e.g. Writing or editing text on the page">\\\${esc(cat.description || '')}</textarea>\\\` +
          \\\`</div>\\\` +
        \\\`</div>\\\`;
      rowsBox.appendChild(row);

      const combo = makeCombo(row.querySelector('.cat-model-combo'), { list: toolModels });
      const nameEl = row.querySelector('.cat-name');
      const descEl = row.querySelector('.cat-desc');
      const radioEl = row.querySelector('input[type=radio]');
      const entry = {
        builtin: !!cat.builtin,
        fixedSlug: cat.builtin ? cat.slug : null,
        getName: () => nameEl.value.trim(),
        getDesc: () => descEl.value,
        getModel: () => combo.get(),
        isDefault: () => radioEl.checked,
      };
      rowCombos.push(entry);

      const rm = row.querySelector('.cat-remove');
      if (rm) rm.addEventListener('click', () => {
        const i = rowCombos.indexOf(entry);
        if (i >= 0) rowCombos.splice(i, 1);
        row.remove();
      });
    }

    seededCategories.forEach(addRow);

    document.getElementById('add-cat').addEventListener('click', () =>
      addRow({ name: '', description: '', modelId: '', isDefault: false, builtin: false }));

    // Classifier combo (full, unrestricted list).
    makeCombo(document.getElementById('classifier-combo'), { list: models });

    // Serialize categories to the hidden field + validate on submit.
    document.getElementById('settings-form').addEventListener('submit', (e) => {
      const taken = new Set();
      const out = [];
      let defaults = 0;
      for (const r of rowCombos) {
        const name = r.getName();
        if (!name) { e.preventDefault(); alert('Every category needs a name.'); return; }
        const model = r.getModel();
        if (!model) { e.preventDefault(); alert(\\\`Category "\\\${name}" needs a model.\\\`); return; }
        const slug = r.fixedSlug || slugify(name, taken);
        taken.add(slug);
        const isDefault = r.isDefault();
        if (isDefault) defaults++;
        out.push({ slug, name, description: r.getDesc(), modelId: model, isDefault, builtin: r.builtin });
      }
      if (defaults !== 1) { e.preventDefault(); alert('Pick exactly one Default category.'); return; }
      document.getElementById('cat-value').value = JSON.stringify(out);
    });
  })();
})();<\/script> <script>
  // Global AI guidance: live character counter (warns as it nears the limit).
  (function () {
    const area = document.querySelector('#guidance-form .guidance-area');
    const count = document.getElementById('guidance-count');
    if (!area || !count) return;
    const max = Number(area.getAttribute('maxlength')) || 16000;
    const sync = () => {
      const n = area.value.length;
      count.textContent = n.toLocaleString() + ' / ' + max.toLocaleString() + ' characters';
      count.classList.toggle('near', n > max * 0.9);
    };
    area.addEventListener('input', sync);
    sync();
  })();
<\/script>`])), renderComponent($$result, "Layout", $$Layout, { "title": "Settings" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<h1>Settings</h1> <p class="sub">AI agent and Cloudflare credentials, saved separately. Secrets are <strong>encrypted at rest</strong> and masked — leave a secret field blank to keep its current value.</p> ${savedLabel && renderTemplate`<div class="banner ok">${savedLabel}</div>`}${error && renderTemplate`<div class="banner err">${error}</div>`}<div class="card"> <h2 class="card-title">AI agent</h2> <p class="hint card-sub">The OpenRouter key is injected only by the <strong>AI Gateway</strong> — it is never stored in any tenant instance, and tenants never see which model runs.</p> <form method="POST" id="settings-form"> <input type="hidden" name="section" value="ai"> <label>OpenRouter API key ${s.hasOpenrouterKey && renderTemplate`<span class="hint">(set — blank keeps it)</span>`}</label> <input name="openrouterKey" type="password" autocomplete="off"${addAttribute(s.hasOpenrouterKey ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "sk-or-...", "placeholder")}> <h2 class="sec">AI models by task type</h2> <p class="hint">Each tenant message is auto-routed to one of these models based on what the tenant asks. Exactly one category is the <strong>Default</strong> (used when the request is unclear or classification fails). Category models must support tool-calling; the picker hides models that can't.</p> <div id="cat-rows"></div> <div style="margin-top:8px"><button type="button" class="ghost" id="add-cat">+ Add category</button></div> <input type="hidden" name="aiCategories" id="cat-value"> <label class="mt">Classifier model <span class="hint">(a cheap model that reads each prompt and picks the category — no tool-calling needed)</span></label> <div class="combo" id="classifier-combo" data-full="1"> <input type="hidden" name="classifierModel" class="combo-value"${addAttribute(s.classifierModel || "", "value")}> <button type="button" class="combo-trigger"${addAttribute(models.length === 0, "disabled")}> <span${addAttribute(["combo-trigger-label", !s.classifierModel && "placeholder"], "class:list")}${addAttribute(models.length ? "Select a model\u2026" : "Save an API key to load models", "data-placeholder")}>${s.classifierModel || (models.length ? "Select a model\u2026" : "Save an API key to load models")}</span> <span class="combo-clear" title="Clear selection" hidden>✕</span> <span class="combo-caret">▾</span> </button> <div class="combo-panel" hidden> <input type="text" class="combo-search" placeholder="Type to search…" autocomplete="off"> <div class="combo-list"></div> </div> </div> <div style="margin-top:18px"><button type="submit">Save AI settings</button></div> </form> </div> <div class="card"> <h2 class="card-title">Global AI guidance</h2> <p class="hint card-sub">The standing instructions injected into <strong>every tenant's AI chat</strong>. This is the file <code>rules/globalAiGuidanceRule.md</code> — edit it and save to change how the assistant behaves for all tenants. Changes take effect on each tenant's next message; no restart needed.</p> <form method="POST" id="guidance-form"> <input type="hidden" name="section" value="guidance"> <textarea name="aiGuidance" class="guidance-area" spellcheck="false"${addAttribute(GUIDANCE_MAX, "maxlength")} aria-label="Global AI guidance">${guidance}</textarea> <div class="guidance-actions"> <span class="hint" id="guidance-count"></span> <button type="submit">Save guidance</button> </div> </form> </div> <div class="card"> <h2 class="card-title">Cloudflare</h2> <p class="hint card-sub">Used by the Publish Deployer to ship tenant sites to Cloudflare Pages.</p> <form method="POST" id="cf-form"> <input type="hidden" name="section" value="cloudflare"> <label>Cloudflare API token ${s.hasCloudflareToken && renderTemplate`<span class="hint">(set — blank keeps it)</span>`}</label> <input name="cloudflareToken" type="password" autocomplete="off"${addAttribute(s.hasCloudflareToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "Cloudflare Pages token", "placeholder")}> <label>Cloudflare account id</label> <input name="cloudflareAccountId"${addAttribute(s.cloudflareAccountId || "", "value")} placeholder="32-char account id"> <div style="margin-top:18px"><button type="submit">Save Cloudflare settings</button></div> </form> </div> ` }), defineScriptVars({ models, seededCategories }));
}, "S:/InstaticSiteAgent/operator/ui/src/pages/settings.astro", void 0);

const $$file = "S:/InstaticSiteAgent/operator/ui/src/pages/settings.astro";
const $$url = "/settings";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Settings,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
