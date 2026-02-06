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
})();
