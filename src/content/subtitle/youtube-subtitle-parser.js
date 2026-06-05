export function parseYouTubeTimedSentences(subtitleContent) {
  if (!subtitleContent || subtitleContent.trim() === '') {
    throw new Error('Content is empty.');
  }

  const jsonData = JSON.parse(subtitleContent);
  if (!jsonData || !Array.isArray(jsonData.events)) {
    throw new Error('Invalid JSON format.');
  }

  const rawBlocks = jsonData.events
    .filter(event => event.segs)
    .map(event => {
      const text = event.segs.map(segment => segment.utf8).join('');
      return {
        rawText: text,
        trimmedText: text.trim(),
        startTime: event.tStartMs,
        endTime: event.tStartMs + (event.dDurationMs || 3000),
      };
    })
    .filter(block => block.trimmedText && !(block.trimmedText.startsWith('[') && block.trimmedText.endsWith(']')))
    .map(block => ({
      text: block.rawText.replace(/\n/g, ' ').trim(),
      startTime: block.startTime,
      endTime: block.endTime,
    }));

  if (rawBlocks.length === 0) {
    return [];
  }

  const timedSentences = [];
  let sentenceBuffer = '';
  let sentenceStartTime = -1;
  const sentenceBoundaryRegex = /(.*?[.!?。？！])/;

  for (const block of rawBlocks) {
    if (sentenceBuffer.trim() === '') {
      sentenceStartTime = block.startTime;
    }

    sentenceBuffer += `${block.text} `;

    while (sentenceBoundaryRegex.test(sentenceBuffer)) {
      const match = sentenceBuffer.match(sentenceBoundaryRegex);
      const sentenceText = match[1].trim();
      if (sentenceText) {
        timedSentences.push({
          text: sentenceText,
          startTime: sentenceStartTime,
          endTime: block.endTime,
        });
      }

      sentenceBuffer = sentenceBuffer.substring(match[0].length);
      if (sentenceBuffer.trim() !== '') {
        sentenceStartTime = block.startTime;
      }
    }
  }

  const remainingText = sentenceBuffer.trim();
  if (remainingText && sentenceStartTime !== -1) {
    timedSentences.push({
      text: remainingText,
      startTime: sentenceStartTime,
      endTime: rawBlocks[rawBlocks.length - 1].endTime,
    });
  }

  return timedSentences;
}
