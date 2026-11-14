import { ChromeStorageStore, Repository } from '../../src/repository.js';
import { makeAiArtifact, makePost, makeTimelineObservation, makeVisitEvent } from '../../src/schema.js';
import { QueryService } from '../../src/query.js';
import { createAiOrchestrator, createOpenAiCompatibleProvider } from '../../src/ai.js';
import { S3SnapshotTransport, SyncEngine } from '../../src/sync.js';

const repository = new Repository(new ChromeStorageStore());
const query = new QueryService(repository);
const ai = createAiOrchestrator({ query, provider: createOpenAiCompatibleProvider() });
const SETTINGS_KEY = 'xmemory.settings';

export async function handleMessage(message, sender = {}) {
  try {
    switch (message?.type) {
      case 'memory.query.related':
        return { ok: true, data: await query.getRelated({ postId: message.postId, limit: message.limit }) };
      case 'memory.query.search':
        return { ok: true, data: await query.search(message) };
      case 'memory.query.feed':
        return { ok: true, data: await query.getFeed() };
      case 'memory.settings.get':
        return { ok: true, data: await getSettings() };
      case 'memory.settings.save': {
        const previous = await getSettings();
        const input = message.settings || {};
        const settings = normalizeSettings({
          ...input,
          aiApiKey: keepSecret(input.aiApiKey, previous.aiApiKey),
          s3: {
            ...input.s3,
            secretAccessKey: keepSecret(input.s3?.secretAccessKey, previous.s3.secretAccessKey),
            sessionToken: keepSecret(input.s3?.sessionToken, previous.s3.sessionToken)
          }
        });
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        return { ok: true, data: publicSettings(settings) };
      }
      case 'memory.sync.run': {
        const settings = await getSettings();
        const transport = new S3SnapshotTransport(settings.s3);
        const sync = new SyncEngine({ repository, transport });
        return { ok: true, data: await sync.sync() };
      }
      case 'memory.ai.summarize':
        return { ok: true, data: await summarizePost(message.postId) };
      case 'rewind.capture': {
        const post = await repository.put(makePost({ id: message.post.id, payload: message.post, source: sourceOf(sender, 'x.timeline') }));
        const observation = await repository.put(makeTimelineObservation({
          id: message.observationId,
          postId: message.post.id,
          observedAt: message.post.capturedAt,
          payload: {
            postId: message.post.id,
            url: message.post.url,
            text: message.post.text,
            authorName: message.post.authorName,
            authorHandle: message.post.authorHandle,
            avatarUrl: message.post.avatarUrl,
            media: message.post.media
          },
          source: sourceOf(sender, 'x.timeline')
        }));
        return { ok: true, data: { post, observation } };
      }
      case 'footprints.upsert': {
        const visit = await repository.put(makeVisitEvent({
          id: message.visit?.id,
          postId: message.visit.postId ?? message.visit.id,
          payload: message.visit,
          source: sourceOf(sender, 'x.detail')
        }));
        return { ok: true, data: visit };
      }
      case 'memory.sync.status':
        return { ok: true, data: { state: 'ready' } };
      default:
        return { ok: false, error: { code: 'UNKNOWN_MESSAGE', message: 'Unknown message type' } };
    }
  } catch (error) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: error.message } };
  }
}

function keepSecret(value, previous) {
  const next = String(value || '').trim();
  return !next || next === '••••••••' ? previous : next;
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY] || {});
}

function normalizeSettings(value = {}) {
  const s3 = value.s3 || {};
  return {
    aiEndpoint: String(value.aiEndpoint || 'https://api.openai.com/v1/chat/completions').trim(),
    aiModel: String(value.aiModel || 'gpt-4o-mini').trim(),
    aiApiKey: String(value.aiApiKey || '').trim(),
    s3: {
      endpoint: String(s3.endpoint || '').trim(),
      bucket: String(s3.bucket || '').trim(),
      region: String(s3.region || 'us-east-1').trim(),
      accessKeyId: String(s3.accessKeyId || '').trim(),
      secretAccessKey: String(s3.secretAccessKey || '').trim(),
      sessionToken: String(s3.sessionToken || '').trim(),
      prefix: String(s3.prefix || 'x-memory').trim()
    }
  };
}

function publicSettings(settings) {
  return { ...settings, aiApiKey: settings.aiApiKey ? '••••••••' : '', s3: { ...settings.s3, secretAccessKey: settings.s3.secretAccessKey ? '••••••••' : '', sessionToken: settings.s3.sessionToken ? '••••••••' : '' } };
}

async function summarizePost(rawPostId) {
  const postId = String(rawPostId || '').trim();
  if (!/^\d+$/.test(postId)) throw new TypeError('postId must be numeric');
  const related = await query.getRelated({ postId, limit: null });
  const entities = [related.post, ...related.observations].filter(Boolean);
  if (!entities.length) throw new Error('找不到这条帖子');
  const inputRefs = entities.map((entity) => entity.id);
  const hashInput = JSON.stringify(entities.map((entity) => ({ id: entity.id, payload: entity.payload })));
  const inputHash = await digest(hashInput);
  const settings = await getSettings();
  const model = settings.aiModel || 'gpt-4o-mini';
  const id = `ai:summary:${inputHash}:${model}`;
  const existing = await repository.get(id);
  if (existing) return existing;
  const result = await ai.run({
    task: 'summarize',
    context: { entityRefs: inputRefs },
    options: { language: 'zh-CN', model, maxTokens: 800 },
    settings
  });
  const artifact = makeAiArtifact({
    id,
    payload: { task: 'summarize', text: result.result.text, model: result.result.model, inputRefs, inputHash, postId }
  });
  return repository.put(artifact);
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceOf(sender, adapter) {
  return { adapter, tabId: sender.tab?.id ?? null, url: sender.tab?.url ?? null };
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
  });

  chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['apps/extension/content.js'] })
    ));
  });
}
