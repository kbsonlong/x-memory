const statusEl = document.querySelector('#status');
const statusStrip = document.querySelector('#status-strip');
const records = document.querySelector('#records');
const template = document.querySelector('#record-template');
const searchInput = document.querySelector('#search');
const filters = [...document.querySelectorAll('.filter')];
const digestDate = document.querySelector('#digest-date');
const dailyReport = document.querySelector('#daily-report');
const viewTabs = [...document.querySelectorAll('.view-tab')];
const toastHost = document.querySelector('#toast-host');
const refreshButton = document.querySelector('#refresh');
const pageSize = 20;
let activeFilter = 'all';
let activePage = 1;
let allItems = [];

/* ============================================================
   UI feedback helpers
   ============================================================ */
function setStatus(text, isError) {
  statusEl.textContent = text;
  statusStrip.classList.toggle('is-error', Boolean(isError));
}

function toast(type, message) {
  const node = document.createElement('div');
  const iconId = type === 'error' ? 'i-alert' : (type === 'info' ? 'i-spark' : 'i-check');
  node.className = `toast toast-${type}`;
  node.innerHTML = `<span class="toast-ico"><svg class="ico"><use href="#${iconId}"></use></svg></span><span class="toast-message"></span>`;
  node.querySelector('.toast-message').textContent = message;
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 200);
  }, 3500);
}

function setButtonLabel(button, text) {
  const span = button.querySelector('span');
  if (span) span.textContent = text;
  else button.textContent = text;
}

/* ============================================================
   Theme (persisted locally)
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const use = document.querySelector('#theme-toggle use');
  if (use) use.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  document.querySelector('#theme-toggle').title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
}
function loadTheme() {
  try {
    chrome.storage.local.get('xmemory.theme', (result) => {
      applyTheme(result['xmemory.theme'] === 'dark' ? 'dark' : 'light');
    });
  } catch {
    applyTheme('light');
  }
}
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { chrome.storage.local.set({ 'xmemory.theme': next }); } catch { /* ignore */ }
});

/* ============================================================
   Wiring (所有业务 id 均保留)
   ============================================================ */
digestDate.value = localDateString(new Date());

for (const button of filters) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    for (const item of filters) {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    }
    activePage = 1;
    renderItems();
  });
}

document.querySelector('#refresh').addEventListener('click', refreshRecords);
document.querySelector('#settings-toggle').addEventListener('click', () => setView('settings'));
for (const tab of viewTabs) tab.addEventListener('click', () => setView(tab.dataset.view));
document.querySelector('#page-previous').addEventListener('click', () => changePage(-1));
document.querySelector('#page-next').addEventListener('click', () => changePage(1));
document.querySelector('#save-settings').addEventListener('click', saveSettings);
document.querySelector('#sync-now').addEventListener('click', syncNow);
document.querySelector('#generate-digest').addEventListener('click', generateDailyDigest);
document.querySelector('#test-digest-push').addEventListener('click', testDigestPush);
for (const id of ['#export-json', '#export-json-alt']) {
  document.querySelector(id).addEventListener('click', () => exportData('json', id));
}
for (const id of ['#export-csv', '#export-csv-alt']) {
  document.querySelector(id).addEventListener('click', () => exportData('csv', id));
}
digestDate.addEventListener('change', loadDailyDigest);
searchInput.addEventListener('input', () => {
  activePage = 1;
  const hasValue = searchInput.value.length > 0;
  document.querySelector('#clear-search').hidden = !hasValue;
  renderItems();
});
document.querySelector('#clear-search').addEventListener('click', () => {
  searchInput.value = '';
  document.querySelector('#clear-search').hidden = true;
  activePage = 1;
  renderItems();
  searchInput.focus();
});
for (const button of document.querySelectorAll('.eye-button')) {
  button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.eyeFor}`);
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput) {
    event.preventDefault();
    setView('feed');
    searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    document.querySelector('#clear-search').hidden = true;
    renderItems();
    searchInput.blur();
  }
});

function setView(view) {
  for (const tab of viewTabs) {
    const selected = tab.dataset.view === view;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    document.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
  }
  if (view === 'settings') loadSettings();
  if (view === 'digest') loadDailyDigest();
}

function changePage(delta) {
  const totalPages = Math.max(1, Math.ceil(visibleItems().length / pageSize));
  activePage = Math.min(totalPages, Math.max(1, activePage + delta));
  renderItems();
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function payloadOf(entity) {
  return entity?.payload && typeof entity.payload === 'object' ? entity.payload : {};
}

function timestampOf(entity) {
  return entity?.observedAt || entity?.updatedAt || payloadOf(entity).visitedAt || payloadOf(entity).capturedAt || '';
}

function formatTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  const diff = Date.now() - date.valueOf();
  if (diff >= 0 && diff < 60 * 1000) return '刚刚';
  if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function mediaFrom(payload) {
  const rawMedia = payload.media;
  const mediaValues = Array.isArray(rawMedia)
    ? rawMedia
    : rawMedia && typeof rawMedia === 'object'
      ? rawMedia.assets || rawMedia.items || []
      : [];
  const values = [
    ...mediaValues,
    ...(Array.isArray(payload.images) ? payload.images : []),
    ...(Array.isArray(payload.mediaUrls) ? payload.mediaUrls : [])
  ];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const url = safeUrl(typeof value === 'string' ? value : value?.url || value?.media_url_https || value?.src);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, alt: typeof value === 'object' ? String(value.alt || value.description || '帖子图片') : '帖子图片' });
  }
  return result.slice(0, 4);
}

function entitiesOf(item) {
  return [item.post, ...item.observations, ...item.visits].filter(Boolean);
}

function itemTimestamp(item) {
  return entitiesOf(item)
    .map(timestampOf)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || '';
}

function lastVisitTimestamp(item) {
  return (item.visits || [])
    .map(timestampOf)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || '';
}

function mergedPayload(item) {
  const result = {};
  for (const entity of [...entitiesOf(item)].reverse()) {
    for (const [key, value] of Object.entries(payloadOf(entity))) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      result[key] = value;
    }
  }
  return result;
}

function searchableText(item) {
  const values = entitiesOf(item).flatMap((entity) => {
    const payload = payloadOf(entity);
    return [payload.text, payload.authorName, payload.authorHandle, payload.postId, payload.url];
  });
  return values.filter(Boolean).join(' ').toLocaleLowerCase();
}

function visibleItems() {
  const needle = searchInput.value.trim().toLocaleLowerCase();
  return allItems.filter((item) => {
    if (activeFilter === 'visited' && !item.visits.length) return false;
    if (activeFilter === 'timeline' && !item.post && !item.observations.length) return false;
    return !needle || searchableText(item).includes(needle);
  });
}

function createMedia(mediaGrid, media) {
  if (!media.length) return;
  mediaGrid.hidden = false;
  mediaGrid.classList.toggle('single', media.length === 1);
  for (const image of media) {
    const wrapper = document.createElement('div');
    wrapper.className = 'media-item';
    const img = document.createElement('img');
    img.src = image.url;
    img.alt = image.alt;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      wrapper.classList.add('media-error');
      img.removeAttribute('src');
      wrapper.textContent = '图片暂时无法加载';
    }, { once: true });
    wrapper.append(img);
    mediaGrid.append(wrapper);
  }
}

function addRecord(item) {
  const node = template.content.cloneNode(true);
  const record = node.querySelector('.record');
  const payload = mergedPayload(item);
  const postId = item.id;
  const text = String(payload.text || '').trim();
  const authorName = String(payload.authorName || 'X 内容').trim();
  const handle = payload.authorHandle ? `@${String(payload.authorHandle).replace(/^@/, '')}` : '本地保存';
  const url = safeUrl(payload.url) || (postId.match(/^\d+$/) ? `https://x.com/i/status/${postId}` : '');
  const media = mediaFrom(payload);
  const isVisit = !(item.post || item.observations.length);

  // 三重编码：图标 + 文字 + 颜色
  const typeTag = node.querySelector('.type-tag');
  const typeUse = typeTag.querySelector('use');
  typeUse.setAttribute('href', isVisit ? '#i-footprint' : '#i-clock');
  typeTag.classList.toggle('is-visit', isVisit);
  if (isVisit) typeTag.querySelector('use').classList.add('ico-fill');
  node.querySelector('.record-type').textContent = isVisit ? '访问记录' : '时间线记录';
  node.querySelector('.record-time').textContent = formatTime(itemTimestamp(item));

  // 独立访问足迹提示条
  const footprint = node.querySelector('.footprint');
  if (item.visits.length) {
    footprint.hidden = false;
    node.querySelector('.footprint-text').textContent = `访问过 ${item.visits.length} 次`;
    const last = lastVisitTimestamp(item);
    node.querySelector('.footprint-time').textContent = last ? `最近 ${formatTime(last)}` : '';
  }

  node.querySelector('.author-name').textContent = authorName;
  node.querySelector('.author-handle').textContent = handle;
  const mediaDescriptions = media.map((image) => image.alt).filter((alt) => alt && alt !== '帖子图片');
  const emptyText = mediaDescriptions.length
    ? `图片说明：${mediaDescriptions.join('；')}`
    : media.length
      ? '已保存图片/视频；X 未提供可提取的文字正文。'
      : '这条记录没有提取到正文。打开原帖可以查看完整内容。';
  node.querySelector('.record-body').textContent = text || emptyText;
  if (!text) record.classList.add('no-text');

  const body = node.querySelector('.record-body');
  const more = node.querySelector('.more-button');
  if (text.length > 320) {
    body.classList.add('collapsed');
    more.hidden = false;
    more.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      more.textContent = collapsed ? '展开全文' : '收起';
    });
  }

  const avatar = node.querySelector('.avatar');
  const avatarUrl = safeUrl(payload.avatarUrl || payload.profileImageUrl);
  if (avatarUrl) {
    const image = document.createElement('img');
    image.src = avatarUrl;
    image.alt = '';
    image.addEventListener('error', () => image.remove(), { once: true });
    avatar.append(image);
  } else {
    avatar.textContent = authorName.slice(0, 1).toUpperCase();
  }

  createMedia(node.querySelector('.media-grid'), media);
  node.querySelector('.visit-count').textContent = item.visits.length ? `访问 ${item.visits.length} 次` : '仅本地保存';
  const open = node.querySelector('.open-button');
  if (url) {
    open.addEventListener('click', () => chrome.tabs.create({ url }));
  } else {
    open.disabled = true;
    open.firstChild.textContent = '暂无原帖链接 ';
  }
  records.append(node);
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addKnowledgeGroup(container, title, items) {
  const section = document.createElement('section');
  section.className = 'knowledge-group';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);
  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = '当天没有足够内容归入此部分。';
    section.append(empty);
  }
  for (const item of items) {
    const article = document.createElement('article');
    const label = document.createElement('strong');
    label.textContent = item.category || item.direction || '其他';
    const detail = document.createElement('p');
    detail.textContent = item.summary || item.evidence || '';
    article.append(label, detail);
    if (Array.isArray(item.examples) && item.examples.length) {
      const examples = document.createElement('small');
      examples.textContent = `涉及：${item.examples.join('、')}`;
      article.append(examples);
    }
    if (item.confidence) {
      const confidence = document.createElement('small');
      confidence.textContent = `推测置信度：${item.confidence}`;
      article.append(confidence);
    }
    section.append(article);
  }
  container.append(section);
}

