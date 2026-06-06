import * as Constants from '../../common/constants.js';

export class DisplayStateStore {
    constructor({
        states = Constants.DISPLAY_MANAGER_STATES,
        elementStates = new WeakMap(),
        elementRegistry = new Map(),
        activeEphemeralTargets = new Map(),
    } = {}) {
        this.states = states;
        this.elementStates = elementStates;
        this.elementRegistry = elementRegistry;
        this.activeEphemeralTargets = activeEphemeralTargets;
    }

    getState(target) {
        return (this.elementStates.get(target) || {}).state || this.states.ORIGINAL;
    }

    getData(target) {
        return this.elementStates.get(target);
    }

    setState(target, nextState, data = null) {
        const currentState = this.elementStates.get(target) || {};
        const nextData = data
            ? { ...currentState, ...data, state: nextState }
            : { ...currentState, state: nextState };
        this.elementStates.set(target, nextData);

        if (target instanceof HTMLElement) {
            target.dataset.foxlateState = nextState.toLowerCase();
        }

        return nextData;
    }

    patchData(target, data) {
        const currentState = this.elementStates.get(target) || {};
        const nextData = { ...currentState, ...data };
        this.elementStates.set(target, nextData);
        return nextData;
    }

    deleteTarget(target) {
        this.elementStates.delete(target);
    }

    registerElement(elementId, element) {
        this.elementRegistry.set(elementId, new WeakRef(element));
    }

    findElementById(elementId) {
        return this.elementRegistry.get(elementId)?.deref();
    }

    removeElementId(elementId) {
        if (elementId) {
            this.elementRegistry.delete(elementId);
        }
    }

    entries() {
        return this.elementRegistry.entries();
    }

    getActiveEphemeral(displayMode) {
        return this.activeEphemeralTargets.get(displayMode);
    }

    setActiveEphemeral(displayMode, target) {
        this.activeEphemeralTargets.set(displayMode, target);
    }

    removeActiveEphemeral(displayMode, target) {
        if (this.activeEphemeralTargets.has(displayMode) && this.activeEphemeralTargets.get(displayMode) === target) {
            this.activeEphemeralTargets.delete(displayMode);
        }
    }
}
