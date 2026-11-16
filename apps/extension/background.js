import { ChromeStorageStore, Repository } from '../../src/repository.js';
import { makeAiArtifact, makePost, makeTimelineObservation, makeVisitEvent } from '../../src/schema.js';
import { QueryService } from '../../src/query.js';
import { createAiOrchestrator, createOpenAiCompatibleProvider } from '../../src/ai.js';
import { S3SnapshotTransport, SyncEngine } from '../../src/sync.js';

const repository = new Repository(new ChromeStorageStore());
const query = new QueryService(repository);
const ai = createAiOrchestrator({ query, provider: createOpenAiCompatibleProvider() });
const SETTINGS_KEY = 'xmemory.settings';
const DAILY_DIGEST_ALARM = 'xmemory.daily-digest';

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
          },
          webhook: {
            ...input.webhook,
            telegramBotToken: keepSecret(input.webhook?.telegramBotToken, previous.webhook.telegramBotToken)
          }
        });
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        await configureDailyDigestAlarm(settings);
        return { ok: true, data: publicSettings(settings) };
      }
      case 'memory.export.snapshot':
        return { ok: true, data: await repository.snapshot() };
      case 'memory.export.feed':
        return { ok: true, data: await query.getFeed() };
      case 'memory.sync.run': {
        const settings = await getSettings();
        const transport = new S3SnapshotTransport(settings.s3);
        const sync = new SyncEngine({ repository, transport });
        return { ok: true, data: await sync.sync() };
      }
      case 'memory.ai.daily-digest':
        return { ok: true, data: await generateDailyDigest(message.date) };
      case 'memory.ai.test-digest-push':
        return { ok: true, data: await testRecentDigestPush() };
      case 'memory.ai.get-daily-digest':
        return { ok: true, data: await getDailyDigest(message.date) };
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
    },
    schedule: {
      dailyDigestEnabled: Boolean(value.schedule?.dailyDigestEnabled),
      dailyDigestTime: validDigestTime(value.schedule?.dailyDigestTime)
    },
    webhook: {
      url: String(value.webhook?.url || '').trim(),
      telegramBotToken: String(value.webhook?.telegramBotToken || '').trim(),
      telegramChatId: String(value.webhook?.telegramChatId || '').trim()
    }
  };
}

function publicSettings(settings) {
  return {
    ...settings,
    aiApiKey: settings.aiApiKey ? '••••••••' : '',
    s3: { ...settings.s3, secretAccessKey: settings.s3.secretAccessKey ? '••••••••' : '', sessionToken: settings.s3.sessionToken ? '••••••••' : '' },
    webhook: { ...settings.webhook, telegramBotToken: settings.webhook.telegramBotToken ? '••••••••' : '' }
  };
}

function validDigestTime(value) {
  const time = String(value || '09:00').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00';
}

async function configureDailyDigestAlarm(settings) {
  if (!globalThis.chrome?.alarms) return;
  settings ||= await getSettings();
  await chrome.alarms.clear(DAILY_DIGEST_ALARM);
  if (!settings.schedule.dailyDigestEnabled) return;
  chrome.alarms.create(DAILY_DIGEST_ALARM, { when: nextDigestTime(settings.schedule.dailyDigestTime) });
}

function nextDigestTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function runScheduledDigest() {
  const settings = await getSettings();
  if (!settings.schedule.dailyDigestEnabled) return;
  const date = localDateOf(new Date());
  const stateResult = await chrome.storage.local.get('xmemory.scheduler.lastRunDate');
  if (stateResult['xmemory.scheduler.lastRunDate'] === date) return;
  const artifact = await generateDailyDigest(date);
  await pushDailyDigest(settings.webhook, artifact);
  await chrome.storage.local.set({ 'xmemory.scheduler.lastRunDate': date });
}

async function pushDailyDigest(webhook, artifact, { test = false } = {}) {
  const payload = artifact?.payload || {};
  const report = payload.report || { overall: payload.text || '' };
  const date = payload.date || localDateOf(new Date());
  const title = `X Memory · ${test ? '推送测试 · ' : ''}${date} 知识日报`;
  const text = [
    ...(test ? ['🧪 推送测试（基于最近记录）'] : []),
    title,
    report.overall || '今日知识日报已生成。',
    ...(Array.isArray(report.interestDirections) ? report.interestDirections.map((item) => `兴趣方向：${item.direction || item.category || ''} — ${item.summary || item.evidence || ''}`) : [])
  ].join('\n').slice(0, 3900);
  const results = [];
  if (webhook.url) {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: test ? 'daily_digest_test' : 'daily_digest', date, title, text, report, stats: payload.stats || {} })
    });
    if (!response.ok) throw new Error(`Webhook 推送失败（HTTP ${response.status}）`);
    results.push('webhook');
  }
  if (webhook.telegramBotToken && webhook.telegramChatId) {
    const response = await fetch(`https://api.telegram.org/bot${webhook.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: webhook.telegramChatId, text, disable_web_page_preview: true })
    });
    if (!response.ok) throw new Error(`Telegram 推送失败（HTTP ${response.status}）`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram 推送失败：${result.description || '未知错误'}`);
    results.push('telegram');
  }
  return results;
}

