/**
 * Self-test for the console's CSRF origin gate (security item E7).
 * Run: `npm run test:console-origin` (from Operator/). No database, no network.
 *
 * Why this exists as its own file: until now the console had NO server-side
 * origin check at all. `astro.config.mjs` set `security: { checkOrigin: false }`
 * because Astro compares Origin against the request HOST and the gateway
 * rewrites Host to 127.0.0.1:3000, so every funnel POST was rejected. The
 * defence was left to `SameSite=Strict` on the session cookie.
 *
 * That is not sufficient on this deployment, and the reason is the thing worth
 * pinning: the console, the CMS and the design studio are served from ONE
 * origin by the gateway. SameSite distinguishes sites, not paths — so a script
 * on any tenant page is same-site and same-origin with the console, and
 * `Path=/operator` limits which requests carry the cookie, not which pages may
 * send them. The handlers behind it include act-as, remove and expose.
 *
 * Imported straight from `cp.ts` (Node 24 strips the types) so this tests the
 * shipping function rather than a copy of it.
 */
import { consoleOriginAllowed, expectedConsoleOrigin } from './cp.ts';

const GATEWAY = 'https://siteagent.tailbbb0d2.ts.net';

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

/** A request as the gateway delivers it: Host rewritten, real host forwarded. */
function viaGateway(headers = {}) {
  return new Request('http://127.0.0.1:3000/operator/projects', {
    method: 'POST',
    headers: { 'x-forwarded-host': 'siteagent.tailbbb0d2.ts.net', 'x-forwarded-proto': 'https', ...headers },
  });
}

/** A request straight to the console, with no proxy in front. */
function direct(headers = {}) {
  return new Request('http://127.0.0.1:3000/operator/projects', { method: 'POST', headers });
}

// --- through the gateway, which is how the console is actually reached -------
process.env.GATEWAY_ORIGIN = GATEWAY;

check('configured origin is read', expectedConsoleOrigin(), GATEWAY);

check(
  'the gateway origin is allowed',
  consoleOriginAllowed(viaGateway({ origin: GATEWAY, 'sec-fetch-site': 'same-origin' })),
  true,
);

check(
  'a trailing slash on the Origin still matches',
  consoleOriginAllowed(viaGateway({ origin: `${GATEWAY}/` })),
  true,
);

check(
  'another origin is refused',
  consoleOriginAllowed(viaGateway({ origin: 'https://evil.example' })),
  false,
);

// The attack this whole gate exists for: same-origin with the console because
// the gateway serves every tenant surface from one host. The Origin header
// therefore MATCHES, and only Sec-Fetch-Site distinguishes the caller.
check(
  'a cross-site caller is refused even when it presents the right Origin',
  consoleOriginAllowed(viaGateway({ origin: GATEWAY, 'sec-fetch-site': 'cross-site' })),
  false,
);

check(
  'same-site (a sibling subdomain) is refused too',
  consoleOriginAllowed(viaGateway({ origin: GATEWAY, 'sec-fetch-site': 'same-site' })),
  false,
);

// Safari has historically omitted Origin on same-origin form POSTs, so the
// browser's own same-origin statement has to be enough on its own.
check(
  'no Origin, but the browser says same-origin, is allowed',
  consoleOriginAllowed(viaGateway({ 'sec-fetch-site': 'same-origin' })),
  true,
);

check(
  'no Origin and no Sec-Fetch-Site at all is refused',
  consoleOriginAllowed(viaGateway()),
  false,
);

// --- P2: unknown configuration refuses, it does not wave the request through -
delete process.env.GATEWAY_ORIGIN;

check('unset configuration reads as unknown', expectedConsoleOrigin(), null);

check(
  'P2 — a proxied request with no configured origin is refused',
  consoleOriginAllowed(viaGateway({ origin: GATEWAY })),
  false,
);

// --- direct local access keeps working without any configuration ------------
check(
  'loopback is allowed when reached directly',
  consoleOriginAllowed(direct({ origin: 'http://127.0.0.1:3000' })),
  true,
);

check(
  'localhost is allowed when reached directly',
  consoleOriginAllowed(direct({ origin: 'http://localhost:3000' })),
  true,
);

check(
  'a foreign origin is refused even on direct access',
  consoleOriginAllowed(direct({ origin: 'https://evil.example' })),
  false,
);

process.env.GATEWAY_ORIGIN = GATEWAY;

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nconsole origin gate: all checks passed.');
