/**
 * Self-test for Operator branding (R5, AC-A5.2).
 * Run: `npm run test:brand` (from Operator/). No database needed.
 *
 * AC-A5.2: an Operator's project surfaces render the Operator's branding. The
 * rule underneath it, from the target architecture, is that branding flows down
 * EXACTLY one level — an Operator's branding replaces the platform's across
 * everything it owns, and a Business sitting directly under the Platform Owner
 * keeps the platform's. `resolveBrand` is that rule, so this file is the rule's
 * acceptance logic rather than a test of its plumbing.
 *
 * The intake checks matter for a different reason: a logo and a colour are
 * supplied by an Operator, and both end up inside a page we serve.
 */
import { resolveBrand, productName, cleanAccent, cleanBrandName, PLATFORM_BRAND } from './brand.mjs';
import { sniffImage, readArtwork } from './brandArtwork.mjs';

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
function throws(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => { failures++; console.error(`FAIL  ${name} (did not throw)`); })
    .catch(() => console.log(`ok    ${name}`));
}

// An Operator that has branded itself, and one that has not.
const branded = {
  id: 7,
  brand_name: 'BrightLeaf',
  brand_accent: '#2f6f4f',
  brand_version: 3,
  has_logo: true,
  has_logo_dark: false,
  has_icon: true,
};
const bare = { id: 8, brand_name: null, brand_accent: null, brand_version: 0, has_logo: false, has_logo_dark: false, has_icon: false };

// --- the one-level rule ---------------------------------------------------------
check('a project with no Operator wears the platform brand', resolveBrand(null), PLATFORM_BRAND);
check('a direct Business keeps MMSBUILD', resolveBrand(null).name, 'MMSBUILD');
check('an Operator that set nothing is the platform brand under another id',
  resolveBrand(bare).isPlatform, true);
check('an Operator that set something is not', resolveBrand(branded).isPlatform, false);
check('the Operator\'s name replaces the platform\'s', resolveBrand(branded).name, 'BrightLeaf');

// --- artwork addresses carry the version ---------------------------------------
//
// The version is what lets a rebrand reach a browser that cached the old mark:
// the addresses themselves are fixed, so without it the old logo would be shown
// until the cache happened to clear.
check('the logo address names the operator and the version',
  resolveBrand(branded).logoLight, '/brand/7/logo?v=3');
check('one uploaded logo serves both themes',
  resolveBrand(branded).logoDark, '/brand/7/logo?v=3');
check('a dark logo is used when there is one',
  resolveBrand({ ...branded, has_logo_dark: true }).logoDark, '/brand/7/logo-dark?v=3');
check('artwork that was never uploaded has no address', resolveBrand(bare).logoLight, null);

// --- product names -------------------------------------------------------------
check('the platform keeps its own product names',
  ['cms', 'design', 'console'].map((p) => productName(PLATFORM_BRAND, p)),
  ['MMS-CMS', 'MMS Design', 'MMS Operator']);
check('an Operator\'s customers see the Operator\'s name on the products',
  ['cms', 'design', 'console'].map((p) => productName(resolveBrand(branded), p)),
  ['BrightLeaf CMS', 'BrightLeaf Design', 'BrightLeaf Operator']);
check('an Operator that set no name keeps the platform\'s product names',
  productName(resolveBrand(bare), 'cms'), 'MMS-CMS');

// --- what an Operator is allowed to supply --------------------------------------
check('a colour is accepted and normalised', cleanAccent('#2F6F4F'), '#2f6f4f');
check('an empty colour clears it', cleanAccent(''), null);
throws('a colour that is not #rrggbb is refused', () => cleanAccent('red'));
throws('a colour carrying CSS is refused', () => cleanAccent('#fff;}html{display:none'));
check('a brand name is trimmed', cleanBrandName('  BrightLeaf  '), 'BrightLeaf');
check('an empty brand name means the platform\'s', cleanBrandName('   '), null);
throws('a brand name containing markup is refused', () => cleanBrandName('<script>x</script>'));
throws('a brand name containing a quote is refused', () => cleanBrandName('Bright"Leaf'));
throws('an over-long brand name is refused', () => cleanBrandName('x'.repeat(41)));

// --- artwork is judged by its bytes, never by its name or its content-type ------
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const html = Buffer.from('<svg onload=alert(1)></svg>                ', 'latin1');
check('a PNG is recognised', sniffImage(png), 'image/png');
check('a JPEG is recognised', sniffImage(jpeg), 'image/jpeg');
check('an SVG is not an image we accept — it can carry script', sniffImage(html), null);
check('nothing is not an image', sniffImage(Buffer.alloc(0)), null);

throws('a data URL that is not an image is refused',
  () => readArtwork(`data:image/png;base64,${html.toString('base64')}`));
throws('a plain http address is refused', () => readArtwork({ url: 'http://example.com/logo.png' }));
throws('an address on a private network is refused', () => readArtwork({ url: 'https://127.0.0.1/logo.png' }));
throws('an address on the tailnet is refused', () => readArtwork({ url: 'https://10.0.0.5/logo.png' }));
check('leaving a field out leaves the artwork alone', await readArtwork(undefined), undefined);
check('sending null clears it', await readArtwork(null), null);

// The throwing checks resolve on the microtask queue, so the verdict waits for them.
await new Promise((r) => setTimeout(r, 50));
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall brand checks passed');
process.exit(0);
