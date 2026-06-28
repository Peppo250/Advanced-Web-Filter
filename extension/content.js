/* content.js
   Enforces a strict, sequential three-level filtering pipeline:
   - Level 1: Domain Whitelist/Blacklist + Suspicious Domain Heuristics
   - Level 2: Page Path Keywords + ML URL/Title Intent Classification
   - Level 3: Leaf-Node Element Removal (Ads/Images) + ML Paragraph Classification
   Also intercepts click redirects, overrides window.open in the page context with synced settings,
   and automatically removes intrusive overlays/fake push notifications.
*/

// Fast-selectors for Level 3 element blocking
const ELEMENT_BLOCK_SELECTORS = [
  'iframe[src*="ad"]', 'iframe[src*="click"]', 'iframe[src*="doubleclick"]',
  'iframe[id*="ad"]', 'iframe[class*="ad"]',
  'div[class*="ad"]', 'div[class*="ads"]', 'div[class*="ad-unit"]', 'div[class*="adcontainer"]',
  'div[id*="ad"]', 'div[id*="adcontainer"]', 'div[id*="native-ad"]', 'div[class*="native-ad"]',
  '[class*="sponsor"]', 'a[href*="adult"]', 'a[href*="click"]',
  'ins.adsbygoogle', '[class*="banner"]', '[id*="banner"]',
  '[class*="popunder"]', '[id*="popunder"]', '[class*="-advert-"]',
  '[class*="advertisement"]', '[id*="advertisement"]'
];

let settings = {
  enabled: true,
  mlserver: "http://127.0.0.1:5000",
  blockedDomains: ["badsite-example.com", "unsafe-example.com", "blocked-example.com", "scheck.amtso.org", "eicar.org", "secure.eicar.org"],
  allowedDomains: ["wikipedia.org", "github.com", "stackoverflow.com"],
  blockedKeywords: ["ecchi", "adult", "uncensored", "18+", "nsfw", "porn"],
};

let pageIsBlocked = false;
const PAGE_INTENT_BLOCK_PROB = 0.80;
const PARAGRAPH_BLOCK_PROB = 0.80;
const PARAGRAPH_MIN_CHARS = 160;

const SUSPICION_WORDS = [
  'sex','virgin','porn','erotic','hentai','uncensored','adult','nude','intimate','masturbat','bareback','hardcore','ecchi','nsfw'
];

// Helper: Extract domain
function getDomain(hostname) {
  return (hostname || '').replace(/^www\./, '').toLowerCase();
}

