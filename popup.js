const enabledEl = document.getElementById("enabled");
const addressEl = document.getElementById("address");
const refreshEl = document.getElementById("refresh");

const loadState = () => {
  chrome.storage.sync.get({ enabled: true }, (result) => {
    enabledEl.checked = Boolean(result.enabled);
  });
};

const saveState = () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
};

const notifyActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "MM_PASSTHROUGH_SET_ENABLED",
      enabled: enabledEl.checked
    });
  } catch (_) {}
};

enabledEl.addEventListener("change", () => {
  saveState();
  notifyActiveTab();
});

const setAddress = (value) => {
  addressEl.textContent = value || "Not connected";
};

const fetchAddress = async () => {
  setAddress("Checking...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setAddress("No active tab");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "MM_PASSTHROUGH_GET_ADDRESS"
    });
    setAddress((response && response.address) || "Not connected");
  } catch (_) {
    setAddress("Unavailable on this page");
  }
};

refreshEl.addEventListener("click", fetchAddress);

loadState();
fetchAddress();
