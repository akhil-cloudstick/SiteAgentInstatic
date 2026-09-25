/**
 * Self-test for AI spending caps (security class E4).
 * Run: `npm run test:spend` (from Operator/). No database, no network.
 *
 * E4 was an accepted omission in the PRD — "no spend cap exists today" — so
 * every rule here is new, and the owner stated them precisely. The ones worth
 * testing are the ones where a plausible implementation gets it wrong:
 *
 *   - a cap of zero, and no cap at all, are not the same thing
 *   - an unknown cost is not a cost of zero
 *   - an unreadable ledger fails CLOSED, but only where a cap exists
 *   - usage arrives in the last frame of a stream, and streams do not respect
 *     chunk boundaries
 */
import {
  WARN_AT_FRACTION,
  askForUsage,
  capDecision,
  costOf,
  createUsageScanner,
  monthKey,
  pricesOf,
  usageOf,
} from './aiSpend.mjs';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// --- the window ----------------------------------------------------------------
check('a month key is UTC year-month', monthKey(new Date('2026-09-25T12:00:00Z')), '2026-09');
check('and pads the month', monthKey(new Date('2026-01-03T00:00:00Z')), '2026-01');
// The boundary that would move if this used local time: 23:30 UTC on the last
// day of a month is already the next month in some timezones.
check('the last instant of a month is still that month', monthKey(new Date('2026-09-30T23:59:59Z')), '2026-09');
check('the first instant of the next one has rolled over', monthKey(new Date('2026-10-01T00:00:00Z')), '2026-10');

// --- the decision --------------------------------------------------------------
const d = (cap, spent) => capDecision({ cap, spent });

check('no cap allows, whatever has been spent', d(null, 9999).allow, true);
check('and reports no level', d(null, 9999).level, 'none');

// A cap of zero is an empty form field far more often than an intention to stop
// a project working, so it is read as "no cap" rather than "block everything".
check('a cap of zero is no cap, not a total block', d(0, 5).allow, true);

check('well under the cap is ok', d(100, 10).level, 'ok');
check('and does not warn', d(100, 10).allow, true);

// The two thresholds the owner named.
check('at 80 per cent it warns', d(100, 80).level, 'warn');
check('but still allows — a warning is not a stop', d(100, 80).allow, true);
check('the warn fraction is the stated one', WARN_AT_FRACTION, 0.8);
check('just under 80 per cent does not warn', d(100, 79.99).level, 'ok');

check('at 100 per cent it stops', d(100, 100).level, 'stopped');
check('and refuses', d(100, 100).allow, false);
check('over 100 per cent also stops', d(100, 250).allow, false);

// The message a tenant sees has to say the thing they will otherwise ask about.
check(
  'the refusal says editing and the live site are unaffected',
  /Editing, publishing and the live site are unaffected/.test(d(100, 100).reason),
  true,
);

// --- fail closed, but only where a cap exists ------------------------------------
//
// The asymmetry is the point. Refusing when no cap was ever set would turn a
// database blip into an AI outage on every project; allowing when a cap IS set
// would spend an unknown amount against a known limit.
check('cap set, spend unreadable -> refuse', d(100, null).allow, false);
check('and says so rather than guessing', d(100, null).level, 'unknown');
check('no cap, spend unreadable -> allow', d(null, null).allow, true);

// --- cost, and the difference between unknown and free ---------------------------
const prices = { prompt: 0.000003, completion: 0.000015 };
check('cost is tokens times rates', costOf({ promptTokens: 1000, completionTokens: 500 }, prices), 0.0105);
check('output-only still prices', costOf({ promptTokens: 0, completionTokens: 1000 }, prices), 0.015);

// A null here is load-bearing: a zero would be indistinguishable from a free
// call, and a month of unpriced calls would read as a month of spending nothing.
check('no usage means unknown, NOT zero', costOf(null, prices), null);
check('no prices means unknown, NOT zero', costOf({ promptTokens: 10, completionTokens: 10 }, null), null);

check('prices come off the catalogue entry', pricesOf({ pricing: { prompt: '0.000003', completion: '0.000015' } }), prices);
check('a model with no pricing block has no prices', pricesOf({ id: 'x' }), null);
check('a model with unusable pricing has no prices', pricesOf({ pricing: { prompt: 'free' } }), null);

// --- both usage shapes ------------------------------------------------------------
check(
  'chat completions shape',
  usageOf({ usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }),
  { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
);
check(
  'responses API shape',
  usageOf({ usage: { input_tokens: 7, output_tokens: 2 } }),
  { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
);
check('no usage block', usageOf({ choices: [] }), null);

// --- reading usage out of a stream -------------------------------------------------
//
// The gateway pipes the response through token by token, so the usage has to be
// caught in flight. It arrives in the final frame.
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

let s = createUsageScanner();
s.push(sse({ choices: [{ delta: { content: 'Hel' } }] }));
s.push(sse({ choices: [{ delta: { content: 'lo' } }] }));
s.push(sse({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }));
s.push('data: [DONE]\n\n');
check('usage is found in the final frame', s.result(), { promptTokens: 20, completionTokens: 5, totalTokens: 25 });

// A stream does not respect frame boundaries, and an implementation that parses
// per chunk rather than per line misses this.
s = createUsageScanner();
const whole = sse({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } });
s.push(whole.slice(0, 18));
s.push(whole.slice(18));
check('a frame split across two chunks is still read', s.result(), { promptTokens: 11, completionTokens: 4, totalTokens: 15 });

// The last usage wins: some providers report a running total.
s = createUsageScanner();
s.push(sse({ usage: { prompt_tokens: 5, completion_tokens: 1 } }));
s.push(sse({ usage: { prompt_tokens: 5, completion_tokens: 9 } }));
check('the last usage seen wins', s.result().completionTokens, 9);

// Everything that can appear in a stream and is not usage.
s = createUsageScanner();
s.push(': keep-alive\n\n');
s.push('data: not json\n\n');
s.push('event: ping\n\n');
s.push('\n');
check('noise yields no usage rather than an error', s.result(), null);

// A final frame with no trailing newline still counts — the stream just ended.
s = createUsageScanner();
s.push('data: {"usage":{"prompt_tokens":3,"completion_tokens":1}}');
check('an unterminated last frame is still read', s.result(), { promptTokens: 3, completionTokens: 1, totalTokens: 4 });

// Binary chunks are what actually arrive off the socket.
s = createUsageScanner();
s.push(Buffer.from(sse({ usage: { prompt_tokens: 2, completion_tokens: 2 } }), 'utf8'));
check('a Buffer chunk is handled', s.result().totalTokens, 4);

// --- asking the provider for usage in the first place ------------------------------
check('a streamed call asks for usage', askForUsage({ stream: true }).stream_options, { include_usage: true });
check(
  'and keeps any options already there',
  askForUsage({ stream: true, stream_options: { other: 1 } }).stream_options,
  { other: 1, include_usage: true },
);
// Non-streamed responses already carry usage, and some providers reject the
// option outright — so it is not added.
check('a non-streamed call is left alone', askForUsage({ stream: false }).stream_options, undefined);
check('a call with no stream field is left alone', askForUsage({ model: 'x' }).stream_options, undefined);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall AI spending-cap checks passed');
process.exit(0);
