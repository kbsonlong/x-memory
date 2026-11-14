import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAiArtifact, makePost, makeTimelineObservation, makeVisitEvent } from '../src/schema.js';
import { MemoryStore, Repository } from '../src/repository.js';
import { QueryService } from '../src/query.js';
import { migrateLegacy, migrateRepository } from '../src/migration.js';
import { createAiOrchestrator, createOpenAiCompatibleProvider } from '../src/ai.js';
import { S3SnapshotTransport, SyncEngine } from '../src/sync.js';

function setup() {
  const repository = new Repository(new MemoryStore());
  return { repository, query: new QueryService(repository) };
}

test('repository keeps timeline and footprint namespaces separate', async () => {
  const { repository } = setup();
  await repository.put(makePost({ id: '123', payload: { text: 'hello' } }));
  await repository.put(makeVisitEvent({ id: 'device-a:123:1', postId: '123', payload: { visitedAt: '2026-11-14T00:00:00Z' } }));
  const snapshot = await repository.snapshot();
  assert.deepEqual(Object.keys(snapshot['timeline.posts']), ['post:123']);
  assert.deepEqual(Object.keys(snapshot['footprints.visit_events']), ['visit:device-a:123:1']);
  assert.equal(Object.keys(snapshot['timeline.posts']).length, 1);
  assert.equal(Object.keys(snapshot['footprints.visit_events']).length, 1);
});

test('concurrent writes preserve every post and observation', async () => {
  const { repository } = setup();
  await Promise.all(Array.from({ length: 50 }, (_, i) => Promise.all([
    repository.put(makePost({ id: String(i + 1) })),
    repository.put(makeTimelineObservation({ id: `page-${i}`, postId: String(i + 1) }))
  ])));
  assert.equal((await repository.list({ type: 'post' })).length, 50);
  assert.equal((await repository.list({ type: 'timeline_observation' })).length, 50);
});

test('search can return all entities when requested', async () => {
  const { repository, query } = setup();
  await Promise.all(Array.from({ length: 210 }, (_, i) => repository.put(makePost({ id: String(i + 1) }))));
  assert.equal((await query.search({ limit: null })).length, 210);
});

test('query joins a post with observations and visits by postId', async () => {
  const { repository, query } = setup();
  await repository.put(makePost({ id: '123', payload: { text: 'hello' } }));
  await repository.put(makeTimelineObservation({ id: 'page-1', postId: '123' }));
  await repository.put(makeVisitEvent({ id: 'device-a:123:1', postId: '123' }));
  const result = await query.getRelated({ postId: '123' });
  assert.equal(result.post.id, 'post:123');
  assert.equal(result.counts.observations, 1);
  assert.equal(result.counts.visits, 1);
});

test('feed groups timeline, visits, and AI summaries into one item per post', async () => {
  const { repository, query } = setup();
  await repository.put(makePost({ id: '123', payload: { text: 'hello' } }));
  await repository.put(makeTimelineObservation({ id: 'page-1', postId: '123' }));
  await repository.put(makeVisitEvent({ id: 'device-a:123:1', postId: '123' }));
  await repository.put(makeAiArtifact({ id: 'ai:summary:hash:model', payload: { postId: '123', task: 'summarize', text: '总结' } }));
  const feed = await query.getFeed();
  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, '123');
  assert.equal(feed[0].observations.length, 1);
  assert.equal(feed[0].visits.length, 1);
  assert.equal(feed[0].summaries.length, 1);
});

test('legacy migration is deterministic and skips invalid records', () => {
  const entities = migrateLegacy({
    items: [{ id: '123', text: 'one' }, { id: 'bad' }],
    records: [{ id: 'record-1', postId: '123', visitedAt: '2026-11-14T00:00:00Z' }],
    tombstones: [{ id: 'visit:old', domain: 'footprints' }]
  });
  assert.deepEqual(entities.map((entity) => entity.id), ['post:123', 'timeline:legacy:123:unknown', 'visit:legacy:record-1', 'tombstone:visit:old']);
});

