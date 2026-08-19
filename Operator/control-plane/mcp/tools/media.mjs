// Media tools. These route to the tenant's admin HTTP API rather than the
// plugin, because the plugin sandbox has no media API at all — it can only
// register storage adapters / URL transformers, never upload bytes — and it
// cannot call the CMS's own API to compensate (outbound fetch SSRF-blocks
// loopback and private IPs).
//
// Uploads accept base64 rather than a URL by default: an agent handing us a
// URL would turn the gateway into a fetch-anything proxy on the operator's
// network. `sourceUrl` is supported but restricted to https and rejected for
// private/loopback hosts.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tenantFetch, tenantJson } from '../session.mjs';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // matches the CMS ceiling

const str = (description) => ({ type: 'string', description });

function privateAddress(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function fetchRemoteFile(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('`sourceUrl` is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('`sourceUrl` must be https');

  // Resolve first and check every address: a hostname that resolves into the
  // operator's private network is the SSRF case we are refusing.
  const resolved = await dnsLookup(url.hostname, { all: true }).catch(() => []);
  if (!resolved.length) throw new Error(`Could not resolve "${url.hostname}"`);
  for (const { address } of resolved) {
    if (privateAddress(address)) throw new Error('`sourceUrl` resolves to a private address');
  }

  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) throw new Error(`Fetching \`sourceUrl\` failed with HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('Remote file exceeds the 50MB limit');
  return { buffer, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

async function uploadBytes(slug, { filename, buffer, contentType, dedupe }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  if (dedupe) form.append('dedupe', '1');
  const res = await tenantFetch(slug, '/cms/api/cms/media', { method: 'POST', body: form });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* fall through to the raw text below */
  }
  if (!res.ok) throw new Error((parsed && parsed.error) || text.slice(0, 300) || `HTTP ${res.status}`);
  return parsed;
}

export const mediaTools = [
  {
    name: 'media_list',
    permission: 'media.read',
    description:
      'List media assets in the library. `query` filters by filename/alt text, `trash` lists soft-deleted ' +
      'assets instead. Use this to find an existing image before uploading a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Optional text filter.'),
        trash: { type: 'boolean', description: 'List trashed assets instead of live ones.' },
        limit: { type: 'integer', description: 'Max assets to return.' },
      },
      additionalProperties: false,
    },
    run: (ctx, a) => {
      const params = new URLSearchParams();
      if (a.query) params.set('query', a.query);
      if (a.trash) params.set('trash', '1');
      if (a.limit) params.set('limit', String(a.limit));
      const qs = params.toString();
      return tenantJson(ctx.slug, `/cms/api/cms/media${qs ? `?${qs}` : ''}`);
    },
  },
  {
    name: 'media_upload',
    permission: 'media.write',
    description:
      'Upload a file to the media library. Provide EITHER `base64` (the file bytes, base64-encoded) or ' +
      '`sourceUrl` (an https URL to fetch from — private/internal addresses are refused). Returns the ' +
      'created asset, whose path you can then set on an image node via cms_mutate_tree. Max 50MB.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: str('Filename including extension, e.g. "hero.jpg".'),
        base64: str('File bytes, base64-encoded. Use this or sourceUrl.'),
        sourceUrl: str('Public https URL to fetch the file from. Use this or base64.'),
        contentType: str('MIME type, e.g. "image/jpeg". Optional when using sourceUrl.'),
        dedupe: { type: 'boolean', description: 'Reuse an existing asset with identical content.' },
      },
      required: ['filename'],
      additionalProperties: false,
    },
    run: async (ctx, a) => {
      if (!a.base64 && !a.sourceUrl) throw new Error('Provide either `base64` or `sourceUrl`');
      if (a.base64 && a.sourceUrl) throw new Error('Provide only one of `base64` or `sourceUrl`');

      let buffer;
      let contentType = a.contentType || 'application/octet-stream';
      if (a.base64) {
        buffer = Buffer.from(a.base64, 'base64');
        if (!buffer.byteLength) throw new Error('`base64` decoded to zero bytes');
        if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 50MB limit');
      } else {
        const remote = await fetchRemoteFile(a.sourceUrl);
        buffer = remote.buffer;
        if (!a.contentType) contentType = remote.contentType;
      }
      return await uploadBytes(ctx.slug, { filename: a.filename, buffer, contentType, dedupe: a.dedupe });
    },
  },
  {
    name: 'media_update_metadata',
    permission: 'media.write',
    description:
      'Update an asset\'s filename, alt text, caption, title or tags. Setting good alt text on images is ' +
      'the usual reason to call this.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: str('Media asset id.'),
        filename: str('New filename.'),
        altText: str('Alternative text for accessibility.'),
        caption: str('Caption.'),
        title: str('Title.'),
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
      },
      required: ['assetId'],
      additionalProperties: false,
    },
    run: (ctx, a) => {
      const patch = {};
      for (const key of ['filename', 'altText', 'caption', 'title', 'tags']) {
        if (a[key] !== undefined) patch[key] = a[key];
      }
      if (Object.keys(patch).length === 0) throw new Error('Supply at least one field to update');
      return tenantJson(ctx.slug, `/cms/api/cms/media/${encodeURIComponent(a.assetId)}`, {
        method: 'PATCH',
        body: patch,
      });
    },
  },
  {
    name: 'media_set_folders',
    permission: 'media.write',
    description: 'Organise an asset by adding it to or removing it from media folders.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: str('Media asset id.'),
        add: { type: 'array', items: { type: 'string' }, description: 'Folder ids to add.' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Folder ids to remove.' },
      },
      required: ['assetId'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      tenantJson(ctx.slug, `/cms/api/cms/media/${encodeURIComponent(a.assetId)}/folders`, {
        method: 'POST',
        body: { add: a.add || [], remove: a.remove || [] },
      }),
  },
  {
    name: 'media_replace',
    permission: 'media.write',
    description:
      'Replace an existing asset\'s bytes while keeping its id, so every page already using it picks up the ' +
      'new file. Higher blast radius than uploading a new asset — it changes every place the image appears.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: str('Media asset id to replace.'),
        filename: str('Filename including extension.'),
        base64: str('Replacement bytes, base64-encoded.'),
        contentType: str('MIME type of the replacement.'),
      },
      required: ['assetId', 'filename', 'base64'],
      additionalProperties: false,
    },
    run: async (ctx, a) => {
      const buffer = Buffer.from(a.base64, 'base64');
      if (!buffer.byteLength) throw new Error('`base64` decoded to zero bytes');
      if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 50MB limit');
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: a.contentType || 'application/octet-stream' }), a.filename);
      const res = await tenantFetch(ctx.slug, `/cms/api/cms/media/${encodeURIComponent(a.assetId)}/replace`, {
        method: 'POST',
        body: form,
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        /* fall through */
      }
      if (!res.ok) throw new Error((parsed && parsed.error) || text.slice(0, 300) || `HTTP ${res.status}`);
      return parsed;
    },
  },
  {
    name: 'media_delete',
    permission: 'media.delete',
    description:
      'Soft-delete an asset — it moves to the media Trash and can be restored with media_restore. ' +
      'Permanent purge is deliberately not exposed to agents.',
    inputSchema: {
      type: 'object',
      properties: { assetId: str('Media asset id.') },
      required: ['assetId'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      tenantJson(ctx.slug, `/cms/api/cms/media/${encodeURIComponent(a.assetId)}`, { method: 'DELETE' }),
  },
  {
    name: 'media_restore',
    permission: 'media.write',
    description: 'Restore a soft-deleted asset from the media Trash.',
    inputSchema: {
      type: 'object',
      properties: { assetId: str('Media asset id.') },
      required: ['assetId'],
      additionalProperties: false,
    },
    run: (ctx, a) =>
      tenantJson(ctx.slug, `/cms/api/cms/media/${encodeURIComponent(a.assetId)}/restore`, { method: 'POST' }),
  },
];
