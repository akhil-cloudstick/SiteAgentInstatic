/**
 * inspectorSections — the one-home partition of the CSS workbench.
 *
 * Every one of the nine `CLASS_STYLE_SECTIONS` has exactly ONE home. These
 * three slices never intersect and together cover all nine, so a setting is
 * never on screen twice however the mode bodies compose them:
 *
 *   LAYOUT      layout · position · size · spacing   — box geometry
 *   STYLE       typography · background · border     — appearance
 *   VISIBILITY  effects · interaction                — presence and response
 *
 * `Live edit` has no tab strip, so it splits them across its two disclosures
 * ("Layout & spacing" takes LAYOUT, "Advanced instance styles, classes &
 * attributes" takes the rest). `Focus section` and `Responsive review` have tab
 * strips, so the tabs own the slices and their Advanced disclosure carries only
 * what no tab shows.
 *
 * Disjointness and completeness are gated by
 * `src/__tests__/architecture/inspectorSectionPartition.test.ts`.
 */

/** Box geometry — the Layout tab / the "Layout & spacing" disclosure. */
export const LAYOUT_SECTION_IDS = ['layout', 'position', 'size', 'spacing'] as const
/** Appearance — the Style tab. */
export const STYLE_SECTION_IDS = ['typography', 'background', 'border'] as const
/** Presence and response — the Visibility tab. */
export const VISIBILITY_SECTION_IDS = ['effects', 'interaction'] as const

/**
 * The declaration `BackgroundImageField` promotes into "Instance parameters"
 * for a container. Passed to whichever slice owns `background` as
 * `excludeProperties`, so a promoted image has exactly one home.
 */
export const BACKGROUND_IMAGE_PROPERTIES = ['backgroundImage'] as const
