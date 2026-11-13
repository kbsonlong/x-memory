export class SyncEngine {
  constructor({ repository, transport = null } = {}) {
    if (!repository) throw new TypeError('SyncEngine requires a repository');
    this.repository = repository;
    this.transport = transport;
    this.queue = [];
    this.statusValue = 'idle';
  }

  enqueue(entity) {
    this.queue.push({ entityId: entity.id, domain: entity.domain, state: 'queued', entity });
    return this.queue.at(-1);
  }

  status() {
    return { state: this.statusValue, queued: this.queue.filter((item) => item.state === 'queued').length };
  }

  async flush() {
    if (!this.transport) return { ...this.status(), state: 'offline', flushed: 0 };
    this.statusValue = 'uploading';
    let flushed = 0;
    for (const item of this.queue.filter((entry) => entry.state === 'queued')) {
      try {
        item.state = 'uploading';
        await this.transport.push(item.entity);
        item.state = 'acknowledged';
        flushed += 1;
      } catch (error) {
        item.state = 'failed';
        item.error = String(error.message ?? error);
      }
    }
    this.statusValue = this.queue.some((item) => item.state === 'failed') ? 'failed' : 'idle';
    return { ...this.status(), flushed };
  }
}
