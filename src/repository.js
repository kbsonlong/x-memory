import { assertEntity, namespaceFor } from './schema.js';

export class MemoryStore {
  #data = new Map();

  async get(key) {
    return this.#data.has(key) ? structuredClone(this.#data.get(key)) : undefined;
  }

  async set(key, value) {
    this.#data.set(key, structuredClone(value));
  }

  async remove(key) {
    this.#data.delete(key);
  }
}

export class ChromeStorageStore {
  constructor(storage = globalThis.chrome?.storage?.local) {
    if (!storage) throw new Error('chrome.storage.local is unavailable');
    this.storage = storage;
  }

  async get(key) {
    const result = await this.storage.get(key);
    return result[key];
  }

  async set(key, value) {
    await this.storage.set({ [key]: value });
  }

  async remove(key) {
    await this.storage.remove(key);
  }
}

function storageKey(namespace) {
  return `xmemory.${namespace}`;
}

export class Repository {
  constructor(store) {
    if (!store) throw new TypeError('Repository requires a store');
    this.store = store;
    this.writes = new Map();
  }

  async put(entity) {
    assertEntity(entity);
    const namespace = namespaceFor(entity);
    const key = storageKey(namespace);
    const previousWrite = this.writes.get(key) ?? Promise.resolve();
    const write = previousWrite.catch(() => {}).then(() => this.putInNamespace(key, entity));
    this.writes.set(key, write);
    try {
      return await write;
    } finally {
      if (this.writes.get(key) === write) this.writes.delete(key);
    }
  }

  async putInNamespace(key, entity) {
    const current = (await this.store.get(key)) ?? {};
    const previous = current[entity.id];
    const next = mergeEntity(previous, entity);
    current[entity.id] = next;
    await this.store.set(key, current);
    return structuredClone(next);
  }

  async get(typeOrId, maybeId) {
    if (maybeId !== undefined) {
      const all = await this.list({ type: typeOrId });
      return all.find((entity) => entity.id === maybeId);
    }
    const id = String(typeOrId);
    for (const namespace of [
      'timeline.posts',
      'timeline.observations',
      'footprints.visit_events',
      'ai.artifacts',
      'sync.tombstones'
    ]) {
      const entities = (await this.store.get(storageKey(namespace))) ?? {};
      if (entities[id]) return structuredClone(entities[id]);
    }
    return undefined;
  }

  async list({ type, domain, postId, includeDeleted = false } = {}) {
    const namespaces = type ? [namespaceForType(type)] : [
      'timeline.posts',
      'timeline.observations',
      'footprints.visit_events',
      'ai.artifacts',
      'sync.tombstones'
    ];
    const result = [];
    for (const namespace of namespaces) {
      const entities = (await this.store.get(storageKey(namespace))) ?? {};
      for (const entity of Object.values(entities)) {
        if (domain && entity.domain !== domain) continue;
        if (postId && entity.subject?.postId !== String(postId)) continue;
        if (!includeDeleted && entity.deletedAt) continue;
        result.push(structuredClone(entity));
      }
    }
    return result.sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  }

  async delete(entityId, { domain = 'timeline', source = {} } = {}) {
    const { makeTombstone } = await import('./schema.js');
    return this.put(makeTombstone({ entityId, domain, source }));
  }

  async snapshot() {
    const result = {};
    for (const namespace of [
      'timeline.posts',
      'timeline.observations',
      'footprints.visit_events',
      'ai.artifacts',
      'sync.tombstones'
    ]) {
      result[namespace] = (await this.store.get(storageKey(namespace))) ?? {};
    }
    return result;
  }
}

function namespaceForType(type) {
  return {
    post: 'timeline.posts',
    timeline_observation: 'timeline.observations',
    visit_event: 'footprints.visit_events',
    ai_artifact: 'ai.artifacts',
    tombstone: 'sync.tombstones'
  }[type] ?? (() => { throw new TypeError(`unsupported entity type: ${type}`); })();
}

function mergeEntity(previous, next) {
  if (!previous) return structuredClone(next);
  if (previous.type !== next.type || previous.domain !== next.domain) {
    throw new Error(`entity identity collision: ${next.id}`);
  }
  return {
    ...previous,
    ...next,
    createdAt: previous.createdAt ?? next.createdAt,
    payload: mergePayload(previous.payload, next.payload),
    revision: Math.max(previous.revision ?? 1, next.revision ?? 1) + 1,
    updatedAt: next.updatedAt
  };
}

function mergePayload(previous = {}, next = {}) {
  const result = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== null && value !== '') result[key] = value;
  }
  return result;
}
