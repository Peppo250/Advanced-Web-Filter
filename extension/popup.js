// popup.js — saves simple options to chrome.storage
const enabledEl = document.getElementById('enabled');
const mlserverEl = document.getElementById('mlserver');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

// Load saved
chrome.storage.local.get(['enabled','mlserver'], (items) => {
  if (items.enabled === false) enabledEl.checked = false;
  if (items.mlserver) mlserverEl.value = items.mlserver;
});

// Save settings
saveBtn.addEventListener('click', () => {
  const enabled = enabledEl.checked;
  const mlserver = mlserverEl.value || '';
  chrome.storage.local.set({ enabled, mlserver }, () => {
    status.textContent = 'Saved';
    setTimeout(()=> status.textContent = '', 1500);
    chrome.runtime.sendMessage({ type: 'setEnabled', value: enabled });
  });
});
