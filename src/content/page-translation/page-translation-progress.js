export class PageTranslationProgress {
    activeTranslations = 0;
    startedTranslations = 0;
    completedTranslations = 0;
    failedTranslations = 0;
    precheckSkipped = 0;

    snapshot({
        state,
        observedCount,
        initialScanRemaining,
        mutationQueueSize,
        pendingScrollCount,
        isScrolling,
    }, extra = {}) {
        return {
            state,
            observed: observedCount,
            initialScanRemaining,
            mutationQueue: mutationQueueSize,
            pendingScroll: pendingScrollCount,
            activeTranslations: this.activeTranslations,
            started: this.startedTranslations,
            completed: this.completedTranslations,
            failed: this.failedTranslations,
            precheckSkipped: this.precheckSkipped,
            isScrolling,
            ...extra,
        };
    }

    recordStarted() {
        this.activeTranslations++;
        this.startedTranslations++;
    }

    recordCompleted({ success = true } = {}) {
        this.activeTranslations = Math.max(0, this.activeTranslations - 1);
        if (success) {
            this.completedTranslations++;
        } else {
            this.failedTranslations++;
        }
    }

    recordPrecheckSkipped() {
        this.precheckSkipped++;
    }

    clearActive() {
        this.activeTranslations = 0;
    }
}
