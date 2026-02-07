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

  const normalize = (value) => (typeof value === "string" ? value.toLowerCase() : null);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_APPROVAL") return;

    const tx = event.data.tx || {};
    const parsed = event.data.parsed || {};
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: Date.now(),
      from: tx.from || null,
      to: tx.to || null,
      data: tx.data || null,
      value: tx.value || null,
      token: parsed.token || tx.to || null,
      owner: parsed.owner || tx.from || null,
      spender: parsed.spender || null,
      amount: parsed.amount || null
    };

    chrome.storage.local.get({ approvals: [], batchActive: false }, (result) => {
      const approvals = Array.isArray(result.approvals) ? result.approvals : [];
      approvals.push(entry);
      if (!result.batchActive) {
        try {
          chrome.runtime.sendMessage({
            type: "MM_PASSTHROUGH_BATCH_STARTED",
            approval: entry
          });
        } catch (_) {}
      }
      chrome.storage.local.set({
        approvals,
        batchActive: true
      });
    });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_ALLOWANCE_QUERY") return;

    const token = normalize(event.data.token);
    const owner = normalize(event.data.owner);
    const spender = normalize(event.data.spender);
    const requestId = event.data.requestId || null;

    chrome.storage.local.get({ approvals: [] }, (result) => {
      const approvals = Array.isArray(result.approvals) ? result.approvals : [];
      const match = approvals.find((entry) => {
        return (
          normalize(entry.token) === token &&
          normalize(entry.owner) === owner &&
          normalize(entry.spender) === spender
        );
      });

      if (requestId) {
        window.postMessage(
          {
            source: "mm-passthrough",
            type: "MM_PASSTHROUGH_ALLOWANCE_MATCH",
            requestId,
            approval: match || null
          },
          "*"
        );
        return;
      }

      if (!match) return;
      window.postMessage(
        {
          source: "mm-passthrough",
          type: "MM_PASSTHROUGH_ALLOWANCE_MATCH",
          approval: match
        },
        "*"
      );
    });
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_BATCH_QUERY") return;

    const requestId = event.data.requestId || null;

    chrome.storage.local.get({ approvals: [], batchActive: false }, (result) => {
      const approvals = Array.isArray(result.approvals) ? result.approvals : [];
      const batch = {
        batchActive: Boolean(result.batchActive),
        approvals
      };

      window.postMessage(
        {
          source: "mm-passthrough",
          type: "MM_PASSTHROUGH_BATCH_RESPONSE",
          requestId,
          batch
        },
        "*"
      );
    });
  });
})();
