import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../apps/extension/content.js', import.meta.url), 'utf8');

function detailPageContext(pathname = '/evanlong_me/status/1234567890') {
  const sent = [];
  let mutate;
  const article = { querySelector: () => null, querySelectorAll: () => [], innerText: '' };
  const context = {
    URL, Map, Set, Date, Promise, JSON, Math, String, Number, Boolean, Object, Array, Error, RegExp, console,
    innerHeight: 800,
    location: { href: `https://x.com${pathname}`, pathname, hostname: 'x.com' },
    document: {
      documentElement: {},
      querySelectorAll: () => [],
      querySelector: (selector) => selector === 'article[data-testid="tweet"]' ? article : null
    },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(fn) { mutate = fn; } observe() {} disconnect() {} },
    setTimeout: (fn) => { fn(); return 1; },
    setInterval: () => 1,
    clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: (fn) => fn(),
    chrome: { runtime: {
      id: 'test-extension-id',
      getManifest: () => ({}),
      onMessage: { addListener() {} },
      sendMessage: (message) => { sent.push(message); return Promise.resolve({ ok: true }); }
    } }
  };
  vm.runInNewContext(source, context);
  return {
    sent,
    mutate: () => mutate && mutate(),
    visits: () => sent.filter((message) => message.type === 'footprints.upsert')
  };
}

test('detail visit gets a unique id and keeps the numeric postId', () => {
  const first = detailPageContext();
  const second = detailPageContext();
  const a = first.visits();
  const b = second.visits();
  assert.equal(a.length, 1, 'a detail page should emit exactly one visit on load');
  assert.equal(a[0].visit.postId, '1234567890');
  assert.notEqual(a[0].visit.id, '1234567890', 'visit id must not be overwritten by post.id from spread');
  assert.notEqual(a[0].visit.id, b[0].visit.id, 'separate page loads must produce distinct visit ids');
});

test('repeated DOM mutations on the same detail page do not duplicate the visit', () => {
  const page = detailPageContext();
  assert.equal(page.visits().length, 1);
  page.mutate();
  page.mutate();
  page.mutate();
  assert.equal(page.visits().length, 1, 'same page + same post must be recorded once');
});
