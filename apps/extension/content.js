(() => {
  let runtime;
  let extensionId;
  try {
    runtime = globalThis.chrome?.runtime;
    extensionId = runtime?.id;
  } catch {
    return;
  }
  if (!extensionId) return;

  const previousController = globalThis.__xMemoryCaptureController;
  if (previousController) {
    let previousContextAlive = false;
    try {
      previousContextAlive = previousController.isAlive?.() === true;
    } catch {}
    if (previousController.extensionId === extensionId && previousContextAlive) return;
    try { previousController.stop?.(); } catch {}
  }

  const captured = new Map();
  const pending = new Map();
  let captureTimer = null;
  let routeTimer = null;
  let mutationObserver = null;
  let visibility = null;
  const watched = new Set();
  const controller = { extensionId, runtime, isAlive: null, stop: null };
  globalThis.__xMemoryCaptureController = controller;

  function contextIsAlive() {
    try {
      return Boolean(runtime?.id && typeof runtime.sendMessage === 'function' && runtime.getManifest());
    } catch {
      return false;
    }
  }

  function stopCapture() {
    try { visibility?.disconnect(); } catch {}
    try { mutationObserver?.disconnect(); } catch {}
    if (captureTimer) clearTimeout(captureTimer);
    if (routeTimer) clearInterval(routeTimer);
    captureTimer = null;
    routeTimer = null;
    watched.clear();
    if (globalThis.__xMemoryCaptureController === controller) {
      delete globalThis.__xMemoryCaptureController;
    }
  }

  controller.isAlive = () => contextIsAlive();
  controller.stop = stopCapture;

  function sendRuntimeMessage(message) {
    try {
      if (!contextIsAlive()) {
        stopCapture();
        return Promise.reject(new Error('Extension context is unavailable'));
      }
      return Promise.resolve(runtime.sendMessage(message)).catch((error) => {
        if (!contextIsAlive() || /extension context invalidated/i.test(error?.message || '')) stopCapture();
        throw error;
      });
    } catch (error) {
      if (!contextIsAlive() || /extension context invalidated/i.test(error?.message || '')) stopCapture();
      return Promise.reject(error);
    }
  }

  function statusIdFromUrl(url = location.href) {
    const match = String(url).match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  }

  function absoluteUrl(value) {
    try {
      const url = new URL(value, location.href);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function textFrom(article) {
    const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim();
    return (text || '').slice(0, 12000);
  }

  function authorFrom(article) {
    const block = article.querySelector('[data-testid="User-Name"]');
    const links = [...(block?.querySelectorAll('a[href]') ?? [])];
    const profileLink = links.find((link) => {
      try {
        return /^\/[^/]+$/.test(new URL(link.href).pathname);
      } catch {
        return false;
      }
    });
    const handle = profileLink?.getAttribute('href')?.replace(/^\//, '') || '';
    const lines = (block?.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
    return {
      authorName: lines[0] || '',
      authorHandle: handle,
      avatarUrl: absoluteUrl(article.querySelector('img[src*="profile_images"]')?.src || '')
    };
  }

  function mediaFrom(article) {
    const result = [];
    const seen = new Set();
    for (const image of article.querySelectorAll('img')) {
      const url = absoluteUrl(image.currentSrc || image.src || '');
      if (!url || !/pbs\.twimg\.com\/(media|amplify_video)/.test(url) || seen.has(url)) continue;
      seen.add(url);
      result.push({ url, alt: image.alt || '帖子图片' });
    }
    return result.slice(0, 4);
  }

  function postFrom(article, postId, link) {
    return {
      id: postId,
      url: link,
      text: textFrom(article),
      ...authorFrom(article),
      media: mediaFrom(article),
      capturedAt: new Date().toISOString()
    };
  }

  function captureArticle(article) {
    if (!contextIsAlive()) {
      stopCapture();
      return;
    }
    if (location.pathname !== '/home') return;
      const time = [...article.querySelectorAll('a[href*="/status/"] time')].find((node) => {
        const quote = node.closest('div[role="link"]');
        return !quote || !article.contains(quote);
      });
      const linkNode = time?.closest('a');
      const postId = linkNode?.href.match(/\/status\/(\d+)/)?.[1];
      if (!postId) return;
      const link = absoluteUrl(linkNode.href) || `https://x.com/i/status/${postId}`;
      const post = postFrom(article, postId, link);
      const fingerprint = JSON.stringify([post.text, post.authorName, post.media.map((item) => item.url)]);
      if (pending.has(postId)) {
        return pending.get(postId).then(() => article.isConnected ? captureArticle(article) : undefined);
      }
      if (captured.get(postId) === fingerprint) return;
      const request = sendRuntimeMessage({
        type: 'rewind.capture',
        post,
        observationId: `page:${Date.now()}:${postId}`
      }).then((response) => {
        if (!response?.ok) throw new Error(response?.error?.message || '保存失败');
        captured.set(postId, fingerprint);
      }).finally(() => pending.delete(postId));
      pending.set(postId, request);
      return request;
  }

  visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      captureArticle(entry.target)?.catch(() => {});
      setTimeout(() => {
        if (entry.target.isConnected) captureArticle(entry.target)?.catch(() => {});
      }, 1500);
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  function captureVisibleTimeline() {
    if (!contextIsAlive()) {
      stopCapture();
      return;
    }
    for (const article of watched) {
      if (!article.isConnected) {
        visibility.unobserve(article);
        watched.delete(article);
      }
    }
    if (location.pathname !== '/home') return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (!watched.has(article)) {
        watched.add(article);
        visibility.observe(article);
      }
      const rect = article.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < innerHeight) captureArticle(article)?.catch(() => {});
    }
  }

  function captureDetail() {
    if (!contextIsAlive()) {
      stopCapture();
      return;
    }
    const postId = statusIdFromUrl();
    if (!postId) return;
    const article = document.querySelector('article[data-testid="tweet"]');
    const link = absoluteUrl(location.href);
    const post = article ? postFrom(article, postId, link) : { id: postId, url: link };
    sendRuntimeMessage({
      type: 'footprints.upsert',
      visit: { id: `${location.hostname}:${postId}:${Date.now()}`, postId, ...post, visitedAt: new Date().toISOString() }
    }).catch(() => {});
  }

  let scanQueued = false;
  function scheduleCapture() {
    if (!contextIsAlive()) {
      stopCapture();
      return;
    }
    if (!scanQueued) {
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        captureVisibleTimeline();
      });
    }
    if (captureTimer) return;
    captureTimer = setTimeout(() => {
      captureTimer = null;
      captureDetail();
    }, 350);
  }

  captureVisibleTimeline();
  captureDetail();
  mutationObserver = new MutationObserver(scheduleCapture);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  let lastPath = location.pathname;
  routeTimer = setInterval(() => {
    if (!contextIsAlive()) {
      stopCapture();
      return;
    }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      scheduleCapture();
    }
  }, 500);
  try {
    runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!contextIsAlive()) {
        stopCapture();
        return;
      }
      if (message?.type !== 'memory.capture.current') return;
      if (location.pathname !== '/home') {
        sendResponse({ ok: false, error: '请先打开 X 首页' });
        return;
      }
      const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const requests = articles.filter((article) => {
        const rect = article.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      }).map(captureArticle).filter(Boolean);
      Promise.all(requests).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    });
  } catch {
    stopCapture();
  }
})();
