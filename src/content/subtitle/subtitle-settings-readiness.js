export async function waitForEffectiveSettings(windowRef = window, timeoutMs = 5000, intervalMs = 100) {
    if (typeof windowRef.getEffectiveSettings === 'function') {
        return true;
    }

    await new Promise(resolve => {
        const interval = setInterval(() => {
            if (typeof windowRef.getEffectiveSettings === 'function') {
                clearInterval(interval);
                resolve();
            }
        }, intervalMs);

        setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, timeoutMs);
    });

    return typeof windowRef.getEffectiveSettings === 'function';
}