function renderDailyDigest(artifact) {
  dailyReport.replaceChildren();
  if (!artifact?.payload) {
    dailyReport.hidden = true;
    return;
  }
  const payload = artifact.payload;
  const report = payload.report || { overall: payload.text };
  const overall = document.createElement('p');
  overall.className = 'digest-overall';
  overall.textContent = report.overall || '本日报没有总体摘要。';
  dailyReport.append(overall);
  addKnowledgeGroup(dailyReport, '时间线内容', Array.isArray(report.timelineKnowledge) ? report.timelineKnowledge : []);
  addKnowledgeGroup(dailyReport, '主动访问内容', Array.isArray(report.visitedKnowledge) ? report.visitedKnowledge : []);
  addKnowledgeGroup(dailyReport, '可能感兴趣的方向', Array.isArray(report.interestDirections) ? report.interestDirections : []);
  const stats = document.createElement('small');
  stats.className = 'digest-stats';
  stats.textContent = `时间线 ${payload.stats?.timelinePosts || 0} 条 · 访问 ${payload.stats?.visitedPosts || 0} 条 · 模型 ${payload.model || '未知'}`;
  dailyReport.append(stats);
  dailyReport.hidden = false;
}

async function loadDailyDigest() {
  if (!digestDate.value) return;
  try {
    const response = await send({ type: 'memory.ai.get-daily-digest', date: digestDate.value });
    if (!response?.ok) throw new Error(response?.error?.message || '读取日报失败');
    renderDailyDigest(response.data);
  } catch (error) {
    setStatus(`读取日报失败：${error.message}`, true);
  }
}

