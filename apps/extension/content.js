(() => {
  if (globalThis.__xMemoryCaptureActive) return;
  globalThis.__xMemoryCaptureActive = true;
  const captured = new Map();
  const pending = new Map();
  let captureTimer = null;
  const watched = new Set();

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
      const request = chrome.runtime.sendMessage({
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

  const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      captureArticle(entry.target)?.catch(() => {});
      setTimeout(() => {
        if (entry.target.isConnected) captureArticle(entry.target)?.catch(() => {});
      }, 1500);
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  function captureVisibleTimeline() {
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
    const postId = statusIdFromUrl();
    if (!postId) return;
    const article = document.querySelector('article[data-testid="tweet"]');
    const link = absoluteUrl(location.href);
    const post = article ? postFrom(article, postId, link) : { id: postId, url: link };
    chrome.runtime.sendMessage({
      type: 'footprints.upsert',
      visit: { id: `${location.hostname}:${postId}:${Date.now()}`, postId, ...post, visitedAt: new Date().toISOString() }
    }).catch(() => {});
  }

  let scanQueued = false;
  function scheduleCapture() {
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
  new MutationObserver(scheduleCapture).observe(document.documentElement, { childList: true, subtree: true });
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      scheduleCapture();
    }
  }, 500);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
})();
