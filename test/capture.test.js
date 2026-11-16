import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('refresh waits for the visible post to be saved and skips ads', async () => {
  const source = await readFile(new URL('../apps/extension/content.js', import.meta.url), 'utf8');
  let listener;
  let finishSave;
  const sent = [];
  const link = { href: 'https://x.com/example/status/123' };
  const time = { closest: (selector) => selector === 'a' ? link : null };
  const post = {
    querySelectorAll: (selector) => selector.includes(' time') ? [time] : [],
    querySelector: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    isConnected: true
  };
  const ad = { ...post, querySelectorAll: () => [] };
  const context = {
    URL, Map, Set, Date, Promise, innerHeight: 800,
    location: { href: 'https://x.com/home', pathname: '/home', hostname: 'x.com' },
    document: { documentElement: {}, querySelectorAll: () => [post, ad], querySelector: () => null },
    IntersectionObserver: class { observe() {} unobserve() {} },
    MutationObserver: class { observe() {} },
    setTimeout: () => 1,
    setInterval: () => 1,
    requestAnimationFrame: (fn) => fn(),
    chrome: { runtime: {
      id: 'test-extension-id',
      getManifest: () => ({}),
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: (message) => { sent.push(message); return new Promise((resolve) => { finishSave = resolve; }); }
    } }
  };
  vm.runInNewContext(source, context);
  let response;
  assert.equal(listener({ type: 'memory.capture.current' }, {}, (value) => { response = value; }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].post.id, '123');
  assert.equal(response, undefined);
  finishSave({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.ok, true);
});

test('automatically captures posts added to the home timeline, including an outer link container', async () => {
  const source = await readFile(new URL('../apps/extension/content.js', import.meta.url), 'utf8');
  let mutate;
  let intersection;
  const sent = [];
  const articles = [];
  const outer = {};
  const link = { href: 'https://x.com/example/status/456' };
  const time = { closest: (selector) => selector === 'a' ? link : outer };
  const post = {
    querySelectorAll: (selector) => selector.includes(' time') ? [time] : [],
    querySelector: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ top: 10, bottom: 100 }),
    isConnected: true
  };
  const context = {
    URL, Map, Set, Date, Promise, innerHeight: 800,
    location: { href: 'https://x.com/home', pathname: '/home', hostname: 'x.com' },
    document: { documentElement: {}, querySelectorAll: () => articles, querySelector: () => null },
    IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} unobserve() {} },
    MutationObserver: class { constructor(fn) { mutate = fn; } observe() {} },
    setTimeout: () => 1, setInterval: () => 1, requestAnimationFrame: (fn) => fn(),
    chrome: { runtime: { id: 'test-extension-id', getManifest: () => ({}), onMessage: { addListener() {} }, sendMessage: async (message) => { sent.push(message); return { ok: true }; } } }
  };
  vm.runInNewContext(source, context);
  articles.push(post);
  mutate();
  intersection([{ target: post, isIntersecting: true }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].post.id, '456');
});
