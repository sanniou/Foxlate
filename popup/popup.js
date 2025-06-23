document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggleTranslationBtn');
    const optionsBtn = document.getElementById('openOptionsBtn');

    // Function to update button text based on translation status
    const updateButtonText = (isTranslated, showingOriginal) => {
      toggleBtn.textContent = isTranslated ? (showingOriginal ? "Show Translation" : "Show Original") : "Translate This Page";
  };

    // Handle the "Toggle Translation" button click
    toggleBtn.addEventListener('click', async () => {
        try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                await browser.tabs.sendMessage(tab.id, { type: 'DO_TRANSLATE' });
                // Close the popup after clicking
                window.close();
            } else {
                console.error("Could not find active tab.");
            }
        } catch (error) {
            console.error(`Error sending translate message: ${error}`);
            // You could display an error message in the popup here
        }
    });

    // Update button text when popup opens
    const updatePopupView = async () => {
      try {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
              const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_TRANSLATION_STATUS' });
              if (response) {
                  updateButtonText(response.isTranslated, response.showingOriginal);
              }
          }
      } catch (error) {
          console.error("Error getting translation status:", error);
          // If content script isn't loaded, default to "Translate This Page"
          updateButtonText(false, false);
      }
  };

  updatePopupView().then(() => {
    });

    // Handle the "Settings" button click
    optionsBtn.addEventListener('click', () => {
        browser.runtime.openOptionsPage();
        window.close();
    });
});