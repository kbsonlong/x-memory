import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const paths = [
  manifest.background.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  manifest.action?.default_popup
].filter(Boolean);
for (const relative of paths) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`manifest path does not exist: ${relative}`);
}
if (manifest.manifest_version !== 3) throw new Error('MV3 is required');
if (manifest.background.type !== 'module') throw new Error('service worker must be a module');
console.log(`extension manifest ok (${paths.length} referenced files)`);
