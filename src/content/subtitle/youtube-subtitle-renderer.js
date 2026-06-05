export class YouTubeSubtitleRenderer {
  constructor(options = {}) {
    this.overlayId = 'san-reader-translation-overlay';
    this.styleId = 'san-reader-renderer-styles';
    this.overlay = null;
    this.lastRenderedState = { lines: null, top: null, left: null };
    this.playerContainerSelector = options.playerContainerSelector;
    this.options = {
      align: 'left',
      fontSize: 1.8,
      backgroundColor: 'rgba(8, 8, 8, 0.75)',
      displayMode: 'off',
      ...options,
    };

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
        #${this.overlayId} {
            position: absolute;
            display: flex;
            flex-direction: column;
            width: 100%;
            pointer-events: none;
            z-index: 10;
            transition: top 0.1s ease-out, opacity 0.1s ease-out;
        }

        #${this.overlayId}[data-align="left"] {
            align-items: flex-start;
        }
        #${this.overlayId}[data-align="center"] {
            align-items: center;
        }

        #${this.overlayId} .translation-line {
            padding: 2px 8px;
            color: #fff;
            background-color: rgba(8, 8, 8, 0.75);
            font-size: 1.8rem;
            line-height: 1.4;
            font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, sans-serif;
            white-space: pre-wrap;
            text-shadow:
                0.05em 0.05em 0.1em rgba(0,0,0,0.9),
                -0.05em -0.05em 0.1em rgba(0,0,0,0.9),
                0.05em -0.05em 0.1em rgba(0,0,0,0.9),
                -0.05em 0.05em 0.1em rgba(0,0,0,0.9);
        }
    `;
    document.head.appendChild(style);
  }

  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    if (this.overlay && newOptions.align) {
      this.overlay.dataset.align = this.options.align;
    }
  }

  render(linesData, captionWindow) {
    const playerContainer = document.querySelector(this.playerContainerSelector);

    if (!playerContainer || !captionWindow || this.options.displayMode === 'off') {
      this.hide();
      return;
    }

    const lines = linesData.filter(line => line.translated && line.translated.trim());
    const linesJoined = lines.map(line => `${line.translated}\n${line.original}`).join('|');
    const isNativeSubsVisible = captionWindow.style.display !== 'none' && captionWindow.offsetHeight > 0;
    if (!isNativeSubsVisible) {
      if (this.lastRenderedState.lines !== null) {
        this.hide();
        this.lastRenderedState = { lines: null, top: null, left: null };
      }
      return;
    }

    const playerRect = playerContainer.getBoundingClientRect();
    const nativeCaptionRect = captionWindow.getBoundingClientRect();
    if (nativeCaptionRect.height === 0 || nativeCaptionRect.width === 0) {
      this.hide();
      return;
    }

    this.#ensureOverlay(playerContainer);

    const top = (nativeCaptionRect.bottom - playerRect.top) + 6;
    const left = nativeCaptionRect.left - playerRect.left;
    const width = nativeCaptionRect.width;
    if (this.lastRenderedState.lines === linesJoined && this.lastRenderedState.top === top) {
      return;
    }

    this.lastRenderedState = { lines: linesJoined, top, left };
    this.overlay.style.top = `${top}px`;
    this.overlay.style.left = `${left}px`;
    this.overlay.style.width = `${width}px`;
    this.overlay.style.opacity = '1';
    this.overlay.style.visibility = 'visible';

    while (this.overlay.children.length > lines.length) {
      this.overlay.lastChild.remove();
    }

    lines.forEach((lineData, index) => {
      const lineText = this.options.displayMode === 'bilingual'
        ? `${lineData.translated}\n${lineData.original}`
        : lineData.translated;
      let lineElement = this.overlay.children[index];

      if (lineElement) {
        if (lineElement.textContent !== lineText) {
          lineElement.textContent = lineText;
        }
      } else {
        lineElement = document.createElement('div');
        lineElement.className = 'translation-line';
        lineElement.textContent = lineText;
        lineElement.style.fontSize = `${this.options.fontSize}rem`;
        lineElement.style.backgroundColor = this.options.backgroundColor;
        this.overlay.appendChild(lineElement);
      }
    });

    if (lines.length === 0) {
      this.hide();
    }
  }

  hide() {
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      this.overlay.style.visibility = 'hidden';
    }
  }

  destroy() {
    document.getElementById(this.overlayId)?.remove();
    document.getElementById(this.styleId)?.remove();
    this.overlay = null;
  }

  #ensureOverlay(playerContainer) {
    if (this.overlay && playerContainer.contains(this.overlay)) {
      return;
    }

    this.overlay = document.getElementById(this.overlayId);
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.id = this.overlayId;
      playerContainer.appendChild(this.overlay);
    } else if (this.overlay.parentElement !== playerContainer) {
      playerContainer.appendChild(this.overlay);
    }
    this.overlay.dataset.align = this.options.align;
  }
}
