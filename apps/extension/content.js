(() => {
  const seen = new Set();

  function statusIdFromUrl(url = location.href) {
    const match = String(url).match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  }

  function captureVisibleTimeline() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const link = [...article.querySelectorAll('a[href*="/status/"]')]
        .map((node) => node.href.match(/\/status\/(\d+)/)?.[1])
        .find(Boolean);
      if (!link || seen.has(link)) continue;
      seen.add(link);
      chrome.runtime.sendMessage({
        type: 'rewind.capture',
        post: { id: link, url: `https://x.com/i/status/${link}`, text: article.innerText.slice(0, 12000) },
        observationId: `page:${Date.now()}:${link}`
      }).catch(() => {});
    }
  }

  function captureDetail() {
    const postId = statusIdFromUrl();
    if (!postId) return;
    chrome.runtime.sendMessage({
      type: 'footprints.upsert',
      visit: { id: `${location.hostname}:${postId}:${Date.now()}`, postId, url: location.href, visitedAt: new Date().toISOString() }
    }).catch(() => {});
  }

  captureVisibleTimeline();
  captureDetail();
  new MutationObserver(() => captureVisibleTimeline()).observe(document.documentElement, { childList: true, subtree: true });
})();
