import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const safariOut = join(buildRoot, 'safari');
const safariApp = join(safariOut, 'X-Memory.app');
const safariMacZip = join(safariOut, 'X-Memory-macos-safari.zip');
const safariProjectZip = join(safariOut, 'X-Memory-xcode-project.zip');
const safariIosSimApp = join(safariOut, 'ios-simulator', 'X Memory.app');
const safariIosZip = join(safariOut, 'X-Memory-ios-simulator.zip');

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
  return result.stdout ?? '';
}

function reset(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function stageExtension(destination) {
  reset(destination);
  cpSync(join(root, 'manifest.json'), join(destination, 'manifest.json'));
  mkdirSync(join(destination, 'apps', 'extension'), { recursive: true });
  for (const file of ['background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css']) {
    cpSync(join(root, 'apps', 'extension', file), join(destination, 'apps', 'extension', file));
  }
  cpSync(join(root, 'apps', 'extension', 'icons'), join(destination, 'apps', 'extension', 'icons'), { recursive: true });
  cpSync(join(root, 'src'), join(destination, 'src'), { recursive: true });
}

function buildChrome() {
  stageExtension(chromeStage);
  reset(join(buildRoot, 'chrome'));
  run('zip', ['-q', '-r', chromeZip, 'manifest.json', 'apps', 'src'], { cwd: chromeStage });
  run('unzip', ['-tq', chromeZip]);
}

// List schemes of the generated Xcode project so platform schemes are resolved
// from the tool's actual output instead of assumed names.
function listSchemes(projectPath) {
  const result = spawnSync('xcodebuild', ['-project', projectPath, '-list'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(`xcodebuild -list failed: ${result.stderr}`);
  const schemesIndex = result.stdout.indexOf('Schemes:');
  if (schemesIndex === -1) throw new Error('cannot find schemes in xcodebuild -list output');
  return result.stdout
    .slice(schemesIndex + 'Schemes:'.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSafari() {
  stageExtension(safariStage);
  reset(safariProjectRoot);
  // No --macos-only / --ios-only: generate a project with BOTH iOS and macOS
  // Safari Web Extension targets.
  run('xcrun', [
    'safari-web-extension-converter', safariStage,
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

  const schemes = listSchemes(join(safariProjectRoot, 'X Memory', 'X Memory.xcodeproj'));
  const macScheme = schemes.find((s) => s.includes('macOS')) ?? schemes[0];
  const iosScheme = schemes.find((s) => s !== macScheme) ?? schemes[0];
  console.log(`Xcode schemes detected -> macOS: "${macScheme}", iOS: "${iosScheme}"`);

  reset(safariDerived);

  // macOS build (unsigned, compile verification only)
  run('xcodebuild', [
    '-project', join(safariProjectRoot, 'X Memory', 'X Memory.xcodeproj'),
    '-scheme', macScheme,
    '-configuration', 'Release',
    '-destination', 'generic/platform=macOS',
    '-derivedDataPath', safariDerived,
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ]);

  // iOS build (simulator destination, no signing required)
  run('xcodebuild', [
    '-project', join(safariProjectRoot, 'X Memory', 'X Memory.xcodeproj'),
    '-scheme', iosScheme,
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', safariDerived,
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ]);

  reset(safariOut);
  mkdirSync(join(safariOut, 'ios-simulator'), { recursive: true });

  // macOS app artifact
  const builtMacApp = join(safariDerived, 'Build', 'Products', 'Release', 'X Memory.app');
  if (!existsSync(builtMacApp)) throw new Error(`macOS Safari app was not produced: ${builtMacApp}`);
  cpSync(builtMacApp, safariApp, { recursive: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', safariApp, safariMacZip]);

  // iOS simulator app artifact
  const builtIosApp = join(safariDerived, 'Build', 'Products', 'Release-iphonesimulator', 'X Memory.app');
  if (!existsSync(builtIosApp)) throw new Error(`iOS Safari app was not produced: ${builtIosApp}`);
  cpSync(builtIosApp, safariIosSimApp, { recursive: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', safariIosSimApp, safariIosZip]);

  // Ship the dual-platform Xcode project so users can run on a real iPhone
  // with a free personal signing identity.
  const projectDir = join(safariProjectRoot, 'X Memory');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', projectDir, safariProjectZip]);

  run('unzip', ['-tq', safariMacZip]);
  run('unzip', ['-tq', safariIosZip]);
  run('unzip', ['-tq', safariProjectZip]);
}

buildChrome();
buildSafari();
console.log(`Chrome artifact: ${chromeZip}`);
console.log(`Safari macOS app: ${safariApp}`);
console.log(`Safari macOS archive: ${safariMacZip}`);
console.log(`Safari iOS simulator app: ${safariIosSimApp}`);
console.log(`Safari iOS simulator archive: ${safariIosZip}`);
console.log(`Safari Xcode project archive (iOS + macOS): ${safariProjectZip}`);
console.log('Build completed without code signing.');
