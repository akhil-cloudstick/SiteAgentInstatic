/**
 * Button — now owned by `@mms/shell`.
 *
 * It moved there with the shared two-row shell, which renders its utilities,
 * menu items and the Back-to-Product-Hub control with it. Two copies would let
 * the CMS's header buttons and MMS Design's drift on hover tint, focus ring and
 * target size — exactly what the shared-header contract forbids.
 *
 * Re-exported at the original specifier so no call site had to change, and so
 * `button-primitive-usage.test.ts` keeps pointing at one import path.
 */
export { Button } from '@mms/shell'
export type { ButtonProps } from '@mms/shell'
