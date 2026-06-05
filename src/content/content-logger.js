export function logContentError(context, error) {
    if (error && error.name === 'AbortError') {
        console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
        return;
    }

    console.error(`[Foxlate Content Script Error] in ${context}:`, error?.message, error?.stack);
}
