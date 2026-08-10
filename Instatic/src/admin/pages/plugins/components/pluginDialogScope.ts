/**
 * `Dialog` portals into `document.body`, which sits outside the Plugins
 * workspace body that carries `data-editor-screen="plugins"`. Without that
 * attribute travelling with the portal, every `--plugins-*` token resolves to
 * nothing and the plugins palette falls back to the generic admin ramp — the
 * modal reads a step warmer than the screen that opened it.
 *
 * This is the same problem the Content workspace's portaled slash menu has, and
 * the same fix: re-declare the scope on the portaled element. `Dialog` exposes
 * a `ref` to its root, so the attribute can be stamped there without a single
 * change to the shared primitive.
 *
 * The theme attribute needs no such treatment — `editorPreferences` sets
 * `data-editor-theme` on the document root, so `[data-editor-theme='dark']
 * [data-editor-screen='plugins']` matches inside the portal too.
 */
export function pluginDialogScopeRef(node: HTMLDivElement | null): void {
  node?.setAttribute('data-editor-screen', 'plugins')
}
