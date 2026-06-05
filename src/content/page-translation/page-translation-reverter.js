export function revertPageTranslationDom({
    documentRef = document,
    displayManager,
}) {
    delete documentRef.body.dataset.translationSession;
    displayManager.hideAllEphemeralUI();

    const registeredWeakRefs = Array.from(displayManager.elementRegistry.values());
    let revertedCount = 0;

    for (const weakRef of registeredWeakRefs) {
        const element = weakRef.deref();
        if (element) {
            displayManager.revert(element);
            revertedCount++;
        }
    }

    const leftoverWrappers = documentRef.body.querySelectorAll('foxlate-wrapper[data-foxlate-generated="true"]');
    if (leftoverWrappers.length > 0) {
        leftoverWrappers.forEach(wrapper => {
            if (wrapper.parentNode) {
                wrapper.replaceWith(...wrapper.childNodes);
            }
        });
    }

    return {
        revertedCount,
        leftoverWrapperCount: leftoverWrappers.length,
    };
}
