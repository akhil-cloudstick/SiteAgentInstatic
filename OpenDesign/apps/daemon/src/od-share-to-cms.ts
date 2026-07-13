// Share to CMS — collect a project's shareable static site files.
//
// Walks a project's on-disk tree and returns the HTML/CSS/JS/image/font files as
// { "<relPath>": { base64, mimeType } }, the shape the Instatic
// /admin/api/cms/import/site-html endpoint expects. Dot-dirs (.file-versions,
// .od-skills) and non-site files (.md, .json, artifacts) are skipped.
import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';

const SITE_EXT: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export interface SiteFileEntry {
  base64: string;
  mimeType: string;
}

export async function collectSiteFiles(projectRoot: string): Promise<Record<string, SiteFileEntry>> {
  const out: Record<string, SiteFileEntry> = {};

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof fsp.readdir>>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip .file-versions, .od-skills, etc.
      const abs = nodePath.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, relPath);
        continue;
      }
      const mimeType = SITE_EXT[nodePath.extname(entry.name).toLowerCase()];
      if (!mimeType) continue; // skip .md / .json / .artifact.json / plan.md, etc.
      try {
        const bytes = await fsp.readFile(abs);
        out[relPath] = { base64: bytes.toString('base64'), mimeType };
      } catch {
        // unreadable file — skip rather than fail the whole push
      }
    }
  }

  await walk(projectRoot, '');
  return out;
}
