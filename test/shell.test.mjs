// The offline shell is the one part of a PWA that nothing in the browser-side check suite
// looks at: the app can pass every DOM assertion online and still be a blank page on the
// first offline open. So this suite reads the wiring instead of the behaviour — the module
// graph index.html actually pulls, the icons it declares, and what sw.js promises to cache.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, run, ok, eq } from '../tools/harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const posix = (rel) => rel.split(sep).join('/');

// `type="module"` means the browser resolves each import itself, one request per module:
// a graph node the worker never cached is a 404 the page can't recover from offline.
function graph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const m of read(rel).matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(posix(resolve(dirname(resolve(root, rel)), m[1]).slice(root.length + 1)));
    }
  }
  return [...seen].sort();
}

function shellUrls() {
  return new Set([...read('sw.js').matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]));
}

function declared(prefix) {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const hrefs = [...html.matchAll(/(?:href|src|content)="([^"]*?\.(?:png|css|js|webmanifest))"/g)].map((m) => m[1]);
  const icons = manifest.icons.map((i) => i.src);
  return [...new Set([...hrefs, ...icons])]
    .filter((u) => !/^https?:/.test(u))
    .map((u) => (u.startsWith('./') ? u : `./${u.replace(/^\.?\//, '')}`))
    .filter((u) => u.startsWith(`./${prefix}/`) || u === `./${prefix}`);
}

const MODULES = graph('js/main.js');

test('the entry module reaches every core file through import specifiers', () => {
  ok(MODULES.includes('js/main.js'), 'the entry is in its own graph');
  eq(MODULES.filter((m) => m.startsWith('js/core/')).length, 7, 'js/core is seven files in the browser');
  ok(!MODULES.includes('js/core/make.js'), 'the generator is build-time only: the browser never generates');
  ok(MODULES.includes('js/data/lots.js'), 'the shipped level pool is reachable from the shell');
});

test('sw.js precaches the whole module graph, not just the entry points', () => {
  const shell = shellUrls();
  const missing = MODULES.map((m) => `./${m}`).filter((u) => !shell.has(u));
  eq(missing, [], 'an uncached module is a 404 on the first offline open');
});

test('every icon and stylesheet the shell declares is declared in the cache too', () => {
  const shell = shellUrls();
  const wanted = [...declared('assets/img'), './css/game.css', './index.html', './manifest.webmanifest'];
  const missing = wanted.filter((u) => !shell.has(u));
  eq(missing, [], 'the install prompt and the tab icon are offline artefacts as well');
});

test('the shell promises nothing the repository does not have', () => {
  const ghosts = [...shellUrls()].filter((u) => u !== './' && !existsSync(resolve(root, u.slice(2))));
  eq(ghosts, [], 'a precache entry with no file behind it fails install-time add() silently');
});

test('the worker does not feed its own update into the cache', () => {
  const sw = read('sw.js');
  ok(!/['"]\.\/sw\.js['"]/.test(sw.split("addEventListener('fetch'")[1] || ''), 'the fetch handler must keep serving sw.js from the network');
  ok(/url\.pathname\.endsWith\('\/sw\.js'\)/.test(sw), 'the skip is explicit');
});

run();
