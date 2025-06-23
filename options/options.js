// Helper function to show status messages
function showStatusMessage(message, isError = false) {
  const statusMessage = document.getElementById('statusMessage');
  statusMessage.textContent = message;
  statusMessage.style.display = 'block';
  statusMessage.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
  statusMessage.style.color = isError ? '#721c24' : '#155724';
  statusMessage.style.borderColor = isError ? '#f5c6cb' : '#c3e6cb';
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, 3000);
}

// Show or hide API key fields based on the selected engine
function toggleApiFields() {
    const engine = document.getElementById('translatorEngine').value;
    const deeplxUrlGroup = document.getElementById('deeplxUrlGroup');
    const googleApiKeyGroup = document.getElementById('googleApiKeyGroup');
    const aiApiGroup = document.getElementById('aiApiGroup');

    // Hide all specific fields first
    deeplxUrlGroup.style.display = 'none';
    googleApiKeyGroup.style.display = 'none';
    aiApiGroup.style.display = 'none';

    // Show the relevant field
    if (engine === 'deeplx') {
        deeplxUrlGroup.style.display = 'block';
    } else if (engine === 'google') {
        googleApiKeyGroup.style.display = 'block';
    } else if (engine === 'ai') {
        aiApiGroup.style.display = 'block';
    }
}
// Load settings from storage and populate the form
async function loadSettings() {
  const { settings } = await browser.storage.sync.get('settings');
  const currentSettings = settings || {};

  // General Settings
  document.getElementById('translatorEngine').value = currentSettings.translatorEngine || 'deeplx';
  document.getElementById('targetLanguage').value = currentSettings.targetLanguage || 'ZH';
  document.getElementById('translationSelector').value = currentSettings.translationSelector || 'p, h1, h2, h3, h4, li, a';
  document.getElementById('deeplxApiUrl').value = currentSettings.deeplxApiUrl || '';
  document.getElementById('googleApiKey').value = currentSettings.googleApiKey || '';
  document.getElementById('aiApiKey').value = currentSettings.aiApiKey || '';
  document.getElementById('aiApiUrl').value = currentSettings.aiApiUrl || '';
  document.getElementById('aiModelName').value = currentSettings.aiModelName || '';

  // Display Mode
  const displayMode = currentSettings.displayMode || 'replace';
  document.querySelector(`input[name="displayMode"][value="${displayMode}"]`).checked = true;

  // Toggle visibility of API key fields based on loaded settings
  toggleApiFields();

  // Domain Rules
  renderDomainRules(currentSettings.domainRules || {});
}

// Save settings to storage
async function saveSettings() {
  const settings = {
    translatorEngine: document.getElementById('translatorEngine').value,
    targetLanguage: document.getElementById('targetLanguage').value,
    translationSelector: document.getElementById('translationSelector').value,
    displayMode: document.querySelector('input[name="displayMode"]:checked').value,
    deeplxApiUrl: document.getElementById('deeplxApiUrl').value,
    googleApiKey: document.getElementById('googleApiKey').value,
    aiApiKey: document.getElementById('aiApiKey').value,
    aiApiUrl: document.getElementById('aiApiUrl').value,
    aiModelName: document.getElementById('aiModelName').value,
    domainRules: getDomainRulesFromList(),
  };

  try {
    await browser.storage.sync.set({ settings });
    showStatusMessage('Settings saved successfully!');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatusMessage('Failed to save settings.', true);
  }
}

// Render domain rules in the list
function renderDomainRules(rules) {
  const domainRulesList = document.getElementById('domainRulesList');
  domainRulesList.innerHTML = ''; // Clear existing rules

  for (const domain in rules) {
    const rule = rules[domain];
    const listItem = document.createElement('li');
    listItem.innerHTML = `
      <span><strong>${domain}</strong>: ${rule === 'always' ? 'Always Translate' : 'Manual Translate'}</span>
      <button data-domain="${domain}">Remove</button>
    `;
    listItem.querySelector('button').addEventListener('click', (event) => {
      removeDomainRule(event.target.dataset.domain);
    });
    domainRulesList.appendChild(listItem);
  }
}

// Get domain rules from the rendered list
function getDomainRulesFromList() {
  const rules = {};
  document.querySelectorAll('#domainRulesList li').forEach(item => {
    const domain = item.querySelector('strong').textContent;
    const ruleText = item.querySelector('span').textContent;
    const rule = ruleText.includes('Always Translate') ? 'always' : 'manual';
    rules[domain] = rule;
  });
  return rules;
}

// Add a new domain rule
async function addDomainRule() {
  const newDomainInput = document.getElementById('newDomain');
  const newDomainRuleSelect = document.getElementById('newDomainRule');
  const domain = newDomainInput.value.trim();
  const rule = newDomainRuleSelect.value;

  if (domain) {
    const { settings } = await browser.storage.sync.get('settings');
    const currentSettings = settings || {};
    currentSettings.domainRules = currentSettings.domainRules || {};
    currentSettings.domainRules[domain] = rule;
    await browser.storage.sync.set({ settings: currentSettings });
    renderDomainRules(currentSettings.domainRules);
    newDomainInput.value = ''; // Clear input
    showStatusMessage('Domain rule added.');
  } else {
    showStatusMessage('Please enter a domain.', true);
  }
}

