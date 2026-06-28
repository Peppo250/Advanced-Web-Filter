// background.js — message broker + ML gateway with storage-aware ML server URL
const DEFAULT_ML_SERVER = "http://127.0.0.1:5000";
let mlServer = DEFAULT_ML_SERVER;
let extensionEnabled = true;

// Initialize default storage values upon installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['enabled', 'mlserver', 'blockedDomains', 'allowedDomains', 'blockedKeywords'], (items) => {
    const defaults = {};
    if (items.enabled === undefined) defaults.enabled = true;
    if (items.mlserver === undefined) defaults.mlserver = DEFAULT_ML_SERVER;
    if (items.blockedDomains === undefined) {
      defaults.blockedDomains = ["badsite-example.com", "unsafe-example.com", "blocked-example.com", "scheck.amtso.org", "eicar.org", "secure.eicar.org"];
    }
    if (items.allowedDomains === undefined) {
      defaults.allowedDomains = ["wikipedia.org", "github.com", "stackoverflow.com"];
    }
    if (items.blockedKeywords === undefined) {
      defaults.blockedKeywords = ["ecchi", "adult", "uncensored", "18+", "nsfw", "porn"];
    }
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });
});

// Helper to enable/disable DNR static rules dynamically based on toggle
function updateRulesetState(enabled) {
  if (chrome.declarativeNetRequest) {
    chrome.declarativeNetRequest.updateEnabledRulesets({
      [enabled ? 'enableRulesetIds' : 'disableRulesetIds']: ['ruleset_adblock']
    }).catch(err => console.error('Failed to update rulesets:', err));
  }
}

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['mlserver', 'enabled'], (items) => {
    if (items.mlserver) mlServer = items.mlserver;
    if (items.enabled !== undefined) {
      extensionEnabled = !!items.enabled;
      updateRulesetState(extensionEnabled);
    } else {
      updateRulesetState(true);
    }
  });
}

loadSettings();

// Update settings when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.mlserver) mlServer = changes.mlserver.newValue || DEFAULT_ML_SERVER;
    if (changes.enabled !== undefined) {
      extensionEnabled = !!changes.enabled.newValue;
      updateRulesetState(extensionEnabled);
    }
  }
});

function fetchWithTimeout(url, opts = {}, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    fetch(url, opts).then(r => {
      clearTimeout(timer);
      resolve(r);
    }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // If the server health check is requested, handle it regardless of enabled state
  if (msg.type === 'checkServerHealth') {
    const endpoint = `${mlServer.replace(/\/$/, '')}/health`;
    fetchWithTimeout(endpoint, { method: 'GET' }, 1500)
      .then(r => r.json())
      .then(data => {
        sendResponse({ ok: true, data });
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }

  if (!extensionEnabled) {
    sendResponse({ ok: false, error: 'disabled' });
    return;
  }

  if (msg.type === 'checkPageWithML') {
    const { url, title } = msg;
    const endpoint = `${mlServer.replace(/\/$/, '')}/classify_page`;
    fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title })
    }, 2500).then(r => r.json()).then(data => {
      sendResponse({ ok: true, data });
    }).catch(err => {
      sendResponse({ ok: false, error: 'ml-unavailable' });
    });
    return true; // async
  }

  if (msg.type === 'classifyParagraph') {
    const { text } = msg;
    const endpoint = `${mlServer.replace(/\/$/, '')}/classify_paragraph`;
    fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }, 2500).then(r => r.json()).then(data => {
      sendResponse({ ok: true, data });
    }).catch(err => {
      sendResponse({ ok: false, error: 'ml-unavailable' });
    });
    return true; // async
  }
});
