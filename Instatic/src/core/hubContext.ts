/**
 * Hub context — the authorized scope a specialist product is opened with.
 *
 * The MMSBUILD shared-header contract requires every route between Product Hub
 * and a specialist product (MMS Design, this CMS) to carry the complete
 * authorized scope, and requires `Back to Product Hub` to return to the exact
 * surface the user came from. This module is the wire shape of that scope.
 *
 * It is a pure schema leaf so BOTH sides can import it: the server reads it off
 * the SSO hand-off and persists it on the session row; the admin shell reads it
 * back to render the Product Hub row and the return affordance.
 *
 * Absent context is a first-class state, not an error. A plain self-hosted
 * install has no Product Hub in front of it, so `null` is the normal answer and
 * the header degrades to logo + context label + utilities. The contract's rule
 * #4 — "missing or invalid context produces a clear selection state; it must
 * not default to … any other project" — means we never invent a client, a
 * project, or a Hub destination to fill the gap.
 */
import type { Static } from '@sinclair/typebox'
import { Type } from '@core/utils/typeboxHelpers'

/**
 * Role the Hub authorized this session as. Deliberately NOT derived from the
 * CMS's own role table: Instatic's roles are capability bundles scoped to one
 * site (`owner` / `admin` / `client` / `member`), while these describe the
 * user's authority across the whole portfolio. Only the Hub knows the latter,
 * so it travels with the context and is never inferred locally.
 *
 * `operator` and `agency` share one Hub navigation set per the contract; they
 * stay distinct values because the Hub distinguishes them elsewhere.
 */
export const HubRoleSchema = Type.Union([
  Type.Literal('operator'),
  Type.Literal('agency'),
  Type.Literal('client'),
  Type.Literal('super-admin'),
])

export type HubRole = Static<typeof HubRoleSchema>

/** Nullable string field — absent scope is normal, so `null` beats `undefined`. */
const OptionalScope = Type.Union([Type.String({ maxLength: 200 }), Type.Null()])

export const HubContextSchema = Type.Object({
  /** Origin the Product Hub is served from. Every Hub link is resolved against it. */
  hubBaseUrl: Type.String({ maxLength: 2048 }),
  role: HubRoleSchema,
  /** Client / organization display name. `null` until Operator models clients. */
  client: OptionalScope,
  /** Project display name. `null` until Operator models projects. */
  project: OptionalScope,
  /** Site display name within the project. */
  site: OptionalScope,
  /** Originating Hub surface / module / panel, echoed back on return. */
  origin: OptionalScope,
  /** Absolute URL of the exact Hub view to return to. Always Hub-origin. */
  returnUrl: Type.String({ maxLength: 2048 }),
  /**
   * Which products the operator has enabled platform-wide. The header uses them
   * to decide whether a Product Hub is worth linking to: with only one product
   * enabled the Hub bounces straight back, so `Home` links to where you are.
   *
   * Optional because a session minted before these existed has neither, and an
   * absent flag means "unknown" — treated as enabled, since the real gate is
   * server-side and wrongly hiding navigation is the worse failure.
   */
  designActive: Type.Optional(Type.Boolean()),
  cmsActive: Type.Optional(Type.Boolean()),
})

export type HubContext = Static<typeof HubContextSchema>

/** Response envelope for `GET /cms/api/cms/hub-context`. */
export const HubContextEnvelopeSchema = Type.Object({
  hubContext: Type.Union([HubContextSchema, Type.Null()]),
})

/**
 * Query-parameter names the SSO hand-off carries the scope in. Named here so
 * the Operator control-plane, the SSO handler, and the tests all agree on one
 * spelling instead of three near-identical string literals.
 */
export const HUB_CONTEXT_PARAMS = {
  role: 'hubRole',
  client: 'hubClient',
  project: 'hubProject',
  site: 'hubSite',
  origin: 'hubOrigin',
  returnUrl: 'hubReturnUrl',
  designActive: 'hubDesignActive',
  cmsActive: 'hubCmsActive',
} as const
