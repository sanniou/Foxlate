const enhancedSelectState = {
    initialized: false,
    observer: null,
    activeSelect: null,
    activeWrapper: null,
    portalList: null,
};

function getSelectLabel(select) {
    return select.selectedOptions?.[0]?.textContent || select.options?.[0]?.textContent || '';
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function ensureThemedSelectPortal() {
    if (enhancedSelectState.portalList) return enhancedSelectState.portalList;

    const list = document.createElement('div');
    list.className = 'themed-select-list themed-select-portal';
    list.setAttribute('role', 'listbox');
    list.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(list);
    enhancedSelectState.portalList = list;
    return list;
}

function positionThemedSelectPortal() {
    const select = enhancedSelectState.activeSelect;
    const wrapper = enhancedSelectState.activeWrapper;
    const list = enhancedSelectState.portalList;
    if (!select || !wrapper || !list || !list.classList.contains('is-open')) return;

    const trigger = wrapper.querySelector('.themed-select-trigger');
    const rect = trigger?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 12;
    const gap = 6;
    const maxWidth = Math.max(180, Math.min(460, window.innerWidth - viewportPadding * 2));
    const preferredWidth = Math.max(rect.width, Math.min(maxWidth, list.scrollWidth || rect.width));
    const left = clamp(rect.left, viewportPadding, window.innerWidth - preferredWidth - viewportPadding);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const opensAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(150, Math.min(320, opensAbove ? spaceAbove : spaceBelow));

    list.style.minWidth = `${Math.round(rect.width)}px`;
    list.style.maxWidth = `${Math.round(maxWidth)}px`;
    list.style.maxHeight = `${Math.round(maxHeight)}px`;
    list.style.left = `${Math.round(left)}px`;

    if (opensAbove) {
        list.dataset.placement = 'top';
        list.style.top = '';
        list.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
    } else {
        list.dataset.placement = 'bottom';
        list.style.bottom = '';
        list.style.top = `${Math.round(rect.bottom + gap)}px`;
    }
}

function closeThemedSelect(wrapper = enhancedSelectState.activeWrapper) {
    if (!wrapper) return;
    wrapper.classList.remove('is-open');
    wrapper.querySelector('.themed-select-trigger')?.setAttribute('aria-expanded', 'false');
    if (wrapper === enhancedSelectState.activeWrapper) {
        enhancedSelectState.portalList?.classList.remove('is-open');
        enhancedSelectState.portalList?.replaceChildren();
        enhancedSelectState.activeSelect = null;
        enhancedSelectState.activeWrapper = null;
    }
}

function closeOtherThemedSelects(currentWrapper = null) {
    document.querySelectorAll('.themed-select.is-open').forEach(wrapper => {
        if (wrapper !== currentWrapper) closeThemedSelect(wrapper);
    });
}

function renderThemedSelectOptions(select) {
    const wrapper = select.closest('.themed-select');
    const trigger = wrapper?.querySelector('.themed-select-trigger');
    const list = ensureThemedSelectPortal();
    list.replaceChildren();

    Array.from(select.options).forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'themed-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.disabled = option.disabled;

        item.addEventListener('click', (event) => {
            event.stopPropagation();
            if (select.value !== option.value) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncThemedSelect(select);
            closeThemedSelect(wrapper);
            trigger?.focus();
        });

        list.appendChild(item);
    });
}

function openThemedSelect(select) {
    const wrapper = select.closest('.themed-select');
    const trigger = wrapper?.querySelector('.themed-select-trigger');
    if (!wrapper || !trigger || select.disabled) return;

    closeOtherThemedSelects(wrapper);
    enhancedSelectState.activeSelect = select;
    enhancedSelectState.activeWrapper = wrapper;
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    renderThemedSelectOptions(select);
    const list = ensureThemedSelectPortal();
    list.classList.add('is-open');
    positionThemedSelectPortal();
    requestAnimationFrame(positionThemedSelectPortal);
}

function syncThemedSelect(select) {
    const wrapper = select.closest('.themed-select');
    if (!wrapper) return;

    const trigger = wrapper.querySelector('.themed-select-trigger');
    const valueText = wrapper.querySelector('.themed-select-value');
    if (!trigger || !valueText) return;

    valueText.textContent = getSelectLabel(select);
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-disabled', String(select.disabled));
    if (select === enhancedSelectState.activeSelect) {
        renderThemedSelectOptions(select);
        positionThemedSelectPortal();
    }
}

function enhanceSelect(select) {
    if (!select || select.dataset.themedSelect === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'themed-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'themed-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const value = document.createElement('span');
    value.className = 'themed-select-value';

    const icon = document.createElement('span');
    icon.className = 'themed-select-icon';
    icon.setAttribute('aria-hidden', 'true');

    trigger.append(value, icon);
    wrapper.append(trigger);

    select.parentNode.insertBefore(wrapper, select);
    wrapper.insertBefore(select, trigger);
    select.dataset.themedSelect = 'true';
    select.classList.add('themed-select-native');

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (select.disabled) return;
        const shouldOpen = !wrapper.classList.contains('is-open');
        if (shouldOpen) openThemedSelect(select);
        else closeThemedSelect(wrapper);
    });

    trigger.addEventListener('keydown', (event) => {
        const options = Array.from(select.options).filter(option => !option.disabled);
        const currentIndex = options.findIndex(option => option.value === select.value);
        const moveTo = (index) => {
            const next = options[index];
            if (!next) return;
            select.value = next.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncThemedSelect(select);
        };

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveTo(Math.min(options.length - 1, currentIndex + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveTo(Math.max(0, currentIndex - 1));
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            trigger.click();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeThemedSelect(wrapper);
        }
    });

    select.addEventListener('change', () => syncThemedSelect(select));

    const optionObserver = new MutationObserver(() => syncThemedSelect(select));
    optionObserver.observe(select, { childList: true, subtree: true, attributes: true });

    syncThemedSelect(select);
}

export function enhanceThemedSelects(root = document) {
    root.querySelectorAll?.('select.form-control').forEach(enhanceSelect);

    if (enhancedSelectState.initialized) return;
    enhancedSelectState.initialized = true;

    document.addEventListener('click', () => closeOtherThemedSelects());
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeOtherThemedSelects();
    });
    window.addEventListener('resize', positionThemedSelectPortal);
    document.addEventListener('scroll', positionThemedSelectPortal, true);

    enhancedSelectState.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) return;
                if (node.matches?.('select.form-control')) enhanceSelect(node);
                enhanceThemedSelects(node);
            });
        }
    });
    enhancedSelectState.observer.observe(document.body, { childList: true, subtree: true });
}
