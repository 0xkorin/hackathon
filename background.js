(() => {
  const ICON_URL =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI0IiBmaWxsPSIjRTFGOEZEIi8+PGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iMzYiIGZpbGw9IiMyRTVGRkYiLz48L3N2Zz4=";

  const setBadge = (active) => {
    try {
      chrome.action.setBadgeText({ text: active ? "●" : "" });
      if (active) {
        chrome.action.setBadgeBackgroundColor({ color: "#2E5FFF" });
      }
    } catch (_) {}
  };

  const refreshBadge = () => {
    try {
      chrome.storage.local.get({ batchActive: false }, (result) => {
        setBadge(Boolean(result.batchActive));
      });
    } catch (_) {}
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "MM_PASSTHROUGH_BATCH_STARTED") return;
    chrome.notifications.create({
      type: "basic",
      iconUrl: ICON_URL,
      title: "MetaMask Passthrough Wallet",
      message: "New approval captured. Batch started."
    });
    setBadge(true);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.batchActive) return;
    setBadge(Boolean(changes.batchActive.newValue));
  });

  chrome.runtime.onStartup.addListener(refreshBadge);
  chrome.runtime.onInstalled.addListener(refreshBadge);
  refreshBadge();
})();
