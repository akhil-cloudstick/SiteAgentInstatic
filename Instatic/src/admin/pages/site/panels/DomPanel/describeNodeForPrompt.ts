/**
 * Plain-English opener for the "Edit with AI" composer seed.
 *
 * The tenant reads this, so it must sound like something they'd write — but it
 * also has to be unambiguous to the model. Naming alone is not: a container's
 * display name is often the generic "Container", and the agent answered such a
 * seed by asking WHICH container the author meant instead of editing the one
 * they had just selected. So the node id rides along in parentheses. The
 * snapshot's `Selected:` line carries the same id, which is what binds the
 * sentence to the actual node.
 *
 * Its own module rather than living beside the menu component, so the menu
 * file only exports components (Fast Refresh requirement).
 */
export function describeNodeForPrompt(
  moduleId: string | null,
  displayName: string | null,
  text: string | null,
  nodeId: string,
): string {
  // A text node's own words identify it far better than "Text" ever could.
  if (text) {
    const excerpt = text.length > 70 ? `${text.slice(0, 70).trimEnd()}…` : text
    return `Edit this text (node ${nodeId}) — "${excerpt}"`
  }

  const kind = moduleId === 'base.image' ? 'image'
    : moduleId === 'base.button' ? 'button'
    : moduleId === 'base.form' ? 'form'
    : moduleId === 'base.visual-component-ref' ? 'component'
    : moduleId === 'base.container' ? 'section'
    : null

  const noun = kind ?? 'block'
  const named = displayName ? `the "${displayName}" ${noun}` : `this ${noun}`
  return `Edit ${named} (node ${nodeId})`
}
