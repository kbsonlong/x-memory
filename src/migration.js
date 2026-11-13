import { legacyVisitId, makePost, makeTimelineObservation, makeTombstone, makeVisitEvent } from './schema.js';

export function migrateLegacy({ items = [], records = [], tombstones = [], deviceId = 'legacy' } = {}) {
  const entities = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rawId = item?.id ?? item?.postId;
    if (!/^\d+$/.test(String(rawId ?? ''))) continue;
    const observedAt = item.capturedAt ?? item.createdAt ?? item.seenAt;
    entities.push(makePost({
      id: String(rawId),
      observedAt,
      source: { adapter: 'migration.rewind', deviceId, url: item.url },
      payload: item
    }));
    entities.push(makeTimelineObservation({
      id: `legacy:${String(rawId)}:${observedAt ?? 'unknown'}`,
      postId: String(rawId),
      observedAt,
      source: { adapter: 'migration.rewind', deviceId, url: item.url },
      payload: { capturedFrom: 'items' }
    }));
  }
  for (const record of Array.isArray(records) ? records : []) {
    const rawPostId = record?.postId ?? record?.id;
    if (!/^\d+$/.test(String(rawPostId ?? ''))) continue;
    const observedAt = record.visitedAt ?? record.lastVisitedAt ?? record.updatedAt;
    entities.push(makeVisitEvent({
      id: legacyVisitId(record.id ?? rawPostId),
      postId: String(rawPostId),
      observedAt,
      source: { adapter: 'migration.footprints', deviceId, url: record.url },
      payload: { ...record, migratedFrom: 'records' }
    }));
  }
  for (const tombstone of Array.isArray(tombstones) ? tombstones : []) {
    const entityId = tombstone.entityId ?? tombstone.id;
    if (!entityId) continue;
    entities.push(makeTombstone({
      entityId: String(entityId),
      domain: tombstone.domain ?? 'footprints',
      deletedAt: tombstone.deletedAt ?? tombstone.updatedAt,
      source: { adapter: 'migration.footprints', deviceId }
    }));
  }
  return dedupe(entities);
}

export async function migrateRepository(repository, legacy, options = {}) {
  const entities = migrateLegacy({ ...legacy, ...options });
  let written = 0;
  for (const entity of entities) {
    const existing = await repository.get(entity.id);
    if (!existing) {
      await repository.put(entity);
      written += 1;
    }
  }
  return { discovered: entities.length, written, skipped: entities.length - written };
}

function dedupe(entities) {
  return [...new Map(entities.map((entity) => [entity.id, entity])).values()];
}
