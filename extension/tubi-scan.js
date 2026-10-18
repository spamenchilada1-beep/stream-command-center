async function scanTubiInPage() {
  const selectors = [
    '[class*="tile"] img[alt]:not([alt=""])',
    'a[href*="/tv-shows/"] img[alt], a[href*="/series/"] img[alt], a[href*="/movies/"] img[alt]',
  ];
  const noise = new Set([
    'play', 'more info', 'add to my list', 'remove', 'logo', 'image', 'thumbnail',
    'poster', 'loading', 'my list', 'home', 'search', 'watch list', 'watchlist',
  ]);
  const startY = window.scrollY;
  let lastHeight = -1;
  for (let i = 0; i < 25 && document.body.scrollHeight !== lastHeight; i += 1) {
    lastHeight = document.body.scrollHeight;
    window.scrollBy(0, 1600);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  window.scrollTo(0, startY);
  await new Promise(resolve => setTimeout(resolve, 300));

  const titles = [];
  let selectorUsed = '';
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const title = String(
        element.getAttribute('alt') ||
        element.closest('a[href]')?.getAttribute('aria-label') ||
        element.closest('a[href]')?.getAttribute('title') ||
        '',
      ).replace(/\s+/g, ' ').trim();
      if (!title || title.length > 300 || noise.has(title.toLowerCase()) || titles.includes(title)) continue;
      titles.push(title);
    }
    if (titles.length) {
      selectorUsed = selector;
      break;
    }
  }

  return {
    items: titles.map(title => ({
      id: 'saved-tubi-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title,
      type: 'Series',
      provider: 'Tubi',
    })),
    diagnostics: {
      provider: 'Tubi',
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      selectorUsed,
      selectorCounts: {
        primary: document.querySelectorAll(selectors[0]).length,
        secondary: document.querySelectorAll(selectors[1]).length,
      },
      watchLinkCount: document.querySelectorAll('a[href*="/watch/"], a[href*="/title/"], a[href*="/video/"]').length,
      ariaLabelCount: document.querySelectorAll('[aria-label]').length,
    },
  };
}
