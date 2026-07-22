/**
 * Wait until content runtime exposes getEffectiveSettings.
 * Returns false on timeout (fail-soft: caller should skip auto-enable, not throw).
 */
export async function waitForEffectiveSettings(windowRef = window, timeoutMs = 3000, intervalMs = 50) {
    if (typeof windowRef.getEffectiveSettings === 'function') {
        return true;
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (typeof windowRef.getEffectiveSettings === 'function') {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return typeof windowRef.getEffectiveSettings === 'function';
}
