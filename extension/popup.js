// popup.js — manages UI actions and synchronizes storage settings

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const enabledToggle = document.getElementById('enabled-toggle');
  const serverUrlEl = document.getElementById('server-url');
  const saveUrlBtn = document.getElementById('save-url-btn');
  const statusToast = document.getElementById('status-toast');

  // Lists Inputs & Buttons
  const whitelistInput = document.getElementById('whitelist-input');
  const addWhitelistBtn = document.getElementById('add-whitelist-btn');
  const whitelistContainer = document.getElementById('whitelist-container');

  const blacklistInput = document.getElementById('blacklist-input');
  const addBlacklistBtn = document.getElementById('add-blacklist-btn');
  const blacklistContainer = document.getElementById('blacklist-container');

  const keywordInput = document.getElementById('keyword-input');
  const addKeywordBtn = document.getElementById('add-keyword-btn');
  const keywordContainer = document.getElementById('keyword-container');

  // Tab Buttons & Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // ML Server Status Elements
  const serverStatusEl = document.getElementById('server-status');
  const modelUrlStatusEl = document.getElementById('model-url-status');
  const modelTextStatusEl = document.getElementById('model-text-status');

  // Tab Switching Logic
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Load Settings
  let currentSettings = {
    enabled: true,
    mlserver: '',
    blockedDomains: [],
    allowedDomains: [],
    blockedKeywords: []
  };

  function loadSettings() {
    chrome.storage.local.get(['enabled', 'mlserver', 'blockedDomains', 'allowedDomains', 'blockedKeywords'], (items) => {
      currentSettings.enabled = items.enabled !== false;
      currentSettings.mlserver = items.mlserver || 'http://127.0.0.1:5000';
      currentSettings.blockedDomains = items.blockedDomains || [];
      currentSettings.allowedDomains = items.allowedDomains || [];
      currentSettings.blockedKeywords = items.blockedKeywords || [];

      // Update UI fields
      enabledToggle.checked = currentSettings.enabled;
      serverUrlEl.value = currentSettings.mlserver;

      // Render lists
      renderList(whitelistContainer, currentSettings.allowedDomains, 'allowedDomains');
      renderList(blacklistContainer, currentSettings.blockedDomains, 'blockedDomains');
      renderList(keywordContainer, currentSettings.blockedKeywords, 'blockedKeywords');

      // Check Server Status immediately
      checkServerHealth();
    });
  }

  // Live Server Health Check
  function checkServerHealth() {
    serverStatusEl.innerHTML = '<span style="color:#a0aec0">Checking...</span>';
    modelUrlStatusEl.textContent = '...';
    modelTextStatusEl.textContent = '...';

    chrome.runtime.sendMessage({ type: 'checkServerHealth' }, (resp) => {
      if (resp && resp.ok && resp.data) {
        const d = resp.data;
        serverStatusEl.innerHTML = '<span class="dot dot-green"></span> <span style="color:#10b981">Online</span>';
        modelUrlStatusEl.textContent = d.models.page_model ? 'Loaded' : 'Missing';
        modelUrlStatusEl.style.color = d.models.page_model ? '#10b981' : '#ef4444';
        modelTextStatusEl.textContent = d.models.paragraph_model ? 'Loaded' : 'Missing';
        modelTextStatusEl.style.color = d.models.paragraph_model ? '#10b981' : '#ef4444';
      } else {
        serverStatusEl.innerHTML = '<span class="dot dot-red"></span> <span style="color:#ef4444">Offline</span>';
        modelUrlStatusEl.textContent = 'Offline';
        modelUrlStatusEl.style.color = '#ef4444';
        modelTextStatusEl.textContent = 'Offline';
        modelTextStatusEl.style.color = '#ef4444';
      }
    });
  }

  // Render arrays into visual lists
  function renderList(container, listArray, storageKey) {
    container.innerHTML = '';
    
    if (listArray.length === 0) {
      container.innerHTML = '<div class="empty-state">No entries added</div>';
      return;
    }

    listArray.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'list-item';
      
      const textSpan = document.createElement('span');
      textSpan.className = 'list-item-text';
      textSpan.textContent = item;
      textSpan.title = item;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-danger-outline';
      deleteBtn.textContent = 'Remove';
      
      deleteBtn.addEventListener('click', () => {
        listArray.splice(index, 1);
        chrome.storage.local.set({ [storageKey]: listArray }, () => {
          renderList(container, listArray, storageKey);
        });
      });

      itemEl.appendChild(textSpan);
      itemEl.appendChild(deleteBtn);
      container.appendChild(itemEl);
    });
  }

  // Master Switch Action
  enabledToggle.addEventListener('change', () => {
    const enabled = enabledToggle.checked;
    chrome.storage.local.set({ enabled }, () => {
      showToast('Settings saved');
    });
  });

  // Save ML Server URL
  saveUrlBtn.addEventListener('click', () => {
    let url = serverUrlEl.value.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
      serverUrlEl.value = url;
    }
    
    chrome.storage.local.set({ mlserver: url }, () => {
      showToast('URL updated');
      checkServerHealth();
    });
  });

  // Add Item Helper
  function handleAdd(inputEl, listArray, storageKey, containerEl, placeholderMessage) {
    const val = inputEl.value.trim().toLowerCase();
    if (!val) return;
    
    if (listArray.includes(val)) {
      inputEl.value = '';
      return;
    }

    listArray.push(val);
    chrome.storage.local.set({ [storageKey]: listArray }, () => {
      inputEl.value = '';
      renderList(containerEl, listArray, storageKey);
    });
  }

  // Button Listeners for Lists
  addWhitelistBtn.addEventListener('click', () => {
    handleAdd(whitelistInput, currentSettings.allowedDomains, 'allowedDomains', whitelistContainer);
  });
  whitelistInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAdd(whitelistInput, currentSettings.allowedDomains, 'allowedDomains', whitelistContainer);
    }
  });

  addBlacklistBtn.addEventListener('click', () => {
    handleAdd(blacklistInput, currentSettings.blockedDomains, 'blockedDomains', blacklistContainer);
  });
  blacklistInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAdd(blacklistInput, currentSettings.blockedDomains, 'blockedDomains', blacklistContainer);
    }
  });

  addKeywordBtn.addEventListener('click', () => {
    handleAdd(keywordInput, currentSettings.blockedKeywords, 'blockedKeywords', keywordContainer);
  });
  keywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAdd(keywordInput, currentSettings.blockedKeywords, 'blockedKeywords', keywordContainer);
    }
  });

  // Toast indicator
  function showToast(msg) {
    statusToast.textContent = msg;
    setTimeout(() => {
      statusToast.textContent = '';
    }, 1500);
  }

  // Initial Load
  loadSettings();
});
