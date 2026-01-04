// background.js — message broker + ML gateway with storage-aware ML server URL
const DEFAULT_ML_SERVER = "http://127.0.0.1:5000";
let mlServer = DEFAULT_ML_SERVER;
let extensionEnabled = true;

// initialize mlServer from storage on start
chrome.storage.local.get(['mlserver','enabled'], (items) => {
  if (items.mlserver) mlServer = items.mlserver;
  if (items.enabled === false) extensionEnabled = false;
});

// update mlServer when storage changes (popup saves)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.mlserver) mlServer = changes.mlserver.newValue || DEFAULT_ML_SERVER;
    if (changes.enabled) extensionEnabled = !!changes.enabled.newValue;
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
  if (msg.type === 'setEnabled') {
    extensionEnabled = !!msg.value;
    sendResponse({ok: true});
    return;
  }

  if (!extensionEnabled) {
    sendResponse({ ok: false, error: 'disabled' });
    return;
  }

  if (msg.type === 'checkPageWithML') {
    const { url } = msg;
    const endpoint = `${mlServer.replace(/\/$/, '')}/classify_page`;
    fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
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
