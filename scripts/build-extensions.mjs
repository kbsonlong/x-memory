import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(root, 'build');
const chromeStage = join(buildRoot, 'chrome-stage');
const safariStage = join(buildRoot, 'safari-stage');
const safariProjectRoot = join(buildRoot, 'safari-project');
const safariDerived = join(buildRoot, 'safari-derived');
const chromeZip = join(buildRoot, 'chrome', 'x-memory-chrome.zip');
const safariApp = join(buildRoot, 'safari', 'X-Memory.app');
const safariZip = join(buildRoot, 'safari', 'X-Memory-macos-safari.zip');

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function reset(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function stageExtension(destination) {
  reset(destination);
  cpSync(join(root, 'manifest.json'), join(destination, 'manifest.json'));
  mkdirSync(join(destination, 'apps', 'extension'), { recursive: true });
  for (const file of ['background.js', 'content.js']) {
    cpSync(join(root, 'apps', 'extension', file), join(destination, 'apps', 'extension', file));
  }
  cpSync(join(root, 'src'), join(destination, 'src'), { recursive: true });
}

function buildChrome() {
  stageExtension(chromeStage);
  reset(join(buildRoot, 'chrome'));
  run('zip', ['-q', '-r', chromeZip, 'manifest.json', 'apps', 'src'], { cwd: chromeStage });
  run('unzip', ['-tq', chromeZip]);
}

function buildSafari() {
  stageExtension(safariStage);
  reset(safariProjectRoot);
  run('xcrun', [
    'safari-web-extension-converter', safariStage,
    '--macos-only',
    '--project-location', safariProjectRoot,
    '--app-name', 'X Memory',
    '--bundle-identifier', 'com.kbsonlong.xmemory',
    '--swift',
    '--copy-resources',
    '--no-open',
    '--no-prompt'
  ]);

  const projectFile = join(safariProjectRoot, 'X Memory', 'X Memory.xcodeproj', 'project.pbxproj');
  const project = readFileSync(projectFile, 'utf8');
  writeFileSync(projectFile, project.replaceAll('com.kbsonlong.X-Memory', 'com.kbsonlong.xmemory'));

  reset(safariDerived);
  run('xcodebuild', [
    '-project', join(safariProjectRoot, 'X Memory', 'X Memory.xcodeproj'),
    '-scheme', 'X Memory',
    '-configuration', 'Release',
    '-derivedDataPath', safariDerived,
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ]);

  reset(join(buildRoot, 'safari'));
  const builtApp = join(safariDerived, 'Build', 'Products', 'Release', 'X Memory.app');
  if (!existsSync(builtApp)) throw new Error(`Safari app was not produced: ${builtApp}`);
  cpSync(builtApp, safariApp, { recursive: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', safariApp, safariZip]);
  run('unzip', ['-tq', safariZip]);
}

buildChrome();
buildSafari();
console.log(`Chrome artifact: ${chromeZip}`);
console.log(`Safari artifact: ${safariApp}`);
console.log(`Safari archive: ${safariZip}`);
console.log('Build completed without code signing.');
