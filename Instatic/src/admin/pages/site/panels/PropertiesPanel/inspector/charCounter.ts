/**
 * charCounter — the approved Site screen's `used/max` field footnote.
 *
 * The reference prints `25/100` under a text field that declares a maximum
 * length, so an author can see a heading approaching the limit its design was
 * drawn for. Returns `undefined` when the parameter declares no limit, which is
 * the signal to render no footnote at all.
 */
export function charCounter(value: unknown, maxLength: number | undefined): string | undefined {
  if (maxLength === undefined) return undefined
  return `${typeof value === 'string' ? value.length : 0}/${maxLength}`
}
