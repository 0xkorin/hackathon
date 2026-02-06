const enabledEl = document.getElementById("enabled");

const loadState = () => {
  chrome.storage.sync.get({ enabled: true }, (result) => {
    enabledEl.checked = Boolean(result.enabled);
  });
};

const saveState = () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
};

enabledEl.addEventListener("change", saveState);

loadState();
