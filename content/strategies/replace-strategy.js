export function replaceStrategy(element, translatedText) {
  // 保存原文，以便恢复或悬浮显示
  if (!element.dataset.originalText) {
    element.dataset.originalText = element.textContent;
  }
  element.textContent = translatedText;
}
