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
      observations: observations.slice(0, limit),
      visits: visits.slice(0, limit),
      counts: { observations: observations.length, visits: visits.length }
    };
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
    }).slice(0, limit);
  }
}
