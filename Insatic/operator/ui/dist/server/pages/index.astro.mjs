import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, g as addAttribute, l as Fragment, m as maybeRenderHead } from '../chunks/astro/server_D03FvIM3.mjs';
import 'piccolore';
import { $ as $$Layout } from '../chunks/Layout_DHryPq56.mjs';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a, _b;
const $$Astro = createAstro();
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Index;
  const CP = "http://127.0.0.1:4400";
  let error = "";
  if (Astro2.request.method === "POST") {
    const f = await Astro2.request.formData();
    const intent = f.get("intent");
    try {
      if (intent === "add") {
        const r = await fetch(`${CP}/api/tenants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: f.get("name"),
            ownerEmail: f.get("ownerEmail"),
            cfProject: f.get("cfProject"),
            customDomain: f.get("customDomain")
          })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "provision failed");
      } else if (intent === "deploy") {
        const r = await fetch(`${CP}/api/tenants/${f.get("slug")}/deploy`, { method: "POST" });
        const j = await r.json();
        if (!r.ok || j.ok === false) throw new Error(j.error || "deploy failed");
      } else if (intent === "edit") {
        const r = await fetch(`${CP}/api/tenants/${f.get("slug")}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: f.get("displayName"),
            ownerEmail: f.get("ownerEmail"),
            cfProject: f.get("cfProject"),
            customDomain: f.get("customDomain")
          })
        });
        const j = await r.json();
        if (!r.ok || j.ok === false) throw new Error(j.error || "update failed");
      } else if (intent === "repair") {
        const r = await fetch(`${CP}/api/tenants/${f.get("slug")}/repair`, { method: "POST" });
        const j = await r.json();
        if (!r.ok || j.ok === false) throw new Error(j.error || "Cloudflare repair failed");
      } else if (intent === "start") {
        await fetch(`${CP}/api/tenants/${f.get("slug")}/start`, { method: "POST" });
      } else if (intent === "remove") {
        const cf = f.get("deleteCf") ? "?cf=1" : "";
        await fetch(`${CP}/api/tenants/${f.get("slug")}${cf}`, { method: "DELETE" });
      }
      if (!error) return Astro2.redirect("/");
    } catch (e) {
      error = e.message;
    }
  }
  let tenants = [];
  try {
    const res = await fetch(`${CP}/api/tenants`);
    tenants = (await res.json()).tenants || [];
  } catch (e) {
    error = `Control plane not reachable on :4400 \u2014 is it running? (${e.message})`;
  }
  const publicConsole = process.env.PUBLIC_CONSOLE === "1";
  for (const t of tenants) {
    t.instance_url = publicConsole ? `/open?slug=${encodeURIComponent(t.slug)}` : t.admin_url;
  }
  const PROGRESS = {
    new: "Starting\u2026",
    db_ready: "Database ready\u2026",
    up: "Instance booting\u2026",
    seeded: "Setting up Cloudflare\u2026"
  };
  const PROGRESS_PCT = { new: 12, db_ready: 40, up: 72, seeded: 92 };
  const prov = tenants.find((t) => t.status === "provisioning") || null;
  const fmtDate = (s) => s ? new Date(s).toLocaleString() : "\u2014";
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "Tenants" }, { "default": async ($$result2) => renderTemplate(_b || (_b = __template(["", '<dialog id="busyDlg" class="modal locked"> <div class="dlg-head" style="border:0;padding:0;margin-bottom:10px"> <h3 style="margin:0" class="busy-msg">Working</h3> <span class="spinner" aria-hidden="true"></span> </div> <p class="hint" style="margin:0 0 14px">Please wait \u2014 this can take a few seconds.</p> <div class="bar indet"><div class="fill" style="width:35%"></div></div> <p class="prog">Talking to Cloudflare<span class="dots"></span></p> </dialog> <h1>Tenants</h1> <p class="sub">Each tenant is an isolated <strong>native Instatic</strong> instance \u2014 its own Postgres schema, port, and uploads. No Docker.</p> ', '<div class="card"> <form method="POST" class="js-busy" data-busy="Provisioning tenant"> <input type="hidden" name="intent" value="add"> <div class="grid2"> <div><label>Tenant name</label><input name="name" placeholder="Acme Co" required></div> <div><label>Owner email (optional)</label><input name="ownerEmail" type="email" placeholder="owner@acme.com"></div> </div> <div class="grid2"> <div><label>Cloudflare project name (optional)</label><input name="cfProject" placeholder="siteagent-acme"></div> <div><label>Custom domain (optional)</label><input name="customDomain" placeholder="acme.siteagent.com"></div> </div> <p class="hint" style="margin:10px 0 0">Provisioning boots a native Instatic instance and creates its Cloudflare project with a \u201CComing soon\u201D placeholder (~30\u201360s, runs in the background). Leave the CF project name blank to default to <code>siteagent-&lt;slug&gt;</code>. A custom domain is attached automatically when its zone is in your Cloudflare account.</p> <div style="margin-top:12px"><button type="submit">+ Add tenant</button></div> </form> </div> <div class="card"> ', ` </div>  <script>
    // Close a <dialog> when the backdrop is clicked \u2014 EXCEPT "locked" ones (the
    // progress/busy modals), which must stay open until the operation succeeds/fails.
    document.querySelectorAll('dialog').forEach((dlg) => {
      if (dlg.classList.contains('locked')) {
        // Block ESC (the dialog "cancel" event) too.
        dlg.addEventListener('cancel', (e) => e.preventDefault());
        return;
      }
      dlg.addEventListener('click', (e) => {
        const r = dlg.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right &&
                       e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dlg.close();
      });
    });

    // Copy-to-clipboard icons: copy data-copy, briefly show a check mark.
    const CHECK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    document.querySelectorAll('button.copy').forEach((b) => {
      const orig = b.innerHTML;
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy || '');
          b.innerHTML = CHECK;
          b.classList.add('ok');
          setTimeout(() => { b.innerHTML = orig; b.classList.remove('ok'); }, 1200);
        } catch (e) { /* clipboard blocked */ }
      });
    });

    // Long-running forms: on submit, close the modal they live in (if any) and show
    // the shared busy modal with a progress bar. The POST then proceeds normally.
    const busy = document.getElementById('busyDlg');
    document.querySelectorAll('form.js-busy').forEach((form) => {
      form.addEventListener('submit', () => {
        const parent = form.closest('dialog');
        if (parent && parent.open) parent.close();
        if (busy) {
          const label = busy.querySelector('.busy-msg');
          if (label) label.textContent = form.getAttribute('data-busy') || 'Working';
          if (!busy.open) busy.showModal();
        }
      });
    });
  <\/script> `])), prov && renderTemplate(_a || (_a = __template(["", '<dialog id="provDlg" class="modal locked"> <div class="dlg-head" style="border:0;padding:0;margin-bottom:10px"> <h3 style="margin:0">Provisioning <code>', '</code></h3> <span class="spinner" aria-hidden="true"></span> </div> <p class="hint" style="margin:0 0 14px">This runs in the background (~30\u201360s). You can keep working.</p> <div class="bar indet"><div class="fill"', '></div></div> <p class="prog">', `<span class="dots"></span></p> </dialog>
    <script>
      const d = document.getElementById('provDlg');
      if (d && !d.open) d.showModal();
      setTimeout(() => location.reload(), 2500);
    <\/script>`])), maybeRenderHead(), prov.slug, addAttribute(`width:${PROGRESS_PCT[prov.provision_state] || 8}%`, "style"), PROGRESS[prov.provision_state] || "Working"), error && renderTemplate`<div class="banner err">${error}</div>`, tenants.length === 0 ? renderTemplate`<p class="hint">No tenants yet — add one above.</p>` : renderTemplate`<table> <thead><tr><th>Tenant</th><th>Status</th><th>Instance</th><th>Live URL</th><th>Actions</th></tr></thead> <tbody> ${tenants.map((t) => renderTemplate`<tr> <td><strong>${t.display_name || t.slug}</strong><div class="hint" style="margin-top:2px"><code>${t.slug}</code></div></td> <td> <span${addAttribute("pill " + (t.status === "active" ? "ok" : t.status === "failed" ? "bad" : "warn"), "class")}>${t.status}</span> ${t.status === "failed" && t.last_error && renderTemplate`<div class="hint" style="margin-top:4px">${t.last_error}</div>`} </td> <td>${t.running ? renderTemplate`<div class="row-actions"><a${addAttribute(t.instance_url, "href")} target="_blank" rel="noreferrer">open :${t.port} ↗</a><button class="iconbtn copy" type="button"${addAttribute(t.instance_url, "data-copy")} title="Copy admin link to share with the tenant" aria-label="Copy admin link"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div>` : renderTemplate`<span class="pill warn">stopped</span>`}</td> <td>${t.custom_domain || t.pages_url ? renderTemplate`<a${addAttribute(t.custom_domain ? `https://${t.custom_domain}` : t.pages_url, "href")} target="_blank" rel="noreferrer">${(t.custom_domain || t.pages_url).replace("https://", "")} ↗</a>` : renderTemplate`<span class="hint">not published</span>`} ${!t.last_deploy_at && (t.custom_domain || t.pages_url) && renderTemplate`<div class="hint" style="margin-top:2px">placeholder</div>`} </td> <td> <div class="row-actions"> <button class="ghost" type="button"${addAttribute(`document.getElementById('dlg-${t.slug}').showModal()`, "onclick")}>Details</button> <button class="ghost" type="button"${addAttribute(`document.getElementById('edit-${t.slug}').showModal()`, "onclick")}>Edit</button> ${!t.running && t.status !== "provisioning" && renderTemplate`<form method="POST"><input type="hidden" name="intent" value="start"><input type="hidden" name="slug"${addAttribute(t.slug, "value")}><button class="ghost" type="submit">Start</button></form>`} ${t.published ? renderTemplate`<form method="POST" class="js-busy" data-busy="Publishing to Cloudflare"><input type="hidden" name="intent" value="deploy"><input type="hidden" name="slug"${addAttribute(t.slug, "value")}><button class="ghost" type="submit">${t.last_deploy_at ? "Re-deploy" : "Publish \u2192 CF"}</button></form>` : renderTemplate`<button class="ghost" type="button" disabled title="The tenant must click Publish inside Instatic first" style="opacity:.5;cursor:not-allowed">Re-deploy</button>`} <button class="danger" type="button"${addAttribute(`document.getElementById('rm-${t.slug}').showModal()`, "onclick")}>Remove</button> <dialog${addAttribute(`rm-${t.slug}`, "id")} class="modal"> <div class="dlg-head"><h3 style="margin:0">Remove <code>${t.slug}</code>?</h3></div> <p class="hint" style="margin:0 0 14px">Permanently deletes the tenant's data, files, and instance. This can't be undone.</p> <form method="POST" class="js-busy" data-busy="Removing tenant"> <input type="hidden" name="intent" value="remove"> <input type="hidden" name="slug"${addAttribute(t.slug, "value")}> <label class="check"><input type="checkbox" name="deleteCf"> Also delete the Cloudflare site</label> <div class="row-actions" style="justify-content:flex-end;margin-top:18px"> <button class="ghost" type="button"${addAttribute(`document.getElementById('rm-${t.slug}').close()`, "onclick")}>Cancel</button> <button class="danger" type="submit">Remove</button> </div> </form> </dialog> </div> <dialog${addAttribute(`dlg-${t.slug}`, "id")} class="modal wide"> <div class="dlg-head"> <h3 style="margin:0"><code>${t.slug}</code></h3> <span${addAttribute("pill " + (t.status === "active" ? "ok" : t.status === "failed" ? "bad" : "warn"), "class")}>${t.status}</span> </div> <dl class="kv"> <dt>Display name</dt><dd>${t.display_name || "\u2014"}</dd> <dt>Slug (fixed id)</dt><dd><code>${t.slug}</code></dd> <dt>Owner email</dt><dd>${t.owner_email || "\u2014"}</dd> <dt>Admin (editor)</dt><dd>${t.running ? renderTemplate`<span class="row-actions"><a${addAttribute(t.admin_url, "href")} target="_blank" rel="noreferrer">${t.admin_url} ↗</a><button class="iconbtn copy" type="button"${addAttribute(t.admin_url, "data-copy")} title="Copy admin link" aria-label="Copy admin link"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></span>` : renderTemplate`<span class="hint">instance stopped</span>`}</dd> <dt>CF project name</dt><dd><code>${t.cf_project || "\u2014"}</code></dd> <dt>CF project URL</dt><dd>${t.pages_url ? renderTemplate`<a${addAttribute(t.pages_url, "href")} target="_blank" rel="noreferrer">${t.pages_url} ↗</a>` : renderTemplate`<span class="hint">created on first publish</span>`}</dd> <dt>Custom domain</dt><dd>${t.custom_domain ? renderTemplate`<a${addAttribute(`https://${t.custom_domain}`, "href")} target="_blank" rel="noreferrer">${t.custom_domain} ↗</a>` : renderTemplate`<span class="hint">none</span>`}</dd> <dt>Published</dt><dd>${t.last_deploy_at ? renderTemplate`<span>yes · ${fmtDate(t.last_deploy_at)}${t.last_deploy_status ? ` (${t.last_deploy_status})` : ""}</span>` : renderTemplate`<span class="hint">placeholder only — tenant hasn’t published yet</span>`}</dd> <dt>Internal port</dt><dd><code>${t.port ?? "\u2014"}</code></dd> <dt>Created</dt><dd>${fmtDate(t.created_at)}</dd> ${t.last_error && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": async ($$result3) => renderTemplate`<dt>Last error</dt><dd class="err-text">${t.last_error}</dd>` })}`} </dl> <div class="row-actions" style="justify-content:flex-end;margin-top:16px"> <form method="POST" class="js-busy" data-busy="Retrying Cloudflare"><input type="hidden" name="intent" value="repair"><input type="hidden" name="slug"${addAttribute(t.slug, "value")}><button class="ghost" type="submit" title="Re-run Cloudflare setup (e.g. after fixing the API token)">Retry Cloudflare</button></form> <form method="dialog"><button class="ghost">Close</button></form> </div> </dialog> <dialog${addAttribute(`edit-${t.slug}`, "id")} class="modal wide"> <div class="dlg-head"><h3 style="margin:0">Edit <code>${t.slug}</code></h3></div> <form method="POST" class="js-busy" data-busy="Saving changes"> <input type="hidden" name="intent" value="edit"> <input type="hidden" name="slug"${addAttribute(t.slug, "value")}> <label>Display name</label> <input name="displayName"${addAttribute(t.display_name || "", "value")} placeholder="Acme Co"> <p class="hint" style="margin:4px 0 0">Friendly label shown in the console. The slug (<code>${t.slug}</code>) is the fixed identity and can't change.</p> <label>Owner email</label> <input name="ownerEmail" type="email"${addAttribute(t.owner_email || "", "value")} placeholder="owner@acme.com"> <label>Cloudflare project name</label> <input name="cfProject"${addAttribute(t.cf_project || "", "value")} placeholder="siteagent-acme"> <p class="hint" style="margin:4px 0 0">Only affects future deploys. Changing it after publishing points to a different Pages project.</p> <label>Custom domain</label> <input name="customDomain"${addAttribute(t.custom_domain || "", "value")} placeholder="acme.siteagent.com"> <p class="hint" style="margin:4px 0 0">Saved and attached to the Pages project automatically (if its zone is in your Cloudflare account).</p> <div class="row-actions" style="justify-content:flex-end;margin-top:16px"> <button class="ghost" type="button"${addAttribute(`document.getElementById('edit-${t.slug}').close()`, "onclick")}>Cancel</button> <button type="submit">Save</button> </div> </form> </dialog> </td> </tr>`)} </tbody> </table>`) })}`;
}, "S:/InstaticSiteAgent/operator/ui/src/pages/index.astro", void 0);

const $$file = "S:/InstaticSiteAgent/operator/ui/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
