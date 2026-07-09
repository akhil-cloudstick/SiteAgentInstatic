# Instatic Version Comparison — Vendored v0.0.7 vs Latest v0.0.10

**Current vendored version in this repo:** `0.0.7` (2026-06-29)
_Source: `package.json` at `Insatic/tenant/vendor/package.json` (formerly `instatic/vendor/package.json`)_

**Latest upstream release:** `0.0.10` (2026-07-01) — [github.com/corebunch/instatic](https://github.com/corebunch/instatic)

Three releases separate the vendored copy from upstream. All were cut on the same day (2026-07-01), so this is a fast-moving pre-1.0 project. There's also unreleased work on `main` past 0.0.10 (see bottom of this doc).

---

## At a glance

| Version | Date | Headline change |
|---|---|---|
| **0.0.7** (current) | 2026-06-29 | MCP connectors for external AI clients |
| 0.0.8 | 2026-07-01 | Unified Explorer/Framework panels + security hardening (headers, SVG sanitization, MCP token expiry) |
| 0.0.9 | 2026-07-01 | Redesigned AI assistant panel (tool-call rows, inline previews, auto-titled chats) |
| 0.0.10 | 2026-07-01 | OpenAI-compatible custom-endpoint AI provider + import/editor fixes |

No dependency additions/removals and no `engines.bun` change between 0.0.7 → 0.0.10 (still `>=1.3.0 <1.4.0`) — upgrading carries no new install-time requirements.

---

## v0.0.8 (2026-07-01)

### Editor and framework
- Unified Core Framework management into one tabbed panel (Full / Variables / None manager).
- Consolidated Layers, Site, Code, and Media into one Explorer panel, with a dedicated Code tab and refreshed media browsing.
- Added canvas support for dragging media assets directly from the Media workspace.
- Fixed onboarding framework import defaults; imported framework changes now appear without a hard refresh.
- Fixed canvas mouse-wheel behavior (Shift+wheel now pans sideways, normal wheel stays vertical).
- Kept the highlighted Spotlight result scrolled into view during keyboard navigation.

### AI and integrations
- Made AI token tools more tolerant of model-authored argument aliases for framework typography/spacing updates.

### 🔒 Security
- Added central security response headers for admin and upload routes.
- Revalidated and sanitized imported archive media, **including SVG payloads**, before writing to disk.
- Added expiry timestamps for MCP connector tokens (existing tokens backfilled to a 90-day grace period).

---

## v0.0.9 (2026-07-01)

### AI and integrations
- Redesigned the AI assistant panel message stream: tool calls render as compact rows with per-tool icons, human-readable labels, and status; consecutive calls group under one turn.
- Added inline previews to tool calls (color-token swatches for palette updates, captured screenshots for render-snapshot).
- Auto-titled conversations from the first prompt (was "New conversation"); added avatars and relative timestamps per turn.
- Fixed the AI panel dropping the selected model on a new chat; surfaced conversation delete/load failures as toasts.

### Editor and framework
- Added a body context menu when right-clicking empty canvas space.

---

## v0.0.10 (2026-07-01)

### AI and integrations
- Added an OpenAI-compatible AI provider for custom base-URL endpoints.

### Import, editor, and publishing
- Fixed imported module scripts so their npm dependencies install correctly.
- Aligned canvas and Layers panel keyboard shortcuts.
- Let modules declare Content-Security-Policy sources, so published `base.video` YouTube embeds render correctly.
- Fixed empty-folder explorer operations so they apply without showing a stray "0 paths" dialog.

---

## ⚠️ Conflict risk to check before upgrading

Upstream's unreleased `main` branch (commit `8c245fb`, **not yet in a tagged release**) is titled **"fix(db): hydrate Postgres JSON text columns (#146)"**. This looks like the same bug this fork already fixed independently — per `docs/CHANGELOG.md` (2026-07-01 entry): `ai_messages.content_json` was declared `text` instead of `jsonb` in the Postgres migration, breaking AI chat history reads. **When upgrading past 0.0.10, diff this specific fix against the local patch instead of blindly taking upstream's version** — applying both could reintroduce the bug or produce a migration conflict.

---

## Unreleased on `main` (past v0.0.10, no tag yet)

As of 2026-07-07, `main` is **25 commits ahead** of the `v0.0.10` tag. Not an official release, but worth knowing what's coming next:

- Transactional site-document save with explicit deletes
- CSP hardening: `base-uri 'self'` + `object-src 'none'` on the admin CSP
- Scheme-check on custom `htmlAttributes` + deny dangerous custom tags (security)
- Light theme admin appearance preferences
- Canvas middle-mouse-button panning
- Font weights now derived from installed variants (fixes malformed `settings.fonts` handling)
- JSON-import media validated the same way as the archive import path (security)
- Windows dev-server fixes (port probing, launching via the current Bun executable, launching Vite through the dev script)
- The Postgres JSON-column fix noted above

---

## Recommendation

This fork has diverged from upstream (managed AI gateway, Cloudflare auto-deploy webhook, tenant model picker — see `docs/CHANGELOG.md`), so a **manual/diff-based merge** into `Insatic/tenant/vendor/` is safer than overwriting the vendored tree wholesale. If a full version bump isn't happening immediately, prioritize pulling the security-relevant patches independent of timing:

1. 0.0.8 — admin/upload security headers, SVG/archive sanitization, MCP token expiry
2. Unreleased — CSP `base-uri`/`object-src` hardening, `htmlAttributes` scheme-check, JSON-import media validation

_Compiled 2026-07-07 from the upstream `CHANGELOG.md`, GitHub Releases API, Tags API, and the `v0.0.10...main` commit compare for `corebunch/instatic`._
