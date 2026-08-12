/**
 * Floating-position math — now owned by `@mms/shell`.
 *
 * It moved with `ContextMenu` and `Tooltip`, which are the only things that
 * consume it and which the shared shell renders. Re-exported at the original
 * specifier so no call site changed.
 */
export * from '@mms/shell/lib/floatingPosition'
