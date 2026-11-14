import test from 'node:test';
import assert from 'node:assert/strict';
import { makePost, makeTimelineObservation, makeVisitEvent } from '../src/schema.js';
import { MemoryStore, Repository } from '../src/repository.js';
import { QueryService } from '../src/query.js';
import { migrateLegacy, migrateRepository } from '../src/migration.js';
import { createAiOrchestrator } from '../src/ai.js';
import { SyncEngine } from '../src/sync.js';

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

test('sync without transport preserves local-only state', async () => {
  const { repository } = setup();
  const sync = new SyncEngine({ repository });
  sync.enqueue(makePost({ id: '123' }));
  assert.deepEqual(sync.status(), { state: 'idle', queued: 1 });
  const result = await sync.flush();
  assert.equal(result.state, 'offline');
  assert.equal(result.flushed, 0);
});
