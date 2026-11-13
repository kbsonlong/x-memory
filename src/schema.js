const TYPES = new Set([
  'post',
  'timeline_observation',
  'visit_event',
  'ai_artifact',
  'tombstone'
]);

const DOMAINS = new Set(['timeline', 'footprints', 'ai', 'sync']);

export function assertEntity(entity) {
  if (!entity || typeof entity !== 'object') throw new TypeError('entity must be an object');
  for (const field of ['id', 'type', 'domain', 'schemaVersion', 'createdAt', 'updatedAt', 'payload']) {
    if (entity[field] === undefined || entity[field] === null || entity[field] === '') {
      throw new TypeError(`entity.${field} is required`);
    }
  }
  if (!TYPES.has(entity.type)) throw new TypeError(`unsupported entity type: ${entity.type}`);
  if (!DOMAINS.has(entity.domain)) throw new TypeError(`unsupported entity domain: ${entity.domain}`);
  if (typeof entity.id !== 'string') throw new TypeError('entity.id must be a string');
  if (!Number.isInteger(entity.schemaVersion) || entity.schemaVersion < 1) {
    throw new TypeError('entity.schemaVersion must be a positive integer');
  }
  return entity;
}

export function postId(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value)) throw new TypeError('postId must be a numeric X status ID');
  return value;
}

export function now() {
  return new Date().toISOString();
}

function base({ id, type, domain, observedAt, source = {}, subject = {}, payload, at = now() }) {
  return {
    id,
    type,
    domain,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    observedAt: observedAt ?? at,
    source,
    subject,
    payload,
    revision: 1,
    deletedAt: null
  };
}

export function makePost({ id, payload = {}, source = {}, subject = {}, observedAt, at }) {
  const statusId = postId(id);
  return base({
    id: `post:${statusId}`,
    type: 'post',
    domain: 'timeline',
    observedAt,
    source,
    subject: { postId: statusId, ...subject },
    payload: { postId: statusId, ...payload },
    at
  });
}

export function makeTimelineObservation({ id, postId: rawPostId, payload = {}, source = {}, observedAt, at }) {
  const statusId = postId(rawPostId);
  const observationId = String(id ?? `${source.deviceId ?? 'device'}:${statusId}:${observedAt ?? now()}`);
  return base({
    id: observationId.startsWith('timeline:') ? observationId : `timeline:${observationId}`,
    type: 'timeline_observation',
    domain: 'timeline',
    observedAt,
    source,
    subject: { postId: statusId },
    payload: { postId: statusId, ...payload },
    at
  });
}

export function makeVisitEvent({ id, postId: rawPostId, payload = {}, source = {}, observedAt, at }) {
  const statusId = postId(rawPostId);
  const eventId = String(id ?? `${source.deviceId ?? 'device'}:${statusId}:${observedAt ?? now()}`);
  return base({
    id: eventId.startsWith('visit:') ? eventId : `visit:${eventId}`,
    type: 'visit_event',
    domain: 'footprints',
    observedAt,
    source,
    subject: { postId: statusId },
    payload: { postId: statusId, ...payload },
    at
  });
}

export function makeTombstone({ entityId, domain, deletedAt = now(), source = {} }) {
  if (!entityId || typeof entityId !== 'string') throw new TypeError('entityId is required');
  return base({
    id: `tombstone:${entityId}`,
    type: 'tombstone',
    domain: 'sync',
    observedAt: deletedAt,
    source,
    subject: { entityId, domain },
    payload: { entityId, domain, deletedAt },
    at: deletedAt
  });
}

export function namespaceFor(entity) {
  assertEntity(entity);
  if (entity.type === 'tombstone') return 'sync.tombstones';
  if (entity.type === 'visit_event') return 'footprints.visit_events';
  if (entity.type === 'ai_artifact') return 'ai.artifacts';
  if (entity.type === 'post') return 'timeline.posts';
  if (entity.type === 'timeline_observation') return 'timeline.observations';
  throw new TypeError(`no namespace for ${entity.type}`);
}

export function legacyVisitId(recordId) {
  const value = String(recordId ?? '').trim();
  if (!value) throw new TypeError('legacy record id is required');
  return `visit:legacy:${encodeURIComponent(value)}`;
}