async function testRecentDigestPush() {
  const settings = await getSettings();
  const webhook = settings.webhook;
  if (!webhook.url && !(webhook.telegramBotToken && webhook.telegramChatId)) {
    throw new Error('请先在设置中配置 Webhook URL 或 Telegram Bot Token 与 Chat ID');
  }
  const [timeline, visits] = await Promise.all([
    repository.list({ type: 'timeline_observation' }),
    repository.list({ type: 'visit_event' })
  ]);
  const timelineSample = timeline.slice(0, 3);
  const visitSample = visits.slice(0, 3);
  const entities = [...timelineSample, ...visitSample];
  if (!entities.length) throw new Error('本地还没有可用于测试的帖子记录');
  const date = localDateOf(new Date());
  const stats = {
    timelinePosts: timelineSample.length,
    timelineObservations: timelineSample.length,
    visitedPosts: visitSample.length,
    visitEvents: visitSample.length,
    sampledTimelinePosts: timelineSample.length,
    sampledVisitedPosts: visitSample.length
  };
  const result = await ai.run({
    task: 'daily_digest',
    context: { entityRefs: entities.map((entity) => entity.id), reportDate: date, stats },
    options: { language: 'zh-CN', model: settings.aiModel, maxTokens: 1400, includeFootprints: true },
    settings
  });
  const artifact = {
    payload: {
      task: 'daily_digest_test', date, report: result.result.report, text: result.result.text,
      model: result.result.model, stats
    }
  };
  const channels = await pushDailyDigest(webhook, artifact, { test: true });
  return { artifact, channels, sampleCount: entities.length };
}

async function generateDailyDigest(rawDate) {
  const date = validReportDate(rawDate);
  const [allTimeline, allVisits] = await Promise.all([
    repository.list({ type: 'timeline_observation' }),
    repository.list({ type: 'visit_event' })
  ]);
  const timelineToday = allTimeline.filter((entity) => localDateOf(entityTime(entity)) === date);
  const visitsToday = allVisits.filter((entity) => localDateOf(entityTime(entity)) === date);
  const timelineByPost = latestByPost(timelineToday);
  const visitsByPost = latestByPost(visitsToday);
  const timelineEntities = [...timelineByPost.values()].slice(0, 20);
  const visitEntities = [...visitsByPost.values()].slice(0, 20);
  const entities = [...timelineEntities, ...visitEntities];
  if (!entities.length) throw new Error(`${date} 没有时间线或访问记录`);
  const inputRefs = entities.map((entity) => entity.id);
  const stats = {
    timelinePosts: timelineByPost.size,
    timelineObservations: timelineToday.length,
    visitedPosts: visitsByPost.size,
    visitEvents: visitsToday.length,
    sampledTimelinePosts: timelineEntities.length,
    sampledVisitedPosts: visitEntities.length
  };
  const hashInput = JSON.stringify({ date, stats, entities: entities.map((entity) => ({ id: entity.id, payload: entity.payload })) });
  const inputHash = await digest(hashInput);
  const settings = await getSettings();
  const model = settings.aiModel || 'gpt-4o-mini';
  const id = `ai:daily-digest:${date}:${inputHash}:${model}`;
  const existing = await repository.get(id);
  if (existing) return existing;
  const result = await ai.run({
    task: 'daily_digest',
    context: { entityRefs: inputRefs, reportDate: date, stats },
    options: { language: 'zh-CN', model, maxTokens: 1400, includeFootprints: true },
    settings
  });
  const artifact = makeAiArtifact({
    id,
    payload: { task: 'daily_digest', date, report: result.result.report, text: result.result.text, model: result.result.model, inputRefs, inputHash, stats }
  });
  return repository.put(artifact);
}

async function getDailyDigest(rawDate) {
  const date = validReportDate(rawDate);
  const artifacts = await repository.list({ type: 'ai_artifact' });
  return artifacts.find((entity) => entity.payload?.task === 'daily_digest' && entity.payload?.date === date) || null;
}

function validReportDate(value) {
  const date = String(value || localDateOf(new Date())).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must use YYYY-MM-DD');
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.valueOf()) || localDateOf(parsed) !== date) throw new TypeError('date must be a valid calendar date');
  return date;
}

function localDateOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function entityTime(entity) {
  return entity.observedAt || entity.payload?.visitedAt || entity.updatedAt;
}

function latestByPost(entities) {
  const result = new Map();
  for (const entity of entities) {
    const postId = String(entity.payload?.postId || entity.subject?.postId || '').trim();
    if (postId && !result.has(postId)) result.set(postId, entity);
  }
  return result;
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
    await configureDailyDigestAlarm();
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['apps/extension/content.js'] })
    ));
  });

  chrome.runtime.onStartup?.addListener(() => configureDailyDigestAlarm());
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== DAILY_DIGEST_ALARM) return;
    runScheduledDigest().catch((error) => console.error('Scheduled daily digest failed:', error));
    configureDailyDigestAlarm().catch((error) => console.error('Daily digest alarm setup failed:', error));
  });
}