test('repository migration is idempotent and preserves the old input contract', async () => {
  const { repository } = setup();
  const legacy = { items: [{ id: '123', text: 'hello' }], records: [{ id: 'r1', postId: '123' }] };
  const first = await migrateRepository(repository, legacy);
  const second = await migrateRepository(repository, legacy);
  assert.equal(first.written, 3);
  assert.equal(second.written, 0);
  assert.equal((await repository.list({ type: 'post' })).length, 1);
  assert.equal((await repository.list({ type: 'visit_event' })).length, 1);
});

test('AI excludes footprints unless explicitly authorized', async () => {
  const { repository, query } = setup();
  await repository.put(makePost({ id: '123', payload: { text: 'hello' } }));
  await repository.put(makeVisitEvent({ id: 'a', postId: '123' }));
  const ai = createAiOrchestrator({ query, provider: async ({ entities }) => entities.map((entity) => entity.id) });
  const result = await ai.run({ task: 'summarize', context: { entityRefs: ['post:123', 'visit:a'] } });
  assert.deepEqual(result.inputRefs, ['post:123']);
});

test('OpenAI-compatible provider sends bounded post text and returns the summary', async () => {
  let call;
  const provider = createOpenAiCompatibleProvider({ fetchImpl: async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ model: 'model-v1', choices: [{ message: { content: '帖子总结' } }] }) };
  } });
  const result = await provider({
    task: 'summarize',
    entities: [{ id: 'post:123', type: 'post', payload: { text: '原帖内容', authorName: '作者' } }],
    settings: { aiEndpoint: 'https://ai.example.test/v1/chat/completions', aiApiKey: 'secret', aiModel: 'custom-model' }
  });
  assert.equal(result.text, '帖子总结');
  assert.equal(result.model, 'model-v1');
  assert.equal(call.url, 'https://ai.example.test/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer secret');
  assert.match(call.options.body, /原帖内容/);
});

test('sync without transport preserves local-only state', async () => {
  const { repository } = setup();
  const sync = new SyncEngine({ repository });
  await repository.put(makePost({ id: '123' }));
  assert.deepEqual(sync.status(), { state: 'idle' });
  const result = await sync.sync();
  assert.equal(result.state, 'offline');
  assert.equal((await repository.list({ type: 'post' })).length, 1);
});

test('S3 snapshot sync signs requests and merges remote and local entities', async () => {
  const { repository } = setup();
  const remoteEntity = makePost({ id: '123', payload: { text: 'remote copy' }, at: '2026-01-01T00:00:00.000Z' });
  const localEntity = makeVisitEvent({ id: 'device-a:123:1', postId: '123', payload: { visitedAt: '2026-11-14T00:00:00Z' } });
  await repository.put(localEntity);
  let stored = { version: 1, entities: [remoteEntity] };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-key\//);
    assert.match(options.headers.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
    if (options.method === 'GET') return { status: 200, ok: true, json: async () => stored };
    stored = JSON.parse(options.body);
    return { status: 200, ok: true };
  };
  const transport = new S3SnapshotTransport({ endpoint: 'https://s3.example.test', bucket: 'memory', region: 'us-east-1', accessKeyId: 'test-key', secretAccessKey: 'test-secret', fetchImpl, cryptoImpl: globalThis.crypto });
  const sync = new SyncEngine({ repository, transport });
  const result = await sync.sync();
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/memory\/x-memory\/snapshot\.json$/);
  assert.equal(result.downloaded, 1);
  assert.equal(result.uploaded, 2);
  assert.deepEqual(new Set(stored.entities.map((entity) => entity.id)), new Set(['post:123', 'visit:device-a:123:1']));
  assert.equal((await repository.get('post:123')).payload.text, 'remote copy');
});
