// Share to CMS — collect a project's shareable static site files.
//
// Walks a project's on-disk tree and returns the HTML/CSS/JS/image/font files as
// { "<webPath>": { base64, mimeType } }, the shape the Instatic
// /admin/api/cms/import/site-html endpoint expects. Dot-dirs (.file-versions,
// .od-skills) and non-site files (.md, .json, artifacts) are skipped.
//
// Keys are WEB-ROOT paths, not on-disk paths: the project's `public/` directory
// IS the published web root (an `<img src="/images/hero.svg">` resolves to
// `public/images/hero.svg` on disk), so the `public/` prefix is stripped here.
// This makes the FileMap mirror a built static-site root exactly — the same
// shape Instatic's manual "Import Site" wizard consumes — so a template-compliant
// web-root reference (`/images/x`) resolves to its file (`images/x`). Without
// this, the importer looks up `images/x` and misses the `public/images/x` key,
// and the image never uploads.
import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { isIgnoredProjectDirName } from './project-ignored-dirs.js';

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
        // Skip generated/build/dep trees (dist, build, node_modules, .cache, …)
        // so a project with an Astro/bundler build output doesn't emit
        // byte-different variant copies of the same source images alongside
        // the originals — mirrors the archive helper (projects.ts).
        if (isIgnoredProjectDirName(entry.name)) continue;
        await walk(abs, relPath);
        continue;
      }
      const mimeType = SITE_EXT[nodePath.extname(entry.name).toLowerCase()];
      if (!mimeType) continue; // skip .md / .json / .artifact.json / plan.md, etc.
      // Map the on-disk path to its published web-root path: `public/` is the
      // web root, so its contents live at the root (`public/images/x` → `images/x`).
      // A same-named root file wins over a public/ duplicate (first write kept).
      const webPath = relPath.startsWith('public/') ? relPath.slice('public/'.length) : relPath;
      if (out[webPath]) continue;
      try {
        const bytes = await fsp.readFile(abs);
        out[webPath] = { base64: bytes.toString('base64'), mimeType };
      } catch {
        // unreadable file — skip rather than fail the whole push
      }
    }
  }

  await walk(projectRoot, '');
  return out;
}