// Helper: Escape HTML content
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// === Pop-up window.open Interception ===
// Overrides window.open in page context with synchronized storage lists
function injectPopupBlocker() {
  try {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const blockedDomains = ${JSON.stringify(settings.blockedDomains)};
        const blockedKeywords = ${JSON.stringify(settings.blockedKeywords)};
        const originalOpen = window.open;
        window.open = function(url, name, specs, replace) {
          if (!url) return originalOpen.apply(this, arguments);
          const lowerUrl = url.toLowerCase();
          
          // Check keywords
          const isSuspicious = blockedKeywords.some(kw => lowerUrl.includes(kw)) ||
                               ["hentai", "porn", "click", "ad", "redirect", "popunder", "cpm"].some(kw => lowerUrl.includes(kw));
          
          // Check domains
          let isBlockedDomain = false;
          try {
            const domain = (url.replace(/^https?:\\/\\//, '').split('/')[0]).replace(/^www\\./, '').toLowerCase();
            isBlockedDomain = blockedDomains.includes(domain) || 
                              domain.includes('click') || 
                              domain.includes('adserver') || 
                              domain.includes('popunder') ||
                              domain.includes('onclick');
          } catch(e) {}
          
          if (isSuspicious || isBlockedDomain) {
            console.warn('[Advanced Web Filter] Blocked script-based popup to:', url);
            return null;
          }
          return originalOpen.apply(this, arguments);
        };
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (e) {
    console.error('Failed to inject popup blocker:', e);
  }
}

// === Synchronous Level 1 Check (Immediate) ===
// Blocks known bad hostnames instantly on script load without waiting for storage IPC
(function immediateDomainCheck() {
  try {
    const domain = getDomain(location.hostname);
    const defaultBlocked = ["badsite-example.com", "unsafe-example.com", "blocked-example.com", "scheck.amtso.org", "eicar.org", "secure.eicar.org"];
    if (defaultBlocked.includes(domain) || domain.includes('hentai') || domain.includes('porn')) {
      blockWholePage('This website is blocked by Advanced Web Filter.');
      pageIsBlocked = true;
    }
  } catch(e) {}
})();

// 1. Initial Load: Read settings and run early domain & keyword filters
chrome.storage.local.get(['enabled', 'mlserver', 'blockedDomains', 'allowedDomains', 'blockedKeywords'], (items) => {
  if (items.enabled !== undefined) settings.enabled = items.enabled;
  if (items.mlserver) settings.mlserver = items.mlserver;
  if (items.blockedDomains) settings.blockedDomains = items.blockedDomains;
  if (items.allowedDomains) settings.allowedDomains = items.allowedDomains;
  if (items.blockedKeywords) settings.blockedKeywords = items.blockedKeywords;

  if (!settings.enabled) return;

  // Inject popup blocker with latest settings
  injectPopupBlocker();

  // Run Level 1: Domain check
  runLevel1Check();

  if (pageIsBlocked) return;

  // Run Level 2: Page path keywords (immediate)
  runLevel2PathKeywordCheck();
});

// === LEVEL 1: Domain-Level Filtering ===
function runLevel1Check() {
  try {
    const domain = getDomain(location.hostname);
    
    // Explicit blacklist match
    if (settings.blockedDomains.includes(domain)) {
      blockWholePage('This website is blocked by Advanced Web Filter (domain blacklist).');
      pageIsBlocked = true;
      return;
    }
    
    // Whitelist check: If it is on the whitelist, skip early suspicious heuristics
    if (settings.allowedDomains.includes(domain)) {
      return;
    }

    // Heuristics: Flag domain names that explicitly contain explicit/blocked phrases
    if (domain.includes('hentai') || domain.includes('porn')) {
      blockWholePage('This website is blocked by Advanced Web Filter (suspicious domain heuristic).');
      pageIsBlocked = true;
    }
  } catch (e) {
    console.error('[Level 1] Domain Check Error:', e);
  }
}

// === LEVEL 2: Webpage-Level Path/URL Filtering ===
function runLevel2PathKeywordCheck() {
  try {
    const path = decodeURIComponent((location.pathname + location.search || '')).toLowerCase();
    for (let kw of settings.blockedKeywords) {
      if (path.includes(kw)) {
        blockWholePage(`This page is blocked by Advanced Web Filter (page keyword policy: "${kw}").`);
        pageIsBlocked = true;
        return;
      }
    }
  } catch (e) {
    console.error('[Level 2] Path Keyword Check Error:', e);
  }
}

// Run Level 2 ML URL Check on DOMContentLoaded (so we can get page title info)
function runLevel2MlPageCheck() {
  if (pageIsBlocked || !settings.enabled) return;

  try {
    chrome.runtime.sendMessage({
      type: 'checkPageWithML',
      url: location.href,
      title: document.title
    }, (resp) => {
      if (pageIsBlocked) return;
      if (resp && resp.ok && resp.data) {
        const d = resp.data;
        if (d.decision === 'block' && (d.prob || 0) >= PAGE_INTENT_BLOCK_PROB) {
          blockWholePage('This page was classified as adult/suspicious by the ML page-intent filter.');
          pageIsBlocked = true;
        }
      }
    });
  } catch (e) {
    console.error('[Level 2] ML Check Error:', e);
  }
}

// Helper: Replace the document with a block screen
function blockWholePage(msg) {
  try {
    document.documentElement.innerHTML =
      `<head>
         <meta charset="utf-8">
         <title>Blocked | Advanced Web Filter</title>
         <style>
           body {
             font-family: 'Segoe UI', Arial, sans-serif;
             background: radial-gradient(circle at center, #1a1a2e 0%, #0f0f1b 100%);
             color: #ffffff;
             display: flex;
             align-items: center;
             justify-content: center;
             height: 100vh;
             margin: 0;
           }
           .card {
             background: rgba(255, 255, 255, 0.03);
             backdrop-filter: blur(10px);
             border: 1px solid rgba(255, 255, 255, 0.08);
             padding: 40px;
             border-radius: 16px;
             text-align: center;
             max-width: 500px;
             box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
           }
           h1 {
             color: #ff3b30;
             margin-top: 0;
             font-size: 28px;
             letter-spacing: 0.5px;
           }
           p {
             color: #a0aec0;
             line-height: 1.6;
             font-size: 15px;
           }
           .logo {
             font-size: 48px;
             margin-bottom: 20px;
           }
         </style>
       </head>
       <body>
         <div class="card">
           <div class="logo">🛡️</div>
           <h1>Access Blocked</h1>
           <p>${escapeHtml(msg)}</p>
         </div>
       </body>`;
  } catch (e) {
    console.error('blockWholePage error', e);
  }
}

// === LEVEL 3: Page Element & Paragraph Filtering ===
function runLevel3Check() {
  if (pageIsBlocked || !settings.enabled) return;

  try {
    // 1) Element filtering (Fast selectors)
    ELEMENT_BLOCK_SELECTORS.forEach(sel => {
      try { 
        document.querySelectorAll(sel).forEach(el => el.remove()); 
      } catch (e) {}
    });

    // Remove images with alt/src matching blacklisted keywords
    document.querySelectorAll('img').forEach(img => {
      const check = ((img.alt || '') + ' ' + (img.title || '') + ' ' + (img.src || '')).toLowerCase();
      if (check.includes('hentai') || check.includes('nsfw') || check.includes('adult') || check.includes('uncensored')) {
        img.remove();
      }
    });

    // Remove pop-up onclick scripts
    document.querySelectorAll('[onclick]').forEach(el => {
      const onclick = (el.getAttribute('onclick') || '').toLowerCase();
      if (onclick.includes('popup') || onclick.includes('open') || onclick.includes('ad')) {
        el.remove();
      }
    });

    // 2) Paragraph content checks
    const blocks = collectLeafTextBlocks();
    blocks.forEach(block => {
      const text = block.textContent || '';
      if (!text) return;

      const heuristicScore = computeHeuristicScore(text);

      // Re-ordered logical fallbacks:
      if (heuristicScore >= 0.95) {
        // Immediate block for extremely high heuristic suspicion
        hideBlock(block, 'heuristic block');
      } else if (heuristicScore >= 0.5) {
        // Moderate score: request ML verification from Flask server
        chrome.runtime.sendMessage({ type: 'classifyParagraph', text }, (resp) => {
          try {
            if (pageIsBlocked) return;
            if (resp && resp.ok && resp.data) {
              const d = resp.data;
              if ((d.label === 'explicit' || d.label === 'suggestive') && (d.prob || 0) >= PARAGRAPH_BLOCK_PROB) {
                hideBlock(block, d.label);
              }
            } else {
              // ML unavailable: fallback to block if heuristic is high (>= 0.80)
              if (heuristicScore >= 0.80) {
                hideBlock(block, 'heuristic fallback');
              }
            }
          } catch (e) {
            console.error('Paragraph ML callback error', e);
          }
        });
      }
    });

  } catch (e) {
    console.error('[Level 3] Element Check Error:', e);
  }
}

// Collect only leaf text blocks to prevent breaking parent container layouts
function collectLeafTextBlocks(rootNode = document) {
  const blocks = [];
  try {
    // Target specific content containers
    const candidates = rootNode.querySelectorAll('p, li, blockquote, div');
    
    candidates.forEach(el => {
      // Skip common UI and navigation sections
      if (el.closest('header, footer, nav, .sidebar, .comments, #status, #popup')) return;
      
      // If it's a DIV, ensure it does not contain nested element nodes (is a leaf container)
      if (el.tagName === 'DIV' && el.children.length > 0) return;
      
      const txt = (el.textContent || '').trim();
      if (txt.length >= PARAGRAPH_MIN_CHARS && txt.length <= 3000) {
        blocks.push(el);
      }
    });
  } catch (e) {
    console.error('Error collecting leaf blocks:', e);
  }

  // Deduplicate by text content
  const seen = new Set();
  const out = [];
  blocks.forEach(b => {
    const txt = b.textContent.trim().slice(0, 100);
    if (!txt || seen.has(txt)) return;
    seen.add(txt);
    out.push(b);
  });
  
  return out;
}

// Heuristic bag-of-words scoring
function computeHeuristicScore(text) {
  try {
    const s = text.toLowerCase();
    let hits = 0;
    SUSPICION_WORDS.forEach(w => { 
      if (s.includes(w)) hits += 1; 
    });
    
    const lenScore = Math.min(1, s.length / 2000); 
    const wordScore = Math.min(1, hits / 6);
    const heavy = (s.includes('virgin') || s.includes('porn') || s.includes('uncensored')) ? 0.35 : 0;
    
    return Math.min(1, 0.6 * wordScore + 0.3 * lenScore + heavy);
  } catch (e) { 
    return 0; 
  }
}

// Blur/hide block visually using a secure and non-destructive placeholder overlay
function hideBlock(el, reason) {
  try {
    // Avoid double-hiding
    if (el.dataset.filtered === 'true') return;
    el.dataset.filtered = 'true';

    // Apply smooth blur transition
    el.style.transition = 'filter 0.3s ease, opacity 0.3s ease';
    el.style.filter = 'blur(6px)';
    el.style.position = 'relative';

    // Create container overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(15, 15, 27, 0.95);
      border: 1px solid rgba(255, 59, 48, 0.3);
      border-radius: 8px;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 10px;
      box-sizing: border-box;
      z-index: 10;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center;
    `;
    
    overlay.innerHTML = `
      <div style="font-size: 14px; font-weight: bold; color: #ff3b30; margin-bottom: 4px;">🛡️ Content Hidden</div>
      <div style="font-size: 11px; color: #a0aec0;">Blocked by Advanced Web Filter (${escapeHtml(reason)})</div>
    `;

    // Make the text unselectable
    el.style.userSelect = 'none';

    // Wrap the leaf element in a relative container to overlay without layout breakage
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.style.width = '100%';
    
    if (el.parentNode) {
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      wrapper.appendChild(overlay);
    }
  } catch (e) {
    try { 
      el.remove(); 
    } catch (e2) {}
  }
}

// === LEVEL 3: Intrusive Overlays & Push Notifications Cleaner ===
// Removes full-screen interstitial overlays and fake robot checks position:fixed
function removeIntrusiveOverlays() {
  if (pageIsBlocked || !settings.enabled) return;

  try {
    const elements = document.querySelectorAll('div, section, ins');
    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (!style) return;

      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'absolute') return;

      const zIndex = parseInt(style.zIndex, 10);
      if (isNaN(zIndex) || zIndex < 100) return;

      const text = (el.textContent || '').trim().toLowerCase();

      // 1. Detect In-Page Push Notification Ads & Fake Robot Check overlays
      const hasPushKeywords = 
        (text.includes('allow') && (text.includes('notification') || text.includes('robot') || text.includes('human') || text.includes('continue'))) ||
        (text.includes('click') && text.includes('allow') && text.includes('robot')) ||
        (text.includes('show') && text.includes('notification'));

      if (hasPushKeywords) {
        console.warn('[Advanced Web Filter] Removed suspected in-page push ad:', el);
        el.remove();
        return;
      }

      // 2. Detect Full-Screen Interstitial Overlays
      const isFullScreen = 
        el.offsetWidth >= window.innerWidth * 0.9 && 
        el.offsetHeight >= window.innerHeight * 0.9;

      if (isFullScreen && zIndex > 1000) {
        // Find if the overlay contains close cross symbols or dismiss classes
        let hasCross = false;
        el.querySelectorAll('span, div, button').forEach(sub => {
          const t = sub.textContent.trim();
          if (t === '×' || t === 'x' || t === 'X' || t.toLowerCase() === 'close' || t.toLowerCase() === 'dismiss') {
            hasCross = true;
          }
        });

        const hasAdIframe = el.querySelector('iframe[src*="ad"], iframe[src*="click"]');
        const hasAdultLink = el.querySelector('a[href*="adult"], a[href*="click"], a[href*="clickunder"]');

        if (hasAdIframe || hasAdultLink || (hasCross && text.length < 500 && !el.contains(document.querySelector('main, article')))) {
          console.warn('[Advanced Web Filter] Removed suspected interstitial overlay:', el);
          el.remove();
          // Restore page scroll
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
        }
      }
    });
  } catch (e) {}
}

// === LEVEL 1 & 2: Click/Redirect Interception ===
// Intercepts click events on anchor links in capture phase to prevent malicious redirects
document.addEventListener('click', (e) => {
  if (!settings.enabled) return;
  
  const anchor = e.target.closest('a');
  if (anchor && anchor.href) {
    const href = anchor.href.toLowerCase();
    
    try {
      const urlObj = new URL(anchor.href);
      const linkDomain = getDomain(urlObj.hostname);
      
      // Level 1: Block link navigations to blacklisted/suspicious hostnames
      if (settings.blockedDomains.includes(linkDomain) || 
          (!settings.allowedDomains.includes(linkDomain) && (linkDomain.includes('hentai') || linkDomain.includes('porn')))) {
        e.preventDefault();
        alert('[Advanced Web Filter] Blocked navigation to a blacklisted domain.');
        return;
      }
    } catch(err) {}

    // Level 2: Block link navigations matching path keyword policies
    for (let kw of settings.blockedKeywords) {
      if (href.includes(kw)) {
        e.preventDefault();
        alert(`[Advanced Web Filter] Blocked navigation containing keyword: "${kw}"`);
        return;
      }
    }
  }
}, true); // Capture phase early interception

// === PIPELINE EXECUTION ===
window.addEventListener('DOMContentLoaded', () => {
  // Level 2 Check: Call Flask ML server with full page context
  runLevel2MlPageCheck();
  
  // Level 3 Check: Filter elements & text on load
  runLevel3Check();

  // Overlays check
  removeIntrusiveOverlays();

  // Setup MutationObserver to scan dynamically loaded content (SPA support)
  setupDynamicObserver();
});

// Run periodic overlay cleanup during page load
for (let delay of [500, 1000, 2000, 4000]) {
  setTimeout(removeIntrusiveOverlays, delay);
}

// Throttled dynamic mutation scanner
let scanTimeout = null;
function setupDynamicObserver() {
  if (pageIsBlocked || !settings.enabled) return;

  try {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (let mut of mutations) {
        if (mut.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }

      if (shouldScan) {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          if (pageIsBlocked) return;
          runLevel3Check();
          removeIntrusiveOverlays();
        }, 300);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.error('MutationObserver setup failed:', e);
  }
}
