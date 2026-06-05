export function logBackgroundError(context, error) {
    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
            return;
        }
        console.error(`[Foxlate Error] in ${context}:`, error.message, error.stack);
        return;
    }

    console.error(`[Foxlate Error] in ${context}:`, error || 'An unknown error occurred.');
}
