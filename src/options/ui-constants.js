export const ELEMENT_IDS = {
    // Main settings
    TRANSLATOR_ENGINE: 'translatorEngine',
    TARGET_LANGUAGE: 'targetLanguage',
    DISPLAY_MODE_SELECT: 'displayModeSelect',
    SAVE_SETTINGS_BTN: 'saveSettingsBtn',
    RESET_SETTINGS_BTN: 'reset-settings-btn',
    STATUS_MESSAGE: 'statusMessage',

    // API specific
    DEEPLX_URL_GROUP: 'deeplxUrlGroup',
    DEEPLX_API_URL: 'deeplxApiUrl',

    // Selectors
    DEFAULT_CONTENT_SELECTOR: 'defaultContentSelector',
    DEFAULT_EXCLUDE_SELECTOR: 'defaultExcludeSelector',

    // AI Engine Management
    AI_ENGINE_MANAGEMENT_GROUP: 'aiEngineManagementGroup',
    MANAGE_AI_ENGINES_BTN: 'manageAiEnginesBtn',
    RETRY_ALL_SYNC_BTN: 'retryAllSyncBtn',

    // Domain Rules
    ADD_DOMAIN_RULE_BTN: 'addDomainRuleBtn',
    DOMAIN_RULES_LIST: 'domainRulesList',

    // Import / Export
    EXPORT_BTN: 'export-btn',
    IMPORT_BTN: 'import-btn',
    IMPORT_INPUT: 'import-input',

    // Cache
    CACHE_SIZE_INPUT: 'cacheSizeInput',
    CACHE_INFO_DISPLAY: 'cacheInfoDisplay',
    CLEAR_CACHE_BTN: 'clearCacheBtn',

    // --- Modals ---
    // AI Engine Modal
    AI_ENGINE_MODAL: 'aiEngineModal',
    AI_ENGINE_LIST: 'aiEngineList',
    ADD_AI_ENGINE_BTN: 'addAiEngineBtn',
    AI_ENGINE_FORM: 'aiEngineForm',
    AI_FORM_TITLE: 'aiFormTitle',
    SAVE_AI_ENGINE_BTN: 'saveAiEngineBtn',
    CANCEL_AI_ENGINE_BTN: 'cancelAiEngineBtn',
    CLOSE_AI_ENGINE_MODAL_BTN_SELECTOR: '#aiEngineModal .close-button',

    // AI Engine Form Fields
    AI_ENGINE_NAME_INPUT: 'aiEngineName',
    AI_API_KEY_INPUT: 'aiApiKey',
    AI_API_URL_INPUT: 'aiApiUrl',
    AI_MODEL_NAME_INPUT: 'aiModelName',
    AI_CUSTOM_PROMPT_INPUT: 'aiCustomPrompt',
    AI_SHORT_TEXT_THRESHOLD_INPUT: 'aiShortTextThreshold',
    AI_SHORT_TEXT_ENGINE_SELECT: 'aiShortTextEngine',

    // AI Engine Test Section
    AI_TEST_SECTION: 'aiTestSection',
    AI_TEST_TEXT: 'aiTestText',
    TEST_AI_ENGINE_BTN: 'testAiEngineBtn',
    AI_TEST_RESULT: 'aiTestResult',

    // AI Engine Import Modal
    IMPORT_AI_ENGINE_MODAL: 'importAiEngineModal',
    OPEN_IMPORT_AI_ENGINE_MODAL_BTN: 'openImportAiEngineModalBtn',
    CONFIRM_IMPORT_AI_ENGINE_BTN: 'confirmImportAiEngineBtn',
    CANCEL_IMPORT_AI_ENGINE_BTN: 'cancelImportAiEngineBtn',
    IMPORT_AI_ENGINE_CONFIG_TEXT: 'importAiEngineConfigText',
    IMPORT_AI_ENGINE_ERROR_TEXT: 'importAiEngineErrorText',

    // Domain Rule Modal
    DOMAIN_RULE_MODAL: 'domainRuleModal',
    DOMAIN_RULE_FORM: 'domainRuleForm',
    DOMAIN_RULE_FORM_TITLE: 'domainRuleFormTitle',
    EDITING_DOMAIN_INPUT: 'editingDomain',
    SAVE_DOMAIN_RULE_BTN: 'saveDomainRuleBtn',
    CANCEL_DOMAIN_RULE_BTN: 'cancelDomainRuleBtn',
    CLOSE_DOMAIN_RULE_MODAL_BTN_SELECTOR: '#domainRuleModal .close-button',

    // Confirm Modal
    CONFIRM_MODAL: 'confirmModal',
    CONFIRM_MODAL_TITLE: 'confirmModalTitle',
    CONFIRM_MODAL_MESSAGE: 'confirmModalMessage',
    CONFIRM_MODAL_CONFIRM_BTN: 'confirmModalConfirmBtn',
    CONFIRM_MODAL_CANCEL_BTN: 'confirmModalCancelBtn',
    CLOSE_CONFIRM_MODAL_BTN: 'closeConfirmModalBtn',

    // Domain Rule Form Fields
    RULE_DOMAIN_INPUT: 'ruleDomain',
    RULE_APPLY_TO_SUBDOMAINS_CHECKBOX: 'ruleApplyToSubdomains',
    RULE_AUTO_TRANSLATE_SELECT: 'ruleAutoTranslate',
    RULE_TRANSLATOR_ENGINE_SELECT: 'ruleTranslatorEngine',
    RULE_TARGET_LANGUAGE_SELECT: 'ruleTargetLanguage',
    RULE_SOURCE_LANGUAGE_SELECT: 'ruleSourceLanguage',
    RULE_DISPLAY_MODE_SELECT: 'ruleDisplayMode',
    RULE_CSS_SELECTOR_OVERRIDE_CHECKBOX: 'ruleCssSelectorOverride',
    RULE_CONTENT_SELECTOR: 'ruleContentSelector',
    RULE_EXCLUDE_SELECTOR_TEXTAREA: 'ruleExcludeSelector',

    // Domain Rule Subtitle Settings
    RULE_ENABLE_SUBTITLE_CHECKBOX: 'ruleEnableSubtitle',
    RULE_SUBTITLE_SETTINGS_GROUP: 'ruleSubtitleSettingsGroup',
    RULE_SUBTITLE_STRATEGY_SELECT: 'ruleSubtitleStrategy',
    RULE_SUBTITLE_DISPLAY_MODE: 'ruleSubtitleDisplayMode',

    // Domain Rule Summary Settings
    RULE_ENABLE_SUMMARY: 'ruleEnableSummary',
    RULE_SUMMARY_SETTINGS_GROUP: 'ruleSummarySettingsGroup',
    RULE_MAIN_BODY_SELECTOR: 'ruleMainBodySelector',
    RULE_SUMMARY_AI_MODEL: 'ruleSummaryAiModel',
    

    // Global Pre-check Test
    RUN_GLOBAL_TEST_BTN: 'runGlobalTestBtn',
    TEST_TEXT_INPUT: 'testTextInput',
    TEST_TEXT_INPUT_ERROR: 'testTextInputError',

    // Global Test Area
    TEST_TRANSLATION_BTN: 'testTranslationBtn',
    MANUAL_TEST_TRANSLATE_BTN: 'manual-test-translate-btn',

    // Log Area
    TOGGLE_LOG_BTN: 'toggleLogBtn',
    LOG_CONTENT: 'log-content',
};