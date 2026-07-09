# Annotation "wrong element" + Screenshot capture — diagnosis & known upstream issues

_Investigated 2026-07-09 on this vendored fork (Open Design, `nexu-io/open-design`), running
`start-open-design.cmd` (standalone daemon + `--serve-web`) in a plain browser tab over the `S:` SMB drive._

## TL;DR

Two symptoms the operator hit are the **same root cause**, and **both are open upstream bugs**:

| Symptom | Upstream issue | State |
|---|---|---|
| Screenshot: "Could not capture the preview" / capture returns nothing | [#3605 "Fix image export when artifact snapshot capture returns null"](https://github.com/nexu-io/open-design/issues/3605), [#5319 "html-preview.png captures viewer shell instead of the canvas"](https://github.com/nexu-io/open-design/issues/5319) | **Open** |
| Marked section/element edits the **wrong element** | [#4084 "Visual annotations lose position/selector metadata when sent without a screenshot"](https://github.com/nexu-io/open-design/issues/4084) | **Open** |
| Agent errors "Invalid Responses API request" | separate — the `openai-api` agent, cf. [#290 "open-design not working with my opencode"](https://github.com/nexu-io/open-design/issues/290) | n/a |

## Why the two are one problem

In Open Design, a marked element's identity (**CSS selector + position**) is transported to the AI
**bundled inside the annotation screenshot attachment** (`ChatComposer.onAnnotation` only builds the
structured visual attachment when `screenshot && markKind && bounds`). So:

```
screenshot capture fails (#3605)
  -> annotation is sent WITHOUT the screenshot        (official v0.11.0 behavior: "send annotations
                                                        without the screenshot when capture fails")
  -> the element's selector/position metadata is lost  (#4084)
  -> the AI has no idea which element was marked
  -> it guesses (edits the Suite image / the whole hero / global CSS tokens)
```

The maintainers' v0.11.0 release notes explicitly say they *"send annotations without the screenshot when
capture fails"* — which is exactly what strips the element info.

## Why the screenshot fails (and can't be fixed in a browser tab)

The in-browser capture rasterizes the DOM via an **SVG `<foreignObject>` → `<img>` → canvas** pipeline.
Chromium frequently **refuses to paint** a `<foreignObject>` loaded via `<img>` on real, image-heavy pages
(the code itself notes this next to issue #4064; #3605 is open because the capture "returns null"). It is
only reliable in the **Open Design desktop app**, which captures via real Chromium — not `foreignObject`.
There is no browser-tab fix; this is a platform limitation.

Additional wrinkle for this project's pages: they use **cross-origin `images.unsplash.com`** images, which
also *taint* the canvas (`toDataURL` throws). A same-origin `/api/capture-proxy` was added to de-taint, but
it does not help when the `foreignObject` render itself never paints.

## Workaround implemented in this fork (so edits work WITHOUT the screenshot)

Rather than depend on the failing screenshot, the marked element's identity is now sent to the agent
**separately** from the screenshot:

1. **`od:element-at-point` bridge query** (`apps/web/src/runtime/srcdoc.ts` and
   `apps/daemon/src/routes/project/index.ts`): given the drawn box, resolve the element under it —
   preferring an `<img>`/`<video>` the box mostly covers, else the ancestor with the best box-overlap (IoU),
   with a DOM-selector fallback (`targetFrom(el, /*allowDomFallback*/ true)`).
2. **`PreviewDrawOverlay.send()`** (`apps/web/src/components/PreviewDrawOverlay.tsx`) calls that query on the
   visible iframe and attaches the resolved element as the annotation `target`.
3. **`ChatComposer.annotationScopeHint(detail)`** (`apps/web/src/components/ChatComposer.tsx`) injects an
   explicit instruction into the prompt: *"apply this ONLY to `<element>` (selector / text); do NOT change
   global CSS variables/tokens, the page/body/section background, or any other element."* — with a
   safety-net variant when the exact element can't be resolved.

### Why it works in some places but not others

- ✅ Resolves cleanly for **images** (media-preference → precise `img:nth-of-type(...)` selector) and
  **structural blocks / headings** (they carry `data-od-id` or a good DOM path).
- ⚠️ Falls back to the generic "scope to the marked region" hint for **small unstamped inner elements**
  (e.g. an amenity "Breakfast" cell): Open Design's own selector-builder (`meaningfulDomFallbackTarget`)
  refuses to emit a selector for elements it doesn't deem "meaningful", so there is no precise target and
  the AI may still guess. This is the residual edge of upstream #4084.

## The "Invalid Responses API request" error

Separate from annotations. `agent_id: openai-api`, `error_code: AGENT_EXECUTION_FAILED` — the **OpenAI
Responses API** rejects the request (it appears even on *successful* edits, proving it is not the
annotation path). The operator's *working* edits ran on the **OpenRouter / minimax** agent. **Switch the
agent/model back to OpenRouter/OpenCode** to stop these errors.

## Current decision

- **Screenshot UI is hidden** behind a single flag (re-enable later) — it is unreliable in the browser and
  the edit flow no longer needs it.
- **Undo** already exists: the artifact toolbar's **history / clock icon** → restore the version before an
  unwanted edit.
- For reliable screenshots, use the **Open Design desktop app**.

## Follow-ups (optional)

- Push the element resolver further so tiny inner cells also get a selector (relax
  `meaningfulDomFallbackTarget`, or synthesize an `nth-child` selector for any hit element). Closes the
  residual edge of #4084 in this fork.
- Consider contributing the "send selector/position independently of the screenshot" fix upstream against
  issue #4084.

## Sources

- <https://github.com/nexu-io/open-design/issues/4084>
- <https://github.com/nexu-io/open-design/issues/3605>
- <https://github.com/nexu-io/open-design/issues/5319>
- <https://github.com/nexu-io/open-design/issues/290>
- <https://github.com/nexu-io/open-design/issues>
