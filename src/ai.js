export function createAiOrchestrator({ query, provider = async () => { throw new Error('AI provider is not configured'); } } = {}) {
  if (!query) throw new TypeError('AI orchestrator requires a query service');
  return {
    async run(request) {
      validateRequest(request);
      const entities = await query.getByRefs(request.context.entityRefs);
      const allowed = entities.filter((entity) => entity.domain !== 'footprints' || request.options?.includeFootprints === true);
      const result = await provider({ ...request, entities: allowed });
      return {
        task: request.task,
        inputRefs: allowed.map((entity) => entity.id),
        result
      };
    }
  };
}

function validateRequest(request) {
  if (!request || !['summarize', 'ask', 'digest', 'classify', 'compare'].includes(request.task)) {
    throw new TypeError('unsupported AI task');
  }
  if (!request.context || !Array.isArray(request.context.entityRefs)) {
    throw new TypeError('AI context.entityRefs must be an array');
  }
}
