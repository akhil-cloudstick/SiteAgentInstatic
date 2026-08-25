# Editor undo/redo

How Cmd+Z works in the visual editor since real-time co-editing landed.

## Where history lives

History does **not** live in the Zustand store anymore. It lives in the
collab binding (`src/admin/pages/site/store/slices/site/collabBinding.ts`)
as one **`Y.UndoManager` per collab document** — one per page, Visual
Component, and layout, plus one for the site shell/rosters. The store only
mirrors availability flags (`canUndo` / `canRedo`) and exposes the `undo` /
`redo` actions, which delegate to the binding (`site/undoRedoActions.ts`).

Because each manager tracks **`LOCAL_ORIGIN` only**, undo is per-editor by
construction: your Cmd+Z reverts *your* edits, never a peer’s — the
co-editing invariant.

## The mutation path

Every store mutation still runs through `runHistoricMutation`
(`site/helpers.ts`): the recipe mutates a Mutative draft, the resulting
site-relative patches are handed to `applyLocalSitePatches` (the binding),
which translates them into Y operations on the touched docs
(`@core/collab` `applySitePatchesToDocs`). The Y transaction is what the
UndoManager captures — the undo stack IS the CRDT edit history.

Undoing pops the doc’s stack; the resulting doc change projects back into
the store through the binding’s projection path (the same path remote
peers’ edits use), synchronously flushed so undo repaints immediately.

## Coalescing (typing bursts)

Per-keystroke mutations (text edits, number sliders) pass a stable
`coalesceKey` such as `props:<nodeId>:<prop>` through the `mutate*` helpers.
The managers run with an infinite `captureTimeout`; the binding calls
`stopCapturing()` exactly when the incoming key differs from the previous
one — so consecutive same-key edits merge into ONE undo step, and any
non-coalescing mutation, undo/redo, or inline-edit session boundary
(`collabBreakCoalescing`) starts a fresh step. Typing a word is one Cmd+Z.

## Multi-doc undo groups

A single mutation can touch several docs (convert-to-component writes the
page, the new component, and the site roster; Super Import touches
everything). The binding records each undoable step as a **group of docIds**
whose managers captured a new stack item, and `undo()` reverts the whole
group — one Cmd+Z, one logical mutation, across all its documents. The site
doc always sorts first in a group so roster reverts project after row-level
reverts.

## Lifecycle

`createSite` / `loadSite` / `clearSite` call `resetCollabDocsFromSite`,
which rebuilds the doc world for the new document and clears every undo
manager — history never survives a document swap. In detached mode (tests,
the pre-connect window) docs seed locally from the loaded site; in connected
mode every doc rebinds through the provider and the server seeds it.

Editor-local state (selection, zoom, panel visibility) is not undoable —
only document content flows through the docs.

It is, however, **reconciled**. A projection can remove nodes the editor is
still pointing at — an undo reverting an insertion, or a peer deleting the
subtree you had selected. The projection path therefore runs
`pruneCanvasSelectionDraft` after the new site lands, exactly as a local
`deleteNode` does: selections are pruned by tree-membership (survivors keep
theirs, the anchor re-syncs, descendants swept with a subtree drop out), and
an inline-edit session whose node vanished is closed. This is why selection
state has one pruning implementation rather than one per write path.

## Key files

```ts
_historyPast:       HistoryEntry[]  // stack — most recent last
_historyFuture:     HistoryEntry[]  // entries available for redo
canUndo:            boolean
canRedo:            boolean
_historyCoalesceKey: string | null  // identity of the in-progress burst
```

---

## How patches are captured

`runHistoricMutation` in `helpers.ts` is the core engine:

```ts
function runHistoricMutation(recipe, coalesceKey) {
  const [next, patches, inverse] = create(cur, (draft) => {
    result = recipe(draft)
    if (result !== false) draft.site.updatedAt = Date.now()
  }, { enablePatches: true })

  // History stores patches relative to `site` (strip the leading path segment)
  const siteForward = patches .filter(p => p.path[0] === 'site').map(p => ({ ...p, path: p.path.slice(1) }))
  const siteInverse = inverse.filter(p => p.path[0] === 'site').map(p => ({ ...p, path: p.path.slice(1) }))

  set(state => {
    // Apply all changed fields to the live store (site + any editor fields)
    for (const key of touched) live[key] = produced[key]
    if (siteForward.length > 0) commitHistory(state, { inverse: siteInverse, forward: siteForward, coalesceKey })
    state.hasUnsavedChanges = true
  })
}
```

`create(cur, recipe, { enablePatches: true })` returns `[next, forwardPatches, inversePatches]`. Only `site`-prefixed patches go into the history entry. Editor-only fields (selection, zoom) are applied live but never recorded.

