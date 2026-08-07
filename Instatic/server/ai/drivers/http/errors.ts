/**
 * Shared error classification for the direct provider HTTP drivers.
 *
 * Direct REST gives us the HTTP status code, so we can classify auth/billing
 * failures precisely (401 → bad key, 402/429 → quota) and surface actionable
 * copy in the admin-only chat surface, rather than forwarding a raw stack
 * trace or a generic "something went wrong".
 */

/**
 * True when an error is the result of the request abort signal firing — a
 * cancelled chat or client disconnect. Drivers return cleanly on these
 * (no `error` event) so the UI doesn't flash a spurious failure.
 */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'))
  )
}

/**
 * Classify a non-OK HTTP response into a user-facing message. `bodyText` is
 * the (already-read) response body; the provider's `{ error: { message } }`
 * envelope is preferred when present, otherwise a status-based fallback.
 */
export function classifyHttpError(
  providerLabel: string,
  status: number,
  bodyText: string,
): string {
  return classifyHttpFailure(providerLabel, status, bodyText).message
}

export interface ProviderHttpFailure {
  kind: 'replayOverflow' | 'imageUnsupported' | 'generic'
  message: string
}

/**
 * Structured classification lets the tool loop retry the two failures a resend
 * can actually fix: a context overflow (drop old images) and a model that
 * cannot read images at all (drop every image).
 */
export function classifyHttpFailure(
  providerLabel: string,
  status: number,
  bodyText: string,
): ProviderHttpFailure {
  const detail = extractErrorMessage(bodyText)

  if (status === 401 || status === 403) {
    return {
      kind: 'generic',
      message: `${providerLabel} authentication failed. Check your API key in /admin/ai/providers.`,
    }
  }
  if (status === 402 || status === 429) {
    return {
      kind: 'generic',
      message: `${providerLabel} quota or rate limit reached${detail ? `: ${detail}` : ''}. Check your account balance.`,
    }
  }
  if (requestExceedsProviderContext(status, bodyText, detail)) {
    return {
      kind: 'replayOverflow',
      message: `${providerLabel} could not accept this conversation because it exceeds the provider's request or context limit${detail ? `: ${detail}` : ''}. Your history is still saved; start a new conversation or choose a model with a larger context window.`,
    }
  }
  if (modelRejectsImageInput(status, bodyText, detail)) {
    return {
      kind: 'imageUnsupported',
      message: `${providerLabel} rejected this request because the model cannot read images${detail ? `: ${detail}` : ''}. Retrying without them failed — choose a vision-capable model.`,
    }
  }
  if (status >= 500) {
    return {
      kind: 'generic',
      message: `${providerLabel} service error (${status})${detail ? `: ${detail}` : ''}. Please try again.`,
    }
  }
  return {
    kind: 'generic',
    message: `${providerLabel} error (${status})${detail ? `: ${detail}` : ''}.`,
  }
}

/**
 * True when the provider refused the request because the resolved model (or,
 * on OpenRouter, every upstream endpoint available for it) takes text only.
 *
 * This is NOT knowable up front in every deployment. In managed mode the AI
 * Gateway resolves the model per request from the prompt's task-type category,
 * so the tenant server advertises a fixed permissive capability set and cannot
 * tell whether THIS call landed on a vision model. On OpenRouter the catalogue
 * flag is model-level while the refusal is endpoint-level — a key whose
 * provider/data-policy settings exclude the image-capable endpoints gets this
 * 404 for a model the catalogue lists as multimodal.
 *
 * Both cases are recoverable by resending without images, so this earns its own
 * failure kind rather than dead-ending as `generic`.
 */
function modelRejectsImageInput(
  status: number,
  bodyText: string,
  detail: string | null,
): boolean {
  if (status !== 400 && status !== 404 && status !== 415 && status !== 422) return false
  const providerSignal = `${detail ?? ''} ${bodyText}`
  return /(?:no endpoints found that support image input|(?:does not|doesn'?t|cannot|can'?t)[^.]{0,32}(?:image|vision)|(?:image|vision)[^.]{0,32}(?:is )?not supported|unsupported[^.]{0,16}(?:image|vision))/i.test(providerSignal)
}

function requestExceedsProviderContext(
  status: number,
  bodyText: string,
  detail: string | null,
): boolean {
  if (status === 413) return true
  if (status !== 400) return false
  const providerSignal = `${detail ?? ''} ${bodyText}`
  return /(?:context.{0,24}(?:length|limit|window|exceed)|maximum.{0,16}tokens|too[_ ]many[_ ]tokens|request[_ ].{0,16}(?:too[_ ]large|exceed)|input[_ ]too[_ ]long|too[_ ]many[_ ]images|image.{0,16}(?:count|limit|maximum))/i.test(providerSignal)
}

/**
 * Pull a short message out of a provider error body. Providers return
 * `{ error: { message } }` (Anthropic/OpenAI) or `{ error: "..." }`; anything
 * unparseable collapses to the raw text (capped) so we never lose the detail
 * entirely.
 */
function extractErrorMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error: unknown }).error
      if (typeof err === 'string') return err
      if (err && typeof err === 'object' && 'message' in err) {
        const msg = (err as { message: unknown }).message
        if (typeof msg === 'string') return msg
      }
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return trimmed.slice(0, 200)
}
