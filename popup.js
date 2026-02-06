const enabledEl = document.getElementById("enabled");
const addressEl = document.getElementById("address");
const refreshEl = document.getElementById("refresh");
const batchStatusEl = document.getElementById("batch-status");
const batchListEl = document.getElementById("batch-list");
const resetEl = document.getElementById("reset-batch");

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

const formatApproval = (entry, index) => {
  const time = entry.time ? new Date(entry.time).toLocaleTimeString() : "";
  const to = entry.to || "unknown";
  const from = entry.from || "unknown";
  return `${index + 1}. ${time} | from ${from} -> ${to}`;
};

const loadBatch = () => {
  chrome.storage.local.get({ approvals: [], batchActive: false }, (result) => {
    const approvals = Array.isArray(result.approvals) ? result.approvals : [];
    batchStatusEl.textContent = result.batchActive ? "Active" : "Idle";
    if (!approvals.length) {
      batchListEl.textContent = "No approvals captured.";
      return;
    }
    batchListEl.textContent = approvals
      .map((entry, index) => formatApproval(entry, index))
      .join("\n");
  });
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.approvals || changes.batchActive) {
    loadBatch();
  }
});

const resetBatch = () => {
  chrome.storage.local.set({ approvals: [], batchActive: false });
};

resetEl.addEventListener("click", resetBatch);

loadState();
fetchAddress();
loadBatch();
