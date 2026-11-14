const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const records = document.querySelector('#records');
const template = document.querySelector('#record-template');

document.querySelector('#refresh').addEventListener('click', loadRecords);

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function formatTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
}

function textFrom(entity) {
  const payload = entity.payload ?? {};
  return payload.text || payload.url || payload.postId || entity.id;
}

function addRecord(entity) {
  const node = template.content.cloneNode(true);
  const record = node.querySelector('.record');
  const payload = entity.payload ?? {};
  const isVisit = entity.type === 'visit_event';
  node.querySelector('.record-meta').textContent = isVisit ? '访问足迹' : '时间线';
  node.querySelector('.record-title').textContent = payload.authorName || payload.postId || entity.id;
  node.querySelector('.record-body').textContent = textFrom(entity);
  node.querySelector('.record-time').textContent = formatTime(entity.observedAt || entity.updatedAt);
  if (isVisit) record.classList.add('visit');
  records.append(node);
}

async function loadRecords() {
  status.textContent = '正在读取本地记录…';
  status.className = 'status';
  records.replaceChildren();
  summary.hidden = true;
  try {
    const response = await send({ type: 'memory.query.search', query: '', limit: 100 });
    if (!response?.ok) throw new Error(response?.error?.message || '读取失败');
    const entities = response.data ?? [];
    const posts = entities.filter((entity) => entity.type === 'post' || entity.type === 'timeline_observation');
    const visits = entities.filter((entity) => entity.type === 'visit_event');
    summary.textContent = `时间线 ${posts.length} · 访问足迹 ${visits.length}`;
    summary.hidden = false;
    if (!entities.length) {
      status.textContent = '还没有本地记录。打开 X 页面后，插件会自动采集可见内容。';
      status.className = 'status empty';
      return;
    }
    status.textContent = `${entities.length} 条本地记录`;
    for (const entity of entities) addRecord(entity);
  } catch (error) {
    status.textContent = `读取失败：${error.message}`;
    status.className = 'status error';
  }
}

loadRecords();
