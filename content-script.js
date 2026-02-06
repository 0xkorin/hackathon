(() => {
  const inject = (enabled) => {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("inpage.js");
      script.type = "text/javascript";
      script.async = false;
      script.dataset.passthroughEnabled = enabled ? "1" : "0";
      (document.head || document.documentElement).appendChild(script);
      script.parentNode.removeChild(script);
    } catch (err) {
      console.warn("MetaMask Passthrough Wallet: failed to inject", err);
    }
  };

  try {
    chrome.storage.sync.get({ enabled: true }, (result) => {
      inject(Boolean(result.enabled));
    });
  } catch (err) {
    console.warn("MetaMask Passthrough Wallet: storage access failed", err);
    inject(true);
  }

  const waitForAddress = () =>
    new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const onMessage = (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.source !== "mm-passthrough") return;
        if (event.data.type !== "MM_PASSTHROUGH_ADDRESS_RESPONSE") return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener("message", onMessage);
        resolve(event.data.address || null);
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: "mm-passthrough",
          type: "MM_PASSTHROUGH_GET_ADDRESS",
          requestId
        },
        "*"
      );

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, 1500);
    });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "MM_PASSTHROUGH_GET_ADDRESS") return;
    waitForAddress().then((address) => {
      sendResponse({ address });
    });
    return true;
  });

  const sendEnabled = (enabled) => {
    window.postMessage(
      {
        source: "mm-passthrough",
        type: "MM_PASSTHROUGH_SET_ENABLED",
        enabled
      },
      "*"
    );
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.enabled) return;
    sendEnabled(Boolean(changes.enabled.newValue));
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "MM_PASSTHROUGH_SET_ENABLED") return;
    sendEnabled(Boolean(message.enabled));
    sendResponse({ ok: true });
  });
})();
