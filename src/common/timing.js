/**
 * Creates a debounced function that delays invoking `func` until after `delay` milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
export function debounce(func, delay) {
    let timeout;
    const debounced = function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
    debounced.cancel = () => {
        clearTimeout(timeout);
        timeout = undefined;
    };
    return debounced;
}
