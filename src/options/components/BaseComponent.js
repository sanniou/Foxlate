/**
 * A base class for UI components that provides a simple event system.
 */
export class BaseComponent {
    #listeners = new Map();

    constructor() {
        if (new.target === BaseComponent) {
            throw new TypeError("Cannot construct BaseComponent instances directly.");
        }
    }

    /**
     * Register an event listener.
     * @param {string} eventName - The name of the event.
     * @param {Function} callback - The callback function to execute.
     */
    on(eventName, callback) {
        if (!this.#listeners.has(eventName)) {
            this.#listeners.set(eventName, []);
        }
        this.#listeners.get(eventName).push(callback);
    }

    /**
     * Unregister an event listener.
     * @param {string} eventName - The name of the event.
     * @param {Function} callback - The callback function to remove.
     */
    off(eventName, callback) {
        if (this.#listeners.has(eventName)) {
            const callbacks = this.#listeners.get(eventName);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Dispatch an event.
     * @param {string} eventName - The name of the event.
     * @param {*} [data] - The data to pass to the listeners.
     * @protected
     */
    emit(eventName, data) {
        if (this.#listeners.has(eventName)) {
            this.#listeners.get(eventName).forEach(callback => callback(data));
        }
    }
}
