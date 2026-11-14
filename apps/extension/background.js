import { ChromeStorageStore, Repository } from '../../src/repository.js';
import { makePost, makeTimelineObservation, makeVisitEvent } from '../../src/schema.js';
import { QueryService } from '../../src/query.js';

const repository = new Repository(new ChromeStorageStore());
const query = new QueryService(repository);

export async function handleMessage(message, sender = {}) {
  try {
    switch (message?.type) {
      case 'memory.query.related':
        return { ok: true, data: await query.getRelated({ postId: message.postId, limit: message.limit }) };
      case 'memory.query.search':
        return { ok: true, data: await query.search(message) };
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
        return { ok: true, data: { state: 'local-only', queued: 0 } };
      default:
        return { ok: false, error: { code: 'UNKNOWN_MESSAGE', message: 'Unknown message type' } };
    }
  } catch (error) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: error.message } };
  }
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
