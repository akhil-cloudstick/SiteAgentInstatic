// Taking in an Operator's artwork — by upload, or by a pasted address (R5).
//
// Both ways were asked for, and both end in the same place: the bytes are
// stored here. A pasted address is therefore an INPUT method, fetched once
// when it is saved, never a live reference in the page. Two reasons, and both
// are about the agency's own customers:
//
//   · a live third-party address shows that server every visitor's IP and
//     which page they were on — the agency's customer list, leaked one
//     request at a time;
//   · and when that server has a bad day, the header breaks here.
//
// The type is decided by the FIRST BYTES, never by the file name or the
// server's content-type: those are claims made by whoever supplied the file.
// SVG is refused outright. An SVG is a document that can carry script, and
// this one would be served from the origin that holds the session cookie.

const MAX_BYTES = 512 * 1024;

const status = (message, code = 400) => Object.assign(new Error(message), { status: code });

const starts = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

/** The real type of these bytes, or null when they are not an image we accept. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (starts(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  return null;
}

function accept(bytes) {
  if (!bytes.length) throw status('That file is empty');
  if (bytes.length > MAX_BYTES) throw status(`Artwork must be under ${Math.round(MAX_BYTES / 1024)} KB`);
  const mime = sniffImage(bytes);
  if (!mime) throw status('Use a PNG, JPEG, WebP or GIF image');
  return { bytes, mime };
}

/** A data: URL from the console's file picker. */
function fromDataUrl(value) {
  const m = /^data:([a-z0-9/+.-]+)?;base64,([\s\S]+)$/i.exec(String(value).trim());
  if (!m) throw status('That upload did not arrive as an image');
  return accept(Buffer.from(m[2], 'base64'));
}

/**
 * Fetch a pasted address, once. `https` only, no redirects followed, and a
 * short deadline: this runs on a machine that can reach the tailnet and the
 * database, so an address supplied by a user must never become a way to make
 * requests from here to somewhere it chooses.
 */
async function fromUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw status('That is not a web address');
  }
  if (url.protocol !== 'https:') throw status('The address must start with https://');
  if (/^(localhost|\[?::1\]?|0\.0\.0\.0)$/i.test(url.hostname) || /^(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(url.hostname)) {
    throw status('That address is on a private network');
  }
  const stop = AbortSignal.timeout(8000);
  const res = await fetch(url, { redirect: 'error', signal: stop }).catch((e) => {
    throw status(`Could not fetch that image (${e.message})`);
  });
  if (!res.ok) throw status(`That address answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return accept(buf);
}

/**
 * One artwork from whatever the console sent:
 *   undefined -> leave it alone
 *   null / '' -> clear it, back to the platform's
 *   {upload}  -> a data: URL
 *   {url}     -> fetched once, now
 */
export async function readArtwork(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string') {
    return value.startsWith('data:') ? fromDataUrl(value) : fromUrl(value);
  }
  if (value.upload) return fromDataUrl(value.upload);
  if (value.url) return fromUrl(value.url);
  throw status('Send an uploaded image or an https address');
}
