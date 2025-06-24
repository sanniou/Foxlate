document.addEventListener('DOMContentLoaded', () => {
    const sourceLanguageSelect = document.getElementById('sourceLanguageSelect');
    const targetLanguageSelect = document.getElementById('targetLanguageSelect');
    const engineSelect = document.getElementById('engineSelect');
    const translatePageBtn = document.getElementById('translatePageBtn');
    const alwaysTranslateToggle = document.getElementById('alwaysTranslateToggle');
    const openOptionsBtn = document.getElementById('openOptionsBtn'); // 底部设置按钮
    const versionDisplay = document.getElementById('versionDisplay');
    const aboutBtn = document.getElementById('aboutBtn');

    // 语言列表 (简化版)
    const languages = [
        { code: 'auto', name: '自动检测' },
        { code: 'ZH', name: '中文' },
        { code: 'EN', name: 'English' },
        { code: 'JA', name: '日本語' },
        { code: 'KO', name: '한국어' },
        { code: 'FR', name: 'Français' },
        { code: 'DE', name: 'Deutsch' },
        { code: 'ES', name: 'Español' }
    ];

    // 翻译引擎列表
    const engines = [
        { value: 'deeplx', name: 'DeepLx' },
        { value: 'google', name: 'Google Translate' },
        { value: 'ai', name: 'AI Translator (GPT)' }
    ];

    // 填充语言下拉菜单
    function populateLanguageSelect(selectElement, langList, selectedCode) {
        selectElement.innerHTML = ''; // 清空现有选项
        langList.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            if (lang.code === selectedCode) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    }

    // 填充引擎下拉菜单
    function populateEngineSelect(selectElement, engineList, selectedValue) {
        selectElement.innerHTML = ''; // 清空现有选项
        engineList.forEach(engine => {
            const option = document.createElement('option');
            option.value = engine.value;
            option.textContent = engine.name;
            if (engine.value === selectedValue) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    }

    // 加载并显示设置
    async function loadAndDisplaySettings() {
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        // 填充语言和引擎选择器
        populateLanguageSelect(sourceLanguageSelect, languages, currentSettings.sourceLanguage || 'auto');
        populateLanguageSelect(targetLanguageSelect, languages.filter(l => l.code !== 'auto'), currentSettings.targetLanguage || 'ZH'); // 目标语言不包含自动检测
        populateEngineSelect(engineSelect, engines, currentSettings.translatorEngine || 'deeplx');

        // 设置“总是翻译此网站”开关状态
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            const url = new URL(tabs[0].url);
            const hostname = url.hostname;
            const domainRules = currentSettings.domainRules || {};
            alwaysTranslateToggle.checked = domainRules[hostname] === 'always';
        } else {
            alwaysTranslateToggle.disabled = true; // 如果无法获取 hostname，禁用开关
        }

        // 显示版本号
        versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
    }

    // 保存设置
    async function saveSetting(key, value) {
        const { settings } = await browser.storage.sync.get('settings');
        const newSettings = { ...settings, [key]: value };
        await browser.storage.sync.set({ settings: newSettings });
    }

    // 事件监听器
    sourceLanguageSelect.addEventListener('change', (event) => saveSetting('sourceLanguage', event.target.value));
    targetLanguageSelect.addEventListener('change', (event) => saveSetting('targetLanguage', event.target.value));
    engineSelect.addEventListener('change', (event) => saveSetting('translatorEngine', event.target.value));

    translatePageBtn.addEventListener('click', async () => {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            // 暂时只打印消息，不实际翻译页面，避免引入 DisplayManager 错误
            console.log("Popup: Requesting page translation for tab:", tabs[0].id);
            browser.tabs.sendMessage(tabs[0].id, { type: 'TRANSLATE_PAGE_REQUEST' })
                .catch(error => console.error("Error sending page translation request:", error));
            // 可以在这里添加一个简单的UI反馈，例如按钮文字变为“翻译中...”
        }
    });

    alwaysTranslateToggle.addEventListener('change', async (event) => {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            const url = new URL(tabs[0].url);
            const hostname = url.hostname;
            const rule = event.target.checked ? 'always' : 'manual';
            const { settings } = await browser.storage.sync.get('settings');
            const newDomainRules = { ...(settings?.domainRules || {}), [hostname]: rule };
            await saveSetting('domainRules', newDomainRules);
            console.log(`Domain rule for ${hostname} set to: ${rule}`);
        }
    });

    openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
    aboutBtn.addEventListener('click', () => alert("Universal Translator\n版本: " + browser.runtime.getManifest().version + "\n作者: Your Name/Team Name\n感谢使用！"));

    // 初始化加载
    loadAndDisplaySettings();
});