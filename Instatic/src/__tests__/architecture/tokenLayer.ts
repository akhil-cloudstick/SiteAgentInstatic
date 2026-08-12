/**
 * The admin token layer, as the gates in this folder need to read it.
 *
 * It used to be one file. When the MMSBUILD two-row shell became a component
 * shared with MMS Design, the BASE layer — font faces, `:root`, the dark block
 * and the two-row shell geometry — moved to `shared/mms-shell/src/styles/`, so
 * that both products read one set of tokens rather than two that drift.
 * `src/styles/globals.css` kept everything screen-scoped and CMS-specific.
 *
 * Every gate that asks "is this token declared?" therefore has to look in both
 * places. This helper is that question's single answer — nine tests asking it
 * nine slightly different ways is exactly the drift the move was meant to end.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC_ROOT = join(import.meta.dir, '../..')

/** CMS-local: screen scopes, text-scale scopes, component rules, motion. */
export const GLOBALS_CSS = join(SRC_ROOT, 'styles/globals.css')

/** Shared base layer: `:root`, the dark block, the two-row shell geometry. */
export const SHARED_TOKENS_CSS = join(
  SRC_ROOT,
  '../../../OpenDesign/packages/mms-shell/src/styles/tokens.css',
)

/** Shared self-hosted font faces. */
export const SHARED_FONTS_CSS = join(
  SRC_ROOT,
  '../../../OpenDesign/packages/mms-shell/src/styles/fonts.css',
)

/** Every file that may legitimately declare a token, newest layer last. */
export const TOKEN_LAYER_FILES = [SHARED_FONTS_CSS, SHARED_TOKENS_CSS, GLOBALS_CSS]

/**
 * The whole token layer as one string. Use this anywhere a gate previously read
 * `globals.css` to answer "is this token declared / does this value exist".
 */
export function readTokenLayer(): string {
  return TOKEN_LAYER_FILES.map((file) => readFileSync(file, 'utf8')).join('\n')
}
