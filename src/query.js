export class QueryService {
  constructor(repository) {
    this.repository = repository;
  }

  async getRelated({ postId, limit = 20 } = {}) {
    if (!/^\d+$/.test(String(postId ?? ''))) throw new TypeError('postId must be numeric');
    const [post, observations, visits] = await Promise.all([
      this.repository.get(`post:${postId}`),
      this.repository.list({ type: 'timeline_observation', postId }),
      this.repository.list({ type: 'visit_event', postId })
    ]);
    return {
      post: post ?? null,
      observations: limit == null ? observations : observations.slice(0, limit),
      visits: limit == null ? visits : visits.slice(0, limit),
      counts: { observations: observations.length, visits: visits.length }
    };
  }

  async getFeed() {
    const entities = await this.repository.list();
    const posts = new Map();
    for (const entity of entities) {
      const postId = String(entity.payload?.postId || entity.subject?.postId || (entity.type === 'post' ? entity.id.replace(/^post:/, '') : '')).trim();
      if (!postId) continue;
      if (!['post', 'timeline_observation', 'visit_event'].includes(entity.type)) continue;
      let item = posts.get(postId);
      if (!item) {
        item = { id: postId, post: null, observations: [], visits: [] };
        posts.set(postId, item);
      }
      if (entity.type === 'post') item.post = entity;
      if (entity.type === 'timeline_observation') item.observations.push(entity);
      if (entity.type === 'visit_event') item.visits.push(entity);
    }
    return [...posts.values()].sort((a, b) => feedTimestamp(b).localeCompare(feedTimestamp(a)));
  }

  async getByRefs(refs = []) {
    if (!Array.isArray(refs)) throw new TypeError('refs must be an array');
    const entities = [];
    for (const ref of refs) {
      const entity = await this.repository.get(ref);
      if (entity) entities.push(entity);
    }
    return entities;
  }

  async search({ query = '', domains, limit = 50 } = {}) {
    const entities = await this.repository.list();
    const needle = String(query).trim().toLocaleLowerCase();
    return entities.filter((entity) => {
      if (domains?.length && !domains.includes(entity.domain)) return false;
      if (!needle) return true;
      return JSON.stringify(entity.payload).toLocaleLowerCase().includes(needle);
    }).slice(0, limit ?? undefined);
  }
}

function feedTimestamp(item) {
  return [item.post, ...item.observations, ...item.visits]
    .filter(Boolean)
    .map((entity) => entity.observedAt || entity.updatedAt || '')
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || '';
}
