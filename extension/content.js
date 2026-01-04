/* content.js
   Runs at document_start — domain & page checks; DOMContentLoaded -> element + paragraph checks.
*/

// === Embedded simple lists (you can expand these JSON files in extension/data/) ===
const BLOCKED_DOMAINS = [
  "nhentai.net", "hentaihaven.xxx", "hentai.example"
];
const ALLOWED_DOMAINS = [
  "crunchyroll.com", "9anime.to", "animeflix.example"
];

const PAGE_BLOCK_KEYWORDS = [
  "ecchi","adult","uncensored","18+","nsfw","porn"
];

const ELEMENT_BLOCK_SELECTORS = [
  'iframe', 'div[class*="ad"]', 'div[class*="ads"]',
  '[class*="sponsor"]', '[id*="ad"]', 'a[href*="adult"]'
];

// Thresholds (tunable)
const PAGE_INTENT_BLOCK_PROB = 0.80;   // if ML says sexual intent >= this -> block page
const PARAGRAPH_BLOCK_PROB = 0.80;     // if paragraph classified as suggestive/explicit >= this -> hide paragraph
const PARAGRAPH_MIN_CHARS = 160;       // only classify paragraphs longer than this

// fallback heuristic word list for "suspicion" scoring (used when ML offline)
const SUSPICION_WORDS = [
  'sex','virgin','porn','erotic','hentai','uncensored','adult','nude','intimate','masturbat','bareback','hardcore','ecchi','nsfw'
];

// helper
function getDomain(hostname) {
  return (hostname || '').replace(/^www\./,'').toLowerCase();
}

// immediate domain-level check
(function domainCheck() {
  try {
    const domain = getDomain(location.hostname);
    if (BLOCKED_DOMAINS.includes(domain)) {
      blockWholePage('This site is blocked by Anime Safe Filter (domain policy).');
      return;
    }
  } catch(e) {
    console.error('domainCheck error', e);
  }
})();

// immediate page-level keyword check (path/title/meta)
(function pageKeywordCheck() {
  try {
    const path = decodeURIComponent((location.pathname + location.search || '')).toLowerCase();
    for (let kw of PAGE_BLOCK_KEYWORDS) {
      if (path.includes(kw)) {
        blockWholePage(`This page is blocked by Anime Safe Filter (page policy: ${kw}).`);
        return;
      }
    }
  } catch(e) {
    console.error('pageKeywordCheck error', e);
  }
})();

// Ask ML server for page intent (if available); fallback to heuristics
(function pageIntentCheck() {
  try {
    chrome.runtime.sendMessage({ type: 'checkPageWithML', url: location.href }, (resp) => {
      if (!resp) return;
      if (resp.ok && resp.data) {
        // expected data: { decision: 'block'|'allow'|'unknown', prob: 0.xx, label: 'sexual' }
        const d = resp.data;
        if (d.decision === 'block' && (d.prob || 0) >= PAGE_INTENT_BLOCK_PROB) {
          blockWholePage('This page was classified as adult/suspicious by the optional ML server.');
        }
      } else {
        // ml-unavailable -> no action now; DOM processing will apply heuristics
      }
    });
  } catch(e) {
    console.error('pageIntentCheck error', e);
  }
})();

// helper: replace the document with a block page
function blockWholePage(msg) {
  try {
    document.documentElement.innerHTML =
      `<head><meta charset="utf-8"><title>Blocked</title></head>
       <body style="font-family: Arial, sans-serif; display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;">
         <div style="text-align:center;max-width:720px;padding:24px;">
           <h1>Content blocked</h1>
           <p>${escapeHtml(msg)}</p>
         </div>
       </body>`;
  } catch(e) { console.error('blockWholePage error', e); }
}

