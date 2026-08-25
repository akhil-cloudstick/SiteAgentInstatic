// The page a tenant sees while the backend they asked for is still coming up.
//
// It replaces the dead end this gateway used to serve — a bare
// `gateway: upstream unavailable (ECONNREFUSED)` — which appeared whenever a
// tenant opened MMS Design inside the window where its daemon had been spawned
// but had not yet bound its port (minutes, after every control-plane restart).
// Nothing on that page told the user what was wrong, and reloading it could not
// help, because the SSO token in the URL expires after 120 s.
//
// So this page does the two things that error string could not: it waits, and it
// resumes through a FRESH hand-off. `continueUrl` for the design tool is the
// hub's own /sso/design route, which mints a new token at click time — replaying
// the original /design/sso?token=… would hand the daemon an expired token and
// earn a hard 401 ("Sign-in link invalid or expired") instead.
import config from '../lib/env.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABEL = { design: 'MMS Design', cms: 'MMS CMS' };

// Values reach the client through data-attributes rather than an inlined script
// literal: HTML attribute escaping is the same escaping the rest of this page
// already needs, so there is no second, script-context escaping rule to get
// wrong for a URL that carries user-influenced query strings.
export function startingPage({ tool = 'design', continueUrl = '/hub', error = null } = {}) {
  const name = LABEL[tool] || LABEL.design;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Starting ${esc(name)}</title>
<style>
  /* MMS Design System — cream canvas, navy ink, Approval-Green accent. */
  :root{--bg:#f8f1df;--card:#fff;--line:rgba(8,42,56,.16);--text:#082a38;--muted:#44515a;--accent:#1ba957}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);min-height:100vh;display:flex;
    align-items:center;justify-content:center;padding:24px;
    font:15px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  .card{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);
    border-radius:14px;padding:28px;text-align:center;
    box-shadow:0 6px 24px rgba(8,42,56,.08),0 2px 6px rgba(8,42,56,.05)}
  .spin{width:34px;height:34px;margin:0 auto 18px;border-radius:50%;
    border:3px solid rgba(8,42,56,.14);border-top-color:var(--accent);animation:r .9s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
  h1{font-size:19px;font-weight:800;margin:0 0 6px}
  p{color:var(--muted);margin:0 0 4px}
  .tick{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);margin-top:14px}
  .err{display:none;background:#fdeae6;color:#8a2a1a;border:1px solid #f5c7bf;border-radius:8px;
    padding:10px;margin-top:16px;font-size:14px;text-align:left}
  .links{margin-top:18px;font-size:13px}
  .links a{color:var(--muted)}
</style></head><body>
<div class="card" id="boot" data-tool="${esc(tool)}" data-continue="${esc(continueUrl)}">
  <div class="spin" role="status" aria-live="polite"></div>
  <h1>Starting ${esc(name)}…</h1>
  <p>Your workspace is waking up. It opens by itself — no need to reload.</p>
  <p class="tick" id="tick">This can take a couple of minutes after a server restart.</p>
  <div class="err" id="err">${esc(error || '')}</div>
  <div class="links"><a href="${esc(config.gatewayOrigin)}/hub">Back to Product Hub</a></div>
</div>
<noscript><meta http-equiv="refresh" content="10"></noscript>
<script>
(function () {
  var boot = document.getElementById('boot');
  var tickEl = document.getElementById('tick');
  var errEl = document.getElementById('err');
  var tool = boot.getAttribute('data-tool');
  var next = boot.getAttribute('data-continue');
  var started = Date.now();
  var LONG_MS = 8 * 60 * 1000;
  if (errEl.textContent.trim()) errEl.style.display = 'block';

  function elapsed() {
    var s = Math.round((Date.now() - started) / 1000);
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function poll() {
    fetch('/_mms/ready?tool=' + encodeURIComponent(tool), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        // Signed out while waiting (or the session expired): go sign in, then
        // come straight back here instead of dead-ending on a 401.
        if (j.signedOut) {
          location.replace('/login?next=' + encodeURIComponent(next));
          return;
        }
        if (j.ready) { location.replace(next); return; }
        if (j.error) { errEl.textContent = j.error; errEl.style.display = 'block'; }
        again();
      })
      .catch(again);
  }

  function again() {
    var over = Date.now() - started > LONG_MS;
    tickEl.textContent = over
      ? 'Still starting after ' + elapsed() + '. Leaving this open is fine — it will open as soon as it is ready.'
      : 'Starting… ' + elapsed();
    setTimeout(poll, over ? 5000 : 2000);
  }

  poll();
}());
</script>
</body></html>`;
}