async function generateDailyDigest() {
  const button = document.querySelector('#generate-digest');
  button.disabled = true;
  setButtonLabel(button, '正在分析当天内容…');
  setStatus('正在整理知识类别和兴趣方向…');
  try {
    const response = await send({ type: 'memory.ai.daily-digest', date: digestDate.value });
    if (!response?.ok) throw new Error(response?.error?.message || '日报生成失败');
    renderDailyDigest(response.data);
    setStatus(`${digestDate.value} 的知识日报已保存`);
    toast('success', '知识日报已生成并保存');
  } catch (error) {
    setStatus(`知识日报生成失败：${error.message}`, true);
    toast('error', `日报生成失败：${error.message}`);
  } finally {
    button.disabled = false;
    setButtonLabel(button, '生成今日日报');
  }
}

async function testDigestPush() {
  const button = document.querySelector('#test-digest-push');
  const resultNode = document.querySelector('#digest-push-result');
  button.disabled = true;
  setButtonLabel(button, '正在总结最近记录并推送…');
  resultNode.hidden = false;
  resultNode.classList.remove('error');
  resultNode.textContent = '正在读取最近帖子、生成总结并推送…';
  setStatus('正在读取最近帖子并测试推送…');
  try {
    const response = await send({ type: 'memory.ai.test-digest-push' });
    if (!response?.ok) throw new Error(response?.error?.message || '测试推送失败');
    renderDailyDigest(response.data.artifact);
    const channelNames = { telegram: 'Telegram', wecom: '企微', webhook: 'Webhook' };
    const channels = response.data.channels.map((channel) => channelNames[channel] || channel).join('、');
    const message = `推送成功：${channels} · 已总结最近 ${response.data.sampleCount} 条记录`;
    resultNode.textContent = message;
    setStatus(message);
    toast('success', `已推送至 ${channels}`);
  } catch (error) {
    resultNode.classList.add('error');
    resultNode.textContent = error.message;
    setStatus(`测试推送失败：${error.message}`, true);
    toast('error', `测试推送失败：${error.message}`);
  } finally {
    button.disabled = false;
    setButtonLabel(button, '测试推送（总结最近记录）');
  }
}

function renderSkeletons() {
  const card = '<div class="skeleton-card"><div class="sk-line sk-w40"></div><div class="sk-line sk-w60"></div><div class="sk-line sk-block sk-w100"></div><div class="sk-line sk-w85"></div></div>';
  records.innerHTML = card + card + card;
  document.querySelector('#pagination').hidden = true;
}

