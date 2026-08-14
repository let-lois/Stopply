// Bakes the preview build into one self contained HTML page.
//
// The page has to work with no network at all: it gets shared as a link and
// opened somewhere that cannot reach a CDN, a font host or this repo. So the
// app's JavaScript and stylesheet are inlined rather than referenced.
//
//   pnpm --filter @letlois/all-star-field-app preview
//
// Output: preview-dist/all-star-field-preview.html

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'preview-dist');

const template = readFileSync(join(root, 'preview/artifact.template.html'), 'utf8');
const css = readFileSync(join(dist, 'preview.css'), 'utf8');
const js = readFileSync(join(dist, 'preview.js'), 'utf8');

// Carried in text/plain blocks and read back with textContent, so the app's
// code is data to this page rather than script the browser parses twice. The
// only sequence that could end a block early is a literal closing script tag
// inside a string, so it is broken up.
const shield = (source) => source.replace(/<\/script/gi, '<\\/script');

const assets = [
  `<script type="text/plain" id="app-css">${shield(css)}</script>`,
  `<script type="text/plain" id="app-js">${shield(js)}</script>`,
].join('\n');

// A function replacer, not a string. Minified JavaScript is full of `$'`
// and `$&`, which String.replace reads as "insert the text after the match"
// and "insert the match", quietly splicing the page into itself. The bundle
// is data here and must be inserted verbatim.
const html = template.replace('<!--APP_ASSETS-->', () => assets);
if (html === template) {
  console.error('artifact.template.html has no <!--APP_ASSETS--> placeholder to fill.');
  process.exit(1);
}

const target = join(dist, 'all-star-field-preview.html');
writeFileSync(target, html);

const kb = (n) => `${Math.round(n / 1024)} kB`;
console.log(`Wrote ${target}`);
console.log(`  page ${kb(Buffer.byteLength(html))}, of which app ${kb(css.length + js.length)}`);
