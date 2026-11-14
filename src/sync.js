import { assertEntity } from './schema.js';

const encoder = new TextEncoder();

export class SyncEngine {
  constructor({ repository, transport = null } = {}) {
    if (!repository) throw new TypeError('SyncEngine requires a repository');
    this.repository = repository;
    this.transport = transport;
    this.statusValue = 'idle';
  }

  status() {
    return { state: this.statusValue };
  }

  async sync() {
    if (!this.transport) return { ...this.status(), state: 'offline' };
    this.statusValue = 'syncing';
    try {
      const entities = await this.repository.list({ includeDeleted: true });
      const result = await this.transport.sync(entities);
      for (const entity of result.entities) await this.repository.put(entity);
      this.statusValue = 'idle';
      return { ...result, state: 'idle' };
    } catch (error) {
      this.statusValue = 'failed';
      throw error;
    }
  }
}

export class S3SnapshotTransport {
  constructor({ endpoint, bucket, region = 'us-east-1', accessKeyId, secretAccessKey, sessionToken = '', prefix = 'x-memory', fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new TypeError('S3 endpoint, bucket, access key, and secret key are required');
    this.endpoint = new URL(endpoint);
    if (!['http:', 'https:'].includes(this.endpoint.protocol)) throw new TypeError('S3 endpoint must use HTTP or HTTPS');
    this.bucket = bucket.trim();
    this.region = region.trim() || 'us-east-1';
    this.accessKeyId = accessKeyId.trim();
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken.trim();
    this.key = [prefix.trim().replace(/^\/+|\/+$/g, ''), 'snapshot.json'].filter(Boolean).join('/');
    this.fetch = fetchImpl;
    this.crypto = cryptoImpl;
  }

  async sync(localEntities) {
    const url = this.objectUrl();
    const remoteResponse = await this.request('GET', url);
    let remote = [];
    if (remoteResponse.status === 200) {
      const snapshot = await remoteResponse.json();
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.entities)) throw new Error('S3 snapshot has an unsupported format');
      remote = snapshot.entities;
      for (const entity of remote) assertEntity(entity);
    } else if (remoteResponse.status !== 404) {
      throw new Error(`S3 download failed (${remoteResponse.status})`);
    }

    const merged = mergeEntities(remote, localEntities);
    const body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entities: merged });
    const upload = await this.request('PUT', url, body);
    if (!upload.ok) throw new Error(`S3 upload failed (${upload.status})`);
    return { entities: merged, uploaded: merged.length, downloaded: remote.length };
  }

  objectUrl() {
    const base = this.endpoint.pathname.replace(/\/+$/, '');
    const key = [this.bucket, ...this.key.split('/')].map(awsEncode).join('/');
    const url = new URL(this.endpoint.href);
    url.pathname = `${base}/${key}`;
    url.search = '';
    url.hash = '';
    return url;
  }

  async request(method, url, body = '') {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = await sha256(this.crypto, body);
    const headers = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    if (this.sessionToken) headers['x-amz-security-token'] = this.sessionToken;
    const canonicalHeaders = `host:${url.host}\n${Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value.trim()}\n`).join('')}`;
    const signedHeaders = ['host', ...Object.keys(headers).sort()].join(';');
    const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(this.crypto, canonicalRequest)].join('\n');
    const signingKey = await deriveSigningKey(this.crypto, this.secretAccessKey, date, this.region);
    const signature = toHex(await hmac(this.crypto, signingKey, stringToSign));
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return this.fetch(url.href, { method, headers, ...(method === 'PUT' ? { body } : {}) });
  }
}

function mergeEntities(remote, local) {
  const byId = new Map();
  for (const entity of [...remote, ...local]) {
    if (!entity || typeof entity.id !== 'string') continue;
    const previous = byId.get(entity.id);
    if (!previous) {
      byId.set(entity.id, structuredClone(entity));
      continue;
    }
    const newest = String(entity.updatedAt || '').localeCompare(String(previous.updatedAt || '')) >= 0 ? entity : previous;
    const oldest = newest === entity ? previous : entity;
    const payload = { ...(oldest.payload || {}), ...(newest.payload || {}) };
    byId.set(entity.id, {
      ...oldest,
      ...newest,
      payload,
      revision: Math.max(previous.revision || 1, entity.revision || 1),
      createdAt: [previous.createdAt, entity.createdAt].filter(Boolean).sort()[0] || newest.createdAt
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function sha256(cryptoImpl, value) {
  return toHex(await cryptoImpl.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(cryptoImpl, key, value) {
  const cryptoKey = await cryptoImpl.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await cryptoImpl.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}

async function deriveSigningKey(cryptoImpl, secret, date, region) {
  const dateKey = await hmac(cryptoImpl, encoder.encode(`AWS4${secret}`), date);
  const regionKey = await hmac(cryptoImpl, dateKey, region);
  const serviceKey = await hmac(cryptoImpl, regionKey, 's3');
  return hmac(cryptoImpl, serviceKey, 'aws4_request');
}

function toHex(value) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