// Remove a domain rule
async function removeDomainRule(domainToRemove) {
  const { settings } = await browser.storage.sync.get('settings');
  const currentSettings = settings || {};
  currentSettings.domainRules = currentSettings.domainRules || {};
  delete currentSettings.domainRules[domainToRemove];
  await browser.storage.sync.set({ settings: currentSettings });
  renderDomainRules(currentSettings.domainRules);
  showStatusMessage('Domain rule removed.');
}

// 导出功能
document.getElementById('export-btn').addEventListener('click', async () => {
  const { settings } = await browser.storage.sync.get('settings');
  const settingsJson = JSON.stringify(settings, null, 2);
  const blob = new Blob([settingsJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'translator-settings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showStatusMessage('Settings exported successfully!');
});

// 导入功能
document.getElementById('import-input').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const settings = JSON.parse(e.target.result);
      // Optional: Add validation logic here to ensure imported settings are valid
      await browser.storage.sync.set({ settings });
      showStatusMessage('Settings imported successfully! Please reload the page to apply changes.');
      loadSettings(); // Reload settings to update UI
    } catch (error) {
      showStatusMessage('Failed to import settings. The file might be corrupted or invalid JSON.', true);
      console.error(error);
    }
  };
  reader.readAsText(file);
});

// --- New Test Connection UI Logic ---

let testPopover = null;

function removeTestPopover() {
    if (testPopover) {
        testPopover.remove();
        testPopover = null;
    }
    // Clean up the global click listener
    document.removeEventListener('click', closePopoverOnClickOutside, true);
}

function closePopoverOnClickOutside(event) {
    if (testPopover && !testPopover.contains(event.target)) {
        const isTestButton = event.target.classList.contains('test-btn');
        if (!isTestButton) {
            removeTestPopover();
        }
    }
}

function showTestPopover(buttonElement, content) {
    removeTestPopover(); // Remove any existing popover first

    testPopover = document.createElement('div');
    testPopover.className = 'test-result-popover';
    testPopover.innerHTML = content;

    // Append to body to avoid positioning issues inside containers
    document.body.appendChild(testPopover);

    // Position the popover above the button
    const btnRect = buttonElement.getBoundingClientRect();
    const popoverRect = testPopover.getBoundingClientRect();

    let left = btnRect.left;
    // Prevent popover from going off the right edge of the screen
    if (left + popoverRect.width > window.innerWidth - 10) {
        left = window.innerWidth - popoverRect.width - 10;
    }

    testPopover.style.left = `${left}px`;
    testPopover.style.top = `${window.scrollY + btnRect.top - popoverRect.height - 8}px`; // 8px gap above

    // Add a listener to close the popover when clicking outside
    setTimeout(() => document.addEventListener('click', closePopoverOnClickOutside, true), 0);
}

// Test connection logic
async function testConnection(engine, buttonElement) {
    let settingsPayload = {};
    if (engine === 'deeplx') {
        const apiUrl = document.getElementById('deeplxApiUrl').value;
        if (!apiUrl) {
            showTestPopover(buttonElement, `<div class="result-item"><code class="result-text error">Please enter a DeepLx API URL.</code></div>`);
            return;
        }
        settingsPayload = { deeplxApiUrl: apiUrl };
    } else if (engine === 'google') {
        const apiKey = document.getElementById('googleApiKey').value;
        if (!apiKey) {
            showTestPopover(buttonElement, `<div class="result-item"><code class="result-text error">Please enter a Google API Key.</code></div>`);
            return;
        }
        settingsPayload = { googleApiKey: apiKey };
    } else if (engine === 'ai') {
        const apiKey = document.getElementById('aiApiKey').value;
        if (!apiKey) {
            showTestPopover(buttonElement, `<div class="result-item"><code class="result-text error">Please enter an AI API Key.</code></div>`);
            return;
        }
        settingsPayload = {
            aiApiKey: apiKey,
            aiApiUrl: document.getElementById('aiApiUrl').value,
            aiModelName: document.getElementById('aiModelName').value,
        };
    }

    const originalButtonText = buttonElement.textContent;
    buttonElement.disabled = true;
    buttonElement.textContent = 'Testing...';
    removeTestPopover();

    try {
        const response = await browser.runtime.sendMessage({
            type: 'TEST_CONNECTION',
            payload: { engine, settings: settingsPayload }
        });
        if (response.success) {
            showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">Original:</span><code class="result-text">test</code></div><div class="result-item"><span class="result-title">Translated:</span><code class="result-text success">${response.translatedText}</code></div>`);
        } else {
            showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">Error:</span><code class="result-text error">${response.error}</code></div>`);
        }
    } catch (error) {
        showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">Critical Error:</span><code class="result-text error">${error.message}</code></div>`);
    } finally {
        buttonElement.disabled = false;
        buttonElement.textContent = originalButtonText;
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('addDomainRuleBtn').addEventListener('click', addDomainRule);
document.getElementById('translatorEngine').addEventListener('change', toggleApiFields);
document.getElementById('testDeepLxBtn').addEventListener('click', (e) => testConnection('deeplx', e.target));
document.getElementById('testGoogleBtn').addEventListener('click', (e) => testConnection('google', e.target));
document.getElementById('testAiBtn').addEventListener('click', (e) => testConnection('ai', e.target));
