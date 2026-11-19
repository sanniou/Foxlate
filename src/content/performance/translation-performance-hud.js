const DEFAULT_SNAPSHOT = {
    state: 'idle',
    observed: 0,
    initialScanRemaining: 0,
    mutationQueue: 0,
    pendingScroll: 0,
    activeTranslations: 0,
    started: 0,
    completed: 0,
    failed: 0,
    batchQueued: 0,
    batchInFlight: 0,
    retryDelayMs: 0,
};

function formatCount(value) {
    return Number.isFinite(value) ? String(value) : '0';
}

function formatDelay(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    if (ms < 1000) return `${Math.ceil(ms)}ms`;
    return `${Math.ceil(ms / 1000)}s`;
}

export class TranslationPerformanceHud {
    // 生产构建里没有调试浮层：所有入口在 `__DEBUG__` 为 false 时直接返回，
    // 连 DOM 元素都不会被创建。此前它对所有用户可见地渲染，并且每次进度回调
    // 都重建约 20 个节点（500 段的页面就是上千次重写）。
    #enabled = Boolean(globalThis.__DEBUG__);
    #element = null;
    #snapshot = { ...DEFAULT_SNAPSHOT };
    #hideTimer = null;

    show() {
        if (!this.#enabled) return;
        this.#ensureElement();
        this.#element.classList.add('visible');
    }

    hide({ immediate = false } = {}) {
        if (!this.#enabled || !this.#element) return;
        if (this.#hideTimer) {
            clearTimeout(this.#hideTimer);
            this.#hideTimer = null;
        }
        const apply = () => this.#element?.classList.remove('visible');
        if (immediate) {
            apply();
        } else {
            this.#hideTimer = setTimeout(apply, 1200);
        }
    }

    reset() {
        if (!this.#enabled) return;
        this.#snapshot = { ...DEFAULT_SNAPSHOT };
        this.render();
    }

    update(partialSnapshot = {}) {
        if (!this.#enabled) return;
        this.#snapshot = { ...this.#snapshot, ...partialSnapshot };
        this.render();
        if (this.#snapshot.state === 'translated' || this.#snapshot.state === 'idle') {
            this.hide();
        } else {
            this.show();
        }
    }

    updateBatch({ queued, inFlight } = {}) {
        this.update({
            batchQueued: queued ?? this.#snapshot.batchQueued,
            batchInFlight: inFlight ?? this.#snapshot.batchInFlight,
        });
    }

    updateRetry({ retryDelayMs = 0 } = {}) {
        this.update({ retryDelayMs });
    }

    render() {
        this.#ensureElement();
        const snapshot = this.#snapshot;
        const totalDone = snapshot.completed + snapshot.failed;
        const progressLabel = totalDone > 0 || snapshot.started > 0
            ? `${formatCount(totalDone)}/${formatCount(snapshot.started)}`
            : '0/0';
        this.#element.innerHTML = `
            <div class="foxlate-performance-title">
                <span>Foxlate</span>
                <strong>${snapshot.state}</strong>
            </div>
            <div class="foxlate-performance-grid">
                <span>Observed</span><strong>${formatCount(snapshot.observed)}</strong>
                <span>Active</span><strong>${formatCount(snapshot.activeTranslations)}</strong>
                <span>Done</span><strong>${progressLabel}</strong>
                <span>Failed</span><strong>${formatCount(snapshot.failed)}</strong>
                <span>Scroll</span><strong>${formatCount(snapshot.pendingScroll)}</strong>
                <span>Batch</span><strong>${formatCount(snapshot.batchQueued)}/${formatCount(snapshot.batchInFlight)}</strong>
                <span>Scan</span><strong>${formatCount(snapshot.initialScanRemaining)}</strong>
                <span>Retry</span><strong>${formatDelay(snapshot.retryDelayMs)}</strong>
            </div>
        `;
    }

    #ensureElement() {
        if (this.#element) return;
        this.#element = document.createElement('div');
        this.#element.className = 'foxlate-performance-hud';
        document.body.appendChild(this.#element);
    }
}
