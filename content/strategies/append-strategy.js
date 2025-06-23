export function appendStrategy(element, translatedText) {
  if (!element.dataset.originalText) {
    element.dataset.originalText = element.textContent;
  }
  // 防止重复追加
  if (element.querySelector('.translator-appended-text')) {
    element.querySelector('.translator-appended-text').textContent = translatedText;
  } else {
    const translationNode = document.createElement('span');
    translationNode.className = 'translator-appended-text';
    translationNode.style.color = 'gray'; // 自定义样式
    translationNode.style.marginLeft = '8px';
    translationNode.textContent = `(${translatedText})`;
    element.appendChild(translationNode);
  }
}
