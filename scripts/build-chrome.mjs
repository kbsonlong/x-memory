// Build a Chrome/Edge-compatible MV3 package without Xcode or code signing.
// Outputs:
//   build/chrome/unpacked/            -> load directly via chrome://extensions > Load unpacked
//   build/chrome/x-memory-chrome.zip  -> upload to Chrome Web Store / Edge Add-ons
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'chrome');
const unpacked = join(outDir, 'unpacked');
const zipPath = join(outDir, 'x-memory-chrome.zip');

function reset(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

// Stage: manifest + extension pages + icons + shared src modules
reset(unpacked);
cpSync(join(root, 'manifest.json'), join(unpacked, 'manifest.json'));
mkdirSync(join(unpacked, 'apps', 'extension'), { recursive: true });
for (const file of ['background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css']) {
  cpSync(join(root, 'apps', 'extension', file), join(unpacked, 'apps', 'extension', file));
}
cpSync(join(root, 'apps', 'extension', 'icons'), join(unpacked, 'apps', 'extension', 'icons'), { recursive: true });
cpSync(join(root, 'src'), join(unpacked, 'src'), { recursive: true });

// Zip (manifest.json must sit at archive root)
const zip = spawnSync('zip', ['-q', '-r', zipPath, 'manifest.json', 'apps', 'src'], { cwd: unpacked });
if (zip.status !== 0) throw new Error(`zip failed: ${zip.stderr?.toString() || zip.status}`);
const test = spawnSync('unzip', ['-tq', zipPath]);
if (test.status !== 0) throw new Error(`zip integrity check failed`);

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
console.log(`Chrome/Edge package v${manifest.version} ready (no code signing).`);
console.log(`  Unpacked directory : ${unpacked}`);
console.log(`  Store upload ZIP   : ${zipPath}`);
