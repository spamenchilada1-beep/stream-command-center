const MY_LIST_SECTION_SELECTORS = [
  '[data-uia="browse-page-sections"] > section[data-uia="carousel-row-section-1"]',
  '[data-uia="browse-page-sections"] section[data-uia="carousel-row-section-1"]',
  'section[data-uia="carousel-row-section-1"]',
];

const TITLE_SELECTORS = [
  'a[data-uia="standard-card"][href]',
  '.galleryLockups .rowContainer.rowContainer_title_card .slider-item .ptrack-content a[aria-label]',
  '.slider-item .slider-refocus[aria-label]',
  '.slider-item a[aria-label]',
  '.slider-refocus[aria-label]',
  '.title-card a[aria-label]',
  '.title-card[aria-label]',
  '.slider a[aria-label]',
  'a[href*="/watch/"][aria-label]',
  'a[href*="/title/"][aria-label]',
  '.boxart-container',
];

function cleanTitle(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanTitle(value);
  if (!title || title.length > 300) return '';
  if (/^(home|shows|movies|games|new & popular|my list|browse by languages|search)$/i.test(title)) return '';
  return title;
}

function getNetflixItems(section) {
  const items = [];
  const seen = new Set();
  const cards = section
    ? section.querySelectorAll('a[data-uia="standard-card"][href]')
    : document.querySelectorAll('a[data-uia="standard-card"][href]');

  cards.forEach(card => {
    const href = card.getAttribute('href') || '';
    const url = new URL(href, location.href);
    const videoId = url.searchParams.get('jbv') || href.match(/\/title\/(\d+)/)?.[1] || '';
    const title = normalizeTitle(
      card.getAttribute('aria-label') ||
      card.getAttribute('title') ||
      card.querySelector('img')?.getAttribute('alt') ||
      '',
    );

    if (!videoId || !title) return;

    const id = `netflix-${videoId}`;
    if (seen.has(id)) return;
    seen.add(id);

    items.push({
      id,
      title,
      type: 'Series',
      provider: 'Netflix',
    });
  });

  return items;
}

function findMyListSection() {
  for (const selector of MY_LIST_SECTION_SELECTORS) {
    const section = document.querySelector(selector);
    if (section) return section;
  }

  const sections = document.querySelectorAll('[data-uia="browse-page-sections"] section');
  for (const section of sections) {
    const heading = cleanTitle(
      section.querySelector('h2, [data-uia*="section+title"]')?.textContent || '',
    );
    if (/\bmy list\b/i.test(heading)) return section;
  }

  return null;
}

async function waitForNetflixItems(timeoutMs = 12000) {
  const started = Date.now();
  const seen = new Map();
  let section = findMyListSection();

  while (Date.now() - started < timeoutMs) {
    section = section?.isConnected ? section : findMyListSection();
    const items = getNetflixItems(section);

    for (const item of items) {
      if (!seen.has(item.id)) seen.set(item.id, item);
    }

    const rightButton = section?.querySelector('[data-uia="carousel-hawkins-right-button"]');
    const before = seen.size;

    if (rightButton && !rightButton.disabled) {
      rightButton.click();
      await new Promise(resolve => setTimeout(resolve, 350));
      if (seen.size === before && Date.now() - started > 3000) break;
    } else {
      await new Promise(resolve => setTimeout(resolve, 400));
      const initialRenderGraceExpired = Date.now() - started > 6000;
      if (seen.size === before && (seen.size > 0 || initialRenderGraceExpired)) break;
    }

    if (section && !rightButton && seen.size > 0) break;
  }

  const finalSection = section || findMyListSection();
  return {
    items: [...seen.values()],
    selectorCounts: {
      myListSection: finalSection ? 1 : 0,
      standardCards: finalSection
        ? finalSection.querySelectorAll('a[data-uia="standard-card"][href]').length
        : document.querySelectorAll('a[data-uia="standard-card"][href]').length,
    },
    watchLinkCount: document.querySelectorAll('a[href*="/watch/"]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:provider-scan') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  waitForNetflixItems()
    .then(scan => {
      sendProviderItems(message.nonce, scan.items, {
        providerId: 'netflix',
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        selectorCounts: scan.selectorCounts,
        watchLinkCount: scan.watchLinkCount,
        ariaLabelCount: scan.ariaLabelCount,
      }).catch(() => {});
    })
    .catch(() => {});

  sendResponse({ ok: true, accepted: true });
});
