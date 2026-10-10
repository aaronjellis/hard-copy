// Downloads the bundled fonts into public/fonts/<id>/ as the unmodified static TTF files that the
// Google Fonts Developer API serves, plus each family's OFL.txt from the google/fonts repository.
// The files are saved byte for byte; nothing here instances, subsets, or re-saves a font.
//
// Usage: node scripts/fetch-bundled-fonts.mjs [--force]
//   Skips files that already exist. --force deletes each family's .ttf files and OFL.txt first,
//   then downloads them again.
// Needs VITE_GOOGLE_FONTS_API_KEY in .env. The key is referrer-restricted, so requests send
// a localhost Referer that the key allows.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(root, 'public', 'fonts');
const force = process.argv.includes('--force');
const REFERER = 'http://localhost:5174/';
const MIN_BYTES = 50 * 1024;

// id, Google Fonts family, file stem (matches src/lib/fonts/catalog.ts), google/fonts ofl/ folder
// Families listed in REPO_STATIC are fetched as the unmodified static files from the google/fonts
// repository instead of the API, because the API serves an older build with far less coverage.
const REPO_STATIC = new Set(['lato']);
const FAMILIES = [
  ['noto-sans', 'Noto Sans', 'NotoSans', 'notosans'],
  ['noto-serif', 'Noto Serif', 'NotoSerif', 'notoserif'],
  ['open-sans', 'Open Sans', 'OpenSans', 'opensans'],
  ['lato', 'Lato', 'Lato', 'lato'],
  ['roboto', 'Roboto', 'Roboto', 'roboto'],
  ['source-sans-3', 'Source Sans 3', 'SourceSans3', 'sourcesans3'],
  ['merriweather', 'Merriweather', 'Merriweather', 'merriweather'],
  ['lora', 'Lora', 'Lora', 'lora'],
];

// API variant key -> file name suffix
const FACES = [
  ['regular', 'Regular'],
  ['700', 'Bold'],
  ['italic', 'Italic'],
  ['700italic', 'BoldItalic'],
];

const key = readApiKey();
const rows = [];
const missing = [];
let failed = false;

for (const [id, family, stem, oflDir] of FAMILIES) {
  const dir = join(fontsDir, id);
  mkdirSync(dir, { recursive: true });
  if (force) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ttf') || name === 'OFL.txt') rmSync(join(dir, name));
    }
  }
  try {
    const files = await fetchFamilyFiles(family);
    for (const [variant, suffix] of FACES) {
      const name = `${stem}-${suffix}.ttf`;
      const dest = join(dir, name);
      const url = files[variant];
      if (!url) {
        missing.push(`${family} ${suffix}`);
        rows.push([id, name, '-', 'missing from API']);
        continue;
      }
      if (existsSync(dest)) {
        rows.push([id, name, statSync(dest).size, 'present']);
        continue;
      }
      const src = REPO_STATIC.has(id)
        ? `https://raw.githubusercontent.com/google/fonts/main/ofl/${oflDir}/${name}`
        : url.replace(/^http:/, 'https:');
      const bytes = await download(src);
      checkFont(bytes, src);
      writeFileSync(dest, bytes);
      rows.push([id, name, bytes.length, 'downloaded']);
    }
    const license = join(dir, 'OFL.txt');
    if (existsSync(license)) {
      rows.push([id, 'OFL.txt', statSync(license).size, 'present']);
    } else {
      const text = await download(`https://raw.githubusercontent.com/google/fonts/main/ofl/${oflDir}/OFL.txt`);
      if (!/SIL OPEN FONT LICENSE/i.test(text.toString('utf8'))) throw new Error(`${oflDir}/OFL.txt is not an OFL`);
      writeFileSync(license, text);
      rows.push([id, 'OFL.txt', text.length, 'downloaded']);
    }
  } catch (err) {
    failed = true;
    rows.push([id, '-', '-', `error: ${err instanceof Error ? err.message : err}`]);
  }
}

printTable(['id', 'file', 'bytes', 'status'], rows);
if (missing.length) console.log(`\nFaces the API does not serve: ${missing.join(', ')}`);
process.exit(failed ? 1 : 0);

function readApiKey() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) fail('.env not found; set VITE_GOOGLE_FONTS_API_KEY there');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?VITE_GOOGLE_FONTS_API_KEY\s*=\s*(.*)$/);
    if (m) {
      const value = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value) return value;
    }
  }
  fail('VITE_GOOGLE_FONTS_API_KEY is empty or missing in .env');
}

async function fetchFamilyFiles(family) {
  const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key)}&family=${encodeURIComponent(family)}`;
  const res = await fetch(url, { headers: { Referer: REFERER } });
  // Never echo the request URL: it carries the key.
  if (!res.ok) throw new Error(`Google Fonts API returned HTTP ${res.status} for ${family}`);
  const body = await res.json();
  const item = body.items?.find((i) => i.family === family);
  if (!item) throw new Error(`Google Fonts API has no family named ${family}`);
  return item.files ?? {};
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function checkFont(bytes, url) {
  const magic = bytes.subarray(0, 4).toString('latin1');
  const sfnt = bytes.readUInt32BE(0) === 0x00010000 || magic === 'true' || magic === 'OTTO';
  if (!sfnt) throw new Error(`${url} is not an sfnt font`);
  if (bytes.length <= MIN_BYTES) throw new Error(`${url} is only ${bytes.length} bytes`);
}

function printTable(head, body) {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of body) console.log(line(r));
}

function fail(message) {
  console.error(`fonts: ${message}`);
  process.exit(1);
}