---

## The six `mutate*` helpers

All six helpers in `SiteSliceHelpers` delegate to `runHistoricMutation`:

| Helper | Recipe receives | Coalescing |
|---|---|---|
| `mutateSite(fn, opts?)` | `SiteDocument` draft | `opts.coalesceKey` |
| `mutateSiteWithExplorerReconcile(fn)` | `SiteDocument` draft; calls `reconcileSiteExplorerInPlace` after | none |
| `mutatePage(fn)` | Active `Page` draft | none |
| `mutateActiveTree(fn, opts?)` | Active `NodeTree<PageNode>` draft; routes page vs. VC | `opts.coalesceKey` |
| `mutateActiveTreeAndSite(fn)` | Active `NodeTree<PageNode>` + `SiteDocument` drafts | none |
| `mutateAllPagesAndSite(fn)` | `SiteDocument` + `SuperImportHelpers` | none |

`mutateActiveTree` is the only place that branches on page-mode vs. VC-mode. Gated by `no-vc-mode-branches-in-mutations.test.ts`.

---

## Coalescing

Per-keystroke mutations (text edits, number sliders) pass a stable `coalesceKey` such as `props:<nodeId>:<prop>`. While the incoming key matches `_historyCoalesceKey`, `commitHistory` folds the new entry into the existing top entry **per patch path** (`foldIntoCoalescedEntry` in `helpers.ts`):

- **inverse**: the OLDEST patch per path wins (undo restores the pre-burst value); new paths append.
- **forward**: the NEWEST patch's value per path wins (redo replays the final value), preserving the oldest patch's op (an `add` stays an `add` so redo works from the post-undo state where the prop is absent).

A whole typing burst becomes one undo step holding at most one inverse + one forward patch per touched path — a 2,000-keystroke burst retains 2 paths' worth of patches, not 4,000 progressively-longer string snapshots.

Any non-coalescing mutation, `undo`, `redo`, or a site (re)load resets `_historyCoalesceKey` to `null`.

---

## Undo / redo apply

`undoRedoActions.ts` uses `apply` from Mutative:

```ts
// undo
const restored = apply(site, entry.inverse)
const packageJson = clonePackageJson(restored.packageJson)
const siteRuntime = cloneSiteRuntimeConfig(restored.runtime)
set(state => {
  state._historyPast.pop()
  state._historyFuture.push(entry)
  state._historyCoalesceKey = null
  state.site = { ...restored, packageJson, runtime: siteRuntime }
  state.packageJson = packageJson
  state.siteRuntime = siteRuntime
  // re-derive mirrors; keep activePageId valid
})
```

`redo` is symmetric: pops from `_historyFuture`, applies `entry.forward`, pushes back onto `_historyPast`.

---

## Auto-freeze

The Zustand store is created with `mutative({ enableAutoFreeze: true })`. That keeps a dev guard against accidental external mutation, and existing code already tolerates frozen state. `apply()` and `create()` handle frozen bases correctly.

---

## What is NOT undoable

- Selection, hover, zoom, pan — editor-local UI state, not in the `site` document.
- `mutateSiteState` — the recipe may write editor fields (e.g. `activeDocument`) alongside a `site` mutation; the editor fields go live but only the `site` patches enter history (parity with the prior snapshot model).
- History stacks themselves — resetting to `[]` on `clearSite` is a lifecycle operation, not a mutation.

---

## Forbidden patterns

- `structuredClone(site)` for history — the old snapshot model is gone. Never re-introduce it.
- Calling `set(state => { state.site = ... })` directly on a mutation — go through a `mutate*` helper so patches are captured.
- Returning a value from a `create` recipe — Mutative treats it as a full replacement. Capture no-op signals in a closure variable and return `false`.

---

## Related

- `src/admin/pages/site/store/slices/site/helpers.ts` — `runHistoricMutation`, `commitHistory`, all six `mutate*` helpers
- `src/admin/pages/site/store/slices/site/undoRedoActions.ts` — `undo`, `redo`
- `src/admin/pages/site/canvas/useUndoRedoShortcuts.ts` — the only non-palette way in: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (Ctrl+Y alias). The canvas chrome has no Undo/Redo buttons.
- `src/admin/pages/site/store/slices/site/types.ts` — `HistoryEntry`, `SiteSliceHelpers`
- `src/admin/pages/site/store/slices/site/defaults.ts` — `MAX_HISTORY`
- `docs/editor.md` — editor store overview
- `docs/reference/page-tree.md` — the `NodeTree` primitive mutations operate on
- Gate tests:
  - `src/__tests__/architecture/centralized-site-mutation-history.test.ts`
  - `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`
  - `src/__tests__/editor-store/undo-redo.test.ts`
