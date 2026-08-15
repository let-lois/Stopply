// Bakes the artifact build into one self-contained page.
//
// It has to work with no network at all: it gets opened as a link somewhere
// that cannot reach this repo or a CDN, so the JavaScript and the stylesheet
// are inlined rather than referenced.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'artifact-dist');

const template = readFileSync(join(root, 'preview/artifact.template.html'), 'utf8');
const css = readFileSync(join(dist, 'artifact.css'), 'utf8');
const js = readFileSync(join(dist, 'artifact.js'), 'utf8');

// Carried in text/plain blocks and read back with textContent, so the app's
// code is data to this page rather than script the browser parses twice. The
// only sequence that could end a block early is a literal closing script tag
// inside a string, so it is broken up.
const shield = (source) => source.replace(/<\/script/gi, '<\\/script');

const assets = [
  `<script type="text/plain" id="app-css">${shield(css)}</script>`,
  `<script type="text/plain" id="app-js">${shield(js)}</script>`,
].join('\n');

// A function replacer, not a string. Minified JavaScript is full of `$'` and
// `$&`, which String.replace reads as "insert the text after the match",
// quietly splicing the page into itself.
const html = template.replace('<!--APP_ASSETS-->', () => assets);
if (html === template) {
  console.error('artifact.template.html has no <!--APP_ASSETS--> placeholder.');
  process.exit(1);
}

const target = join(dist, 'prototypes.html');
writeFileSync(target, html);
const kb = (n) => `${Math.round(n / 1024)} kB`;
console.log(`Wrote ${target}`);
console.log(`  page ${kb(Buffer.byteLength(html))}, of which app ${kb(css.length + js.length)}`);
