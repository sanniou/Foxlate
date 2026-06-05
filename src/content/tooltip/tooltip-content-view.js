import { escapeHtml } from '../../common/utils.js';
import { createTooltipIconButton } from './tooltip-icons.js';

function createTextSection(browserApi, type, text, isCollapsed) {
    const section = document.createElement('div');
    section.className = `foxlate-text-section ${type}-section`;

    const header = document.createElement('div');
    header.className = 'foxlate-text-header';

    const label = document.createElement('span');
    label.className = 'foxlate-text-label';
    label.textContent = browserApi.i18n.getMessage(type === 'source' ? 'tooltipSourceText' : 'tooltipTargetText');

    const actions = document.createElement('div');
    actions.className = 'foxlate-text-actions';

    const toggleBtn = createTooltipIconButton('toggle-btn', isCollapsed ? 'expand' : 'collapse', browserApi.i18n.getMessage(isCollapsed ? 'tooltipExpandSource' : 'tooltipCollapseSource'));
    const speechBtn = createTooltipIconButton(`${type}-speech-btn`, 'play', browserApi.i18n.getMessage(type === 'source' ? 'tooltipReadSource' : 'tooltipReadTarget'));
    const copyBtn = createTooltipIconButton(`${type}-copy-btn`, 'copy', browserApi.i18n.getMessage(type === 'source' ? 'tooltipCopySource' : 'tooltipCopyTarget'));

    if (isCollapsed) {
        speechBtn.disabled = true;
        copyBtn.disabled = true;
    }

    actions.append(toggleBtn, speechBtn, copyBtn);
    header.append(label, actions);

    const content = document.createElement('div');
    content.className = 'foxlate-text-content';
    content.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

    section.append(header, content);

    if (isCollapsed) {
        section.classList.add('collapsed');
    }

    return section;
}

export function createTooltipContent(browserApi, sourceText, translatedText, { isLoading, isError }) {
    const fragment = document.createDocumentFragment();
    const container = document.createElement('div');
    container.className = 'foxlate-panel-content';

    const header = document.createElement('div');
    header.className = 'foxlate-panel-header';
    const title = document.createElement('div');
    title.className = 'foxlate-panel-title';
    title.textContent = 'Foxlate';

    const actions = document.createElement('div');
    actions.className = 'foxlate-panel-actions';
    actions.append(
        createTooltipIconButton('foxlate-pin-btn', 'pin', browserApi.i18n.getMessage('tooltipPin') || 'Pin'),
        createTooltipIconButton('foxlate-close-btn', 'close', browserApi.i18n.getMessage('tooltipClose')),
    );

    header.append(title, actions);

    const body = document.createElement('div');
    body.className = 'foxlate-panel-body';

    if (isLoading) {
        const loadingContainer = document.createElement('div');
        loadingContainer.className = 'foxlate-loading-container';
        const spinner = document.createElement('div');
        spinner.className = 'foxlate-spinner';
        const loadingText = document.createElement('div');
        loadingText.className = 'foxlate-loading-text';
        loadingText.textContent = browserApi.i18n.getMessage('tooltipTranslating');
        loadingContainer.append(spinner, loadingText);
        body.appendChild(loadingContainer);
    } else if (isError) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'foxlate-error-message';
        errorMsg.textContent = sourceText;
        body.appendChild(errorMsg);
    } else {
        body.append(
            createTextSection(browserApi, 'target', translatedText, false),
            createTextSection(browserApi, 'source', sourceText, true),
        );
    }

    container.append(header, body);
    fragment.appendChild(container);
    return fragment;
}
