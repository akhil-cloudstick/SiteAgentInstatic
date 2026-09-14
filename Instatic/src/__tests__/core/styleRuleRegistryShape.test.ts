/**
 * `parseStyleRuleRegistry` tolerates an ABSENT registry and rejects a
 * WRONG-SHAPED one.
 *
 * Both used to return `{}`, which is the failure this pins. Downstream, `{}`
 * means every `classIds` reference resolves to nothing and the site renders with
 * no styling at all — successfully. So a registry arriving as an array does not
 * produce an error, it produces a stripped site that reports success.
 *
 * A partner's emitter shipped exactly that shape: an array of 617 valid rules.
 * Their import was rejected upstream by `SiteBundleSchema` — TypeBox's
 * `Type.Record` does refuse an array — but the READ path had no such guard, so
 * any shell persisted through another route would have loaded silently bare.
 *
 * The general rule this encodes: absent means "the author had nothing to say";
 * wrong-shaped means "something upstream is broken". Answering both with a
 * default converts a loud failure into a silent one.
 */

import { describe, expect, test } from 'bun:test'
import { parseStyleRuleRegistry } from '@core/page-tree'

const rule = (id: string) => ({
  id,
  name: id,
  kind: 'class',
  selector: `.${id}`,
  order: 0,
  styles: { color: 'red' },
  createdAt: 1,
  updatedAt: 1,
})

describe('parseStyleRuleRegistry — absent vs wrong-shaped', () => {
  test('absent is tolerated', () => {
    expect(parseStyleRuleRegistry(undefined)).toEqual({})
    expect(parseStyleRuleRegistry(null)).toEqual({})
  })

  test('an empty registry is tolerated', () => {
    expect(parseStyleRuleRegistry({})).toEqual({})
  })

  test('a well-formed registry parses', () => {
    const parsed = parseStyleRuleRegistry({ a: rule('a'), b: rule('b') })

    expect(Object.keys(parsed).sort()).toEqual(['a', 'b'])
  })

  test('an ARRAY throws instead of silently yielding {}', () => {
    // The reported shape. `{}` here renders the whole site unstyled and calls
    // it a success.
    expect(() => parseStyleRuleRegistry([rule('a'), rule('b')])).toThrow(/must be an object/)
  })

  test('an empty array throws too', () => {
    // Indistinguishable from an empty registry by result, but not by cause —
    // an emitter producing `[]` is producing the wrong shape either way, and
    // it will produce a populated array next run.
    expect(() => parseStyleRuleRegistry([])).toThrow(/must be an object/)
  })

  test('other wrong shapes throw, naming what arrived', () => {
    expect(() => parseStyleRuleRegistry('rules')).toThrow(/string/)
    expect(() => parseStyleRuleRegistry(42)).toThrow(/number/)
  })

  test('the message says why, not just what', () => {
    // The caller is an emitter author who believes their bundle is fine; the
    // consequence is the part they need.
    expect(() => parseStyleRuleRegistry([rule('a')])).toThrow(/no styling/)
  })

  test('per-ENTRY leniency is unchanged — one bad rule does not stop the load', () => {
    const parsed = parseStyleRuleRegistry({
      good: rule('good'),
      bad: { name: 'no id' },
      alsoBad: null,
    })

    expect(Object.keys(parsed)).toEqual(['good'])
  })
})