// small escape helper
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Wait for DOM to do element filtering and paragraph-level checks
window.addEventListener('DOMContentLoaded', () => {
  try {
    // 1) Rule-based element removal (fast)
    ELEMENT_BLOCK_SELECTORS.forEach(sel => {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
    });

    // Remove images with NSFW-like keywords in alt/title/src
    document.querySelectorAll('img').forEach(img => {
      const check = ((img.alt || '') + ' ' + (img.title || '') + ' ' + (img.src || '')).toLowerCase();
      if (check.includes('hentai') || check.includes('nsfw') || check.includes('adult') || check.includes('uncensored')) {
        img.remove();
      }
    });

    // remove onclick-ad popups heuristics
    document.querySelectorAll('[onclick]').forEach(el => {
      const onclick = (el.getAttribute('onclick') || '').toLowerCase();
      if (onclick.includes('popup') || onclick.includes('open') || onclick.includes('ad')) {
        el.remove();
      }
    });

    // 2) Paragraph-level semantic checking (text blocks)
    const blocks = collectTextBlocks();
    blocks.forEach(block => {
      const text = block.innerText || block.textContent || '';
      if (!text) return;
      if (text.length < PARAGRAPH_MIN_CHARS) return; // skip short UI text

      // First compute lightweight heuristic suspicion score
      const heuristicScore = computeHeuristicScore(text);

      // If heuristic high enough, try ML; otherwise if heuristic low, skip ML
      if (heuristicScore >= 0.5) {
        // ask ML server to classify the paragraph
        chrome.runtime.sendMessage({ type: 'classifyParagraph', text }, (resp) => {
          try {
            if (!resp) return;
            if (resp.ok && resp.data) {
              // expected data: { label: 'safe'|'suggestive'|'explicit', prob: 0.xx }
              const d = resp.data;
              if ((d.label === 'explicit' || d.label === 'suggestive') && (d.prob || 0) >= PARAGRAPH_BLOCK_PROB) {
                hideBlock(block, d.label);
                return;
              }
            } else {
              // ML unavailable -> fallback: block if heuristic very high
              if (heuristicScore >= 0.85) hideBlock(block, 'suggestive-fallback');
            }
          } catch(e) { console.error('classifyParagraph callback error', e); }
        });
      } else {
        // low heuristic -> no ML call. But if heuristic extremely high -> hide immediately
        if (heuristicScore >= 0.95) hideBlock(block, 'suggestive-fallback');
      }
    });

  } catch(e) {
    console.error('DOMContentLoaded handler error', e);
  }
});

// collect candidate text blocks to classify
function collectTextBlocks() {
  const tags = ['article','main','section','div','p'];
  const blocks = [];
  try {
    // prefer semantic elements
    tags.forEach(tag => {
      document.querySelectorAll(tag).forEach(el => {
        // skip elements inside headers/footers/nav
        if (el.closest('header, footer, nav, .sidebar')) return;
        // avoid hidden elements
        const style = window.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
        blocks.push(el);
      });
    });
  } catch(e) {}
  // dedupe by unique text snippet
  const seen = new Set();
  const out = [];
  blocks.forEach(b => {
    const txt = (b.innerText || '').trim().slice(0,200);
    if (!txt) return;
    if (seen.has(txt)) return;
    seen.add(txt);
    out.push(b);
  });
  return out;
}

// heuristic suspicion scoring (simple bag-of-words + density)
function computeHeuristicScore(text) {
  try {
    const s = text.toLowerCase();
    let hits = 0;
    SUSPICION_WORDS.forEach(w => { if (s.includes(w)) hits += 1; });
    // length-normalized score
    const lenScore = Math.min(1, s.length / 2000); // long text tends to be narrative
    const wordScore = Math.min(1, hits / 6);
    // if paragraph contains words like 'virgin' or 'porn' weight higher
    const heavy = (s.includes('virgin') || s.includes('porn') || s.includes('uncensored')) ? 0.35 : 0;
    // final
    const score = Math.min(1, 0.6 * wordScore + 0.3 * lenScore + heavy);
    return score;
  } catch(e) { return 0; }
}

// hide/blur block visually and add placeholder
function hideBlock(el, reason) {
  try {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'background:#111;color:#fff;padding:18px;border-radius:6px;text-align:center;font-family:Arial, sans-serif;';
    placeholder.innerHTML = `<strong>Content hidden</strong><div style="font-size:90%;margin-top:6px;">This content was hidden by Anime Safe Filter (${escapeHtml(reason)}).</div>`;
    // replace element content
    el.style.transition = 'opacity 0.25s ease';
    el.style.opacity = '0';
    setTimeout(() => {
      try {
        el.innerHTML = '';
        el.appendChild(placeholder);
        el.style.opacity = '1';
      } catch(e) {}
    }, 220);
  } catch(e){
    try { el.remove(); } catch(e2) {}
  }
}