function renderEmpty(isSearch) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const iconId = isSearch ? 'i-search' : 'i-inbox';
  empty.innerHTML = `<div class="empty-ico"><svg class="ico"><use href="#${iconId}"></use></svg></div><strong></strong><span></span>`;
  empty.querySelector('strong').textContent = isSearch ? '没有找到匹配的内容' : '记忆库还是空的';
  empty.querySelector('span').textContent = isSearch
    ? '换个关键词，或清除筛选条件再试试。'
    : '打开 X 页面后，插件会自动保存可见帖子。';
  records.append(empty);
  document.querySelector('#pagination').hidden = true;
}

function renderItems() {
  records.replaceChildren();
  const items = visibleItems();
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  activePage = Math.min(activePage, totalPages);
  if (!items.length) {
    renderEmpty(Boolean(searchInput.value.trim()));
    return;
  }
  for (const item of items.slice((activePage - 1) * pageSize, activePage * pageSize)) addRecord(item);
  const pagination = document.querySelector('#pagination');
  pagination.hidden = items.length <= pageSize;
  document.querySelector('#page-indicator').textContent = `第 ${activePage} / ${totalPages} 页 · 共 ${items.length} 条`;
  document.querySelector('#page-previous').disabled = activePage === 1;
  document.querySelector('#page-next').disabled = activePage === totalPages;
}

function renderSummary(posts, observations, visits) {
  document.querySelector('[data-stat="posts"]').textContent = posts;
  document.querySelector('[data-stat="observations"]').textContent = observations;
  document.querySelector('[data-stat="visits"]').textContent = visits;
}

async function loadRecords() {
  setStatus('正在读取本地记录…');
  statusStrip.classList.remove('is-error');
  renderSkeletons();
  try {
    const response = await send({ type: 'memory.query.feed' });
    if (!response?.ok) throw new Error(response?.error?.message || '读取失败');
    allItems = response.data ?? [];
    const visits = allItems.reduce((count, item) => count + item.visits.length, 0);
    const observations = allItems.reduce((count, item) => count + item.observations.length, 0);
    renderSummary(allItems.length, observations, visits);
    setStatus(allItems.length ? `${allItems.length} 条内容已保存` : '还没有本地记录');
    renderItems();
  } catch (error) {
    allItems = [];
    renderSummary(0, 0, 0);
    renderItems();
    setStatus(`读取失败：${error.message}；本地数据未受影响`, true);
  }
}

async function loadSettings() {
  try {
    const response = await send({ type: 'memory.settings.get' });
    if (!response?.ok) throw new Error(response?.error?.message || '读取设置失败');
    const value = response.data;
    const s3Configured = Boolean(value.s3.endpoint && value.s3.bucket);
    document.querySelector('#sync-badge').textContent = s3Configured ? 'LOCAL + S3' : 'LOCAL ONLY';
    document.querySelector('#sync-badge').classList.toggle('synced', s3Configured);
    document.querySelector('#ai-endpoint').value = value.aiEndpoint || '';
    document.querySelector('#ai-model').value = value.aiModel || '';
    document.querySelector('#ai-key').placeholder = value.aiApiKey ? '已配置；留空保持不变' : '留空则保留已保存的 Key';
    document.querySelector('#s3-endpoint').value = value.s3.endpoint || '';
    document.querySelector('#s3-bucket').value = value.s3.bucket || '';
    document.querySelector('#s3-region').value = value.s3.region || 'us-east-1';
    document.querySelector('#s3-access-key').value = value.s3.accessKeyId || '';
    document.querySelector('#s3-secret-key').placeholder = value.s3.secretAccessKey ? '已配置；留空保持不变' : '留空则保留已保存的密钥';
    document.querySelector('#s3-session-token').placeholder = value.s3.sessionToken ? '已配置；留空保持不变' : '留空则保留已保存的值';
    document.querySelector('#s3-prefix').value = value.s3.prefix || 'x-memory';
    document.querySelector('#digest-schedule-enabled').checked = value.schedule.dailyDigestEnabled;
    document.querySelector('#digest-schedule-time').value = value.schedule.dailyDigestTime || '09:00';
    document.querySelector('#webhook-url').value = value.webhook.url || '';
    document.querySelector('#telegram-token').placeholder = value.webhook.telegramBotToken ? '已配置；留空保持不变' : '留空则保留已保存的 Token';
    document.querySelector('#telegram-chat-id').value = value.webhook.telegramChatId || '';
    // 分组完成状态
    const states = {
      ai: Boolean(value.aiApiKey && value.aiEndpoint),
      s3: s3Configured,
      schedule: Boolean(value.schedule.dailyDigestEnabled || value.webhook.url || value.webhook.telegramBotToken)
    };
    for (const [key, configured] of Object.entries(states)) {
      const badge = document.querySelector(`[data-state-for="${key}"]`);
      if (!badge) continue;
      badge.textContent = configured ? '已配置' : '未配置';
      badge.classList.toggle('configured', configured);
    }
  } catch (error) {
    setStatus(`读取设置失败：${error.message}`, true);
  }
}

