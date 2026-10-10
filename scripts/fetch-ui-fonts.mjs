// Downloads the UI fonts (Clash Display, Satoshi) from Fontshare into public/fonts/ui/.
// The Fontshare license permits self-hosting on your own site but not redistribution
// through a repository, so the font files are gitignored and fetched here instead.
// Usage: node scripts/fetch-ui-fonts.mjs   (runs automatically on npm install)

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = [
  { slug: 'clash-display', dir: 'clash-display', file: 'ClashDisplay-Variable.woff2' },
  { slug: 'satoshi', dir: 'satoshi', file: 'Satoshi-Variable.woff2' },
];

let failed = false;
for (const font of FONTS) {
  const destDir = join(root, 'public', 'fonts', 'ui', font.dir);
  const dest = join(destDir, font.file);
  if (existsSync(dest)) {
    console.log(`fonts: ${font.file} already present`);
    continue;
  }
  try {
    const url = `https://api.fontshare.com/v2/fonts/download/${font.slug}`;
    console.log(`fonts: downloading ${font.slug} from Fontshare`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const work = join(tmpdir(), `fontshare-${font.slug}-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    const zip = join(work, 'font.zip');
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-q', '-o', zip, '-d', work]);

    const found = findFile(work, (n) => n === font.file);
    if (!found) throw new Error(`${font.file} not found in the Fontshare zip`);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(found, dest);
    const license = findFile(work, (n) => /^(FFL|LICENSE|License)[^/]*\.txt$/i.test(n));
    if (license) copyFileSync(license, join(destDir, 'FFL.txt'));
    rmSync(work, { recursive: true, force: true });
    console.log(`fonts: installed ${font.file}`);
  } catch (err) {
    failed = true;
    console.warn(`fonts: could not fetch ${font.slug}: ${err instanceof Error ? err.message : err}`);
    console.warn('fonts: the app falls back to system fonts until this succeeds. Re-run: npm run fonts:ui');
  }
}
process.exit(failed && process.env.CI ? 1 : 0);

function findFile(dir, match) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = findFile(p, match);
      if (r) return r;
    } else if (match(entry.name)) {
      return p;
    }
  }
  return null;
}