function endpointOrigin(value) {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务地址必须使用 HTTP 或 HTTPS');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('远程服务地址必须使用 HTTPS');
  return `${url.origin}/*`;
}

async function saveSettings() {
  const button = document.querySelector('#save-settings');
  button.disabled = true;
  try {
    const aiEndpoint = document.querySelector('#ai-endpoint').value.trim() || 'https://api.openai.com/v1/chat/completions';
    const s3Endpoint = document.querySelector('#s3-endpoint').value.trim();
    const webhookUrl = document.querySelector('#webhook-url').value.trim();
    const telegramBotToken = document.querySelector('#telegram-token').value.trim();
    const telegramChatId = document.querySelector('#telegram-chat-id').value.trim();
    const telegramTokenConfigured = Boolean(telegramBotToken) || document.querySelector('#telegram-token').placeholder.startsWith('已配置');
    if (telegramChatId && !telegramTokenConfigured) {
      throw new Error('Telegram Bot Token 未填写；如需修改 Chat ID，请重新填写 Token');
    }
    if (telegramBotToken && !telegramChatId) {
      throw new Error('请同时填写 Telegram Bot Token 和 Chat ID');
    }
    const origins = [...new Set([
      endpointOrigin(aiEndpoint), endpointOrigin(s3Endpoint), endpointOrigin(webhookUrl),
      telegramTokenConfigured && telegramChatId ? 'https://api.telegram.org/*' : ''
    ].filter(Boolean))];
    if (origins.length && chrome.permissions?.request) {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) throw new Error('需要允许访问配置的 AI、S3 或推送服务地址');
    }
    const response = await send({
      type: 'memory.settings.save',
      settings: {
        aiEndpoint,
        aiModel: document.querySelector('#ai-model').value.trim() || 'gpt-4o-mini',
        aiApiKey: document.querySelector('#ai-key').value.trim(),
        s3: {
          endpoint: s3Endpoint,
          bucket: document.querySelector('#s3-bucket').value.trim(),
          region: document.querySelector('#s3-region').value.trim() || 'us-east-1',
          accessKeyId: document.querySelector('#s3-access-key').value.trim(),
          secretAccessKey: document.querySelector('#s3-secret-key').value.trim(),
          sessionToken: document.querySelector('#s3-session-token').value.trim(),
          prefix: document.querySelector('#s3-prefix').value.trim() || 'x-memory'
        },
        schedule: {
          dailyDigestEnabled: document.querySelector('#digest-schedule-enabled').checked,
          dailyDigestTime: document.querySelector('#digest-schedule-time').value || '09:00'
        },
        webhook: {
          url: webhookUrl,
          telegramBotToken,
          telegramChatId
        }
      }
    });
    if (!response?.ok) throw new Error(response?.error?.message || '保存失败');
    document.querySelector('#ai-key').value = '';
    document.querySelector('#s3-secret-key').value = '';
    document.querySelector('#s3-session-token').value = '';
    document.querySelector('#telegram-token').value = '';
    await loadSettings();
    setStatus('设置已保存在本机');
    toast('success', '设置已保存在本机');
  } catch (error) {
    setStatus(`保存设置失败：${error.message}`, true);
    toast('error', `保存失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function exportData(format, sourceId) {
  const button = document.querySelector(sourceId || (format === 'json' ? '#export-json' : '#export-csv'));
  button.disabled = true;
  try {
    const response = await send({ type: format === 'json' ? 'memory.export.snapshot' : 'memory.export.feed' });
    if (!response?.ok) throw new Error(response?.error?.message || '导出失败');
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    let content;
    let type;
    let extension;
    if (format === 'json') {
      content = JSON.stringify({ format: 'x-memory-snapshot', version: 1, exportedAt: new Date().toISOString(), data: response.data }, null, 2);
      type = 'application/json';
      extension = 'json';
    } else {
      const rows = response.data.map((item) => {
        const entities = [item.post, ...item.observations, ...item.visits].filter(Boolean);
        const payload = Object.assign({}, ...entities.reverse().map((entity) => entity.payload || {}));
        return [item.id, payload.text || '', payload.authorName || '', payload.authorHandle || '', payload.url || '', entities.some((entity) => entity.type === 'visit_event') ? 'true' : 'false'];
      });
      content = [['post_id', 'text', 'author_name', 'author_handle', 'url', 'visited'], ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      type = 'text/csv;charset=utf-8';
      extension = 'csv';
    }
    downloadText(content, `x-memory-export-${date}.${extension}`, type);
    setStatus(`${format.toUpperCase()} 数据已导出`);
    toast('success', `${format.toUpperCase()} 数据已导出`);
  } catch (error) {
    setStatus(`导出失败：${error.message}`, true);
    toast('error', `导出失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadText(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function syncNow() {
  const button = document.querySelector('#sync-now');
  button.disabled = true;
  setStatus('正在与 S3 同步…');
  try {
    const response = await send({ type: 'memory.sync.run' });
    if (!response?.ok) throw new Error(response?.error?.message || 'S3 同步失败');
    await loadRecords();
    setStatus(`S3 同步完成 · ${response.data.uploaded} 条记录`);
    toast('success', `S3 同步完成 · ${response.data.uploaded} 条记录`);
  } catch (error) {
    setStatus(`S3 同步失败：${error.message}`, true);
    toast('error', `S3 同步失败：${error.message}。本地数据未受影响。`);
  } finally {
    button.disabled = false;
  }
}

async function refreshRecords() {
  refreshButton.classList.add('is-spinning');
  setStatus('正在同步当前页面…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /^https:\/\/(x\.com|twitter\.com)\//.test(tab.url || '')) {
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: 'memory.capture.current' });
      } catch (error) {
        if (!error.message.includes('Receiving end does not exist')) throw error;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['apps/extension/content.js'] });
        response = await chrome.tabs.sendMessage(tab.id, { type: 'memory.capture.current' });
      }
      if (!response?.ok) throw new Error(response?.error || '无法采集当前页面');
    }
    await loadRecords();
  } catch (error) {
    await loadRecords();
    setStatus(`当前页面同步失败：${error.message}；请刷新 X 页面后重试`, true);
  } finally {
    refreshButton.classList.remove('is-spinning');
  }
}

let updateTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('xmemory.theme' in changes) {
    applyTheme(changes['xmemory.theme'].newValue === 'dark' ? 'dark' : 'light');
  }
  if (!Object.keys(changes).some((key) => key.startsWith('xmemory.') && key !== 'xmemory.theme')) return;
  clearTimeout(updateTimer);
  updateTimer = setTimeout(loadRecords, 250);
});

loadTheme();
refreshRecords();
loadSettings();
loadDailyDigest();
