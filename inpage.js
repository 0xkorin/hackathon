(() => {
  if (window.__mmPassthroughInjected) return;
  window.__mmPassthroughInjected = true;

  const currentScript = document.currentScript;
  const enabledAttr = currentScript && currentScript.dataset
    ? currentScript.dataset.passthroughEnabled
    : null;
  const initialEnabled = enabledAttr === null ? true : enabledAttr === "1";

  const getMetaMask = () => {
    const eth = window.ethereum;
    if (!eth) return null;
    // MetaMask sets isMetaMask; if not present, still allow passthrough
    return eth;
  };

  const createPassthrough = (target) => {
    const handler = {
      get(obj, prop) {
        if (prop === "isPassthroughWallet") return true;
        if (prop === "_passthroughTarget") return obj;

        const value = obj[prop];
        if (typeof value === "function") {
          return (...args) => {
            try {
              console.log("MetaMask Passthrough Wallet: forwarding call", String(prop), args);
            } catch (_) {}
            return value.apply(obj, args);
          };
        }
        return value;
      },
      set(obj, prop, value) {
        obj[prop] = value;
        return true;
      }
    };

    return new Proxy(target, handler);
  };

  const mm = getMetaMask();
  if (!mm) {
    console.warn("MetaMask Passthrough Wallet: MetaMask provider not found");
    return;
  }

  const passthrough = createPassthrough(mm);

  // Expose a dedicated passthrough provider.
  window.passthroughEthereum = passthrough;

  const originalEthereum = window.ethereum;
  const originalWeb3 = window.web3;
  const originalWeb3Provider = originalWeb3 ? originalWeb3.currentProvider : undefined;

  const applyOverride = (enabled) => {
    if (enabled) {
      window.ethereum = passthrough;
      if (!window.web3) {
        window.web3 = { currentProvider: passthrough };
      } else {
        window.web3.currentProvider = passthrough;
      }
      return;
    }

    if (originalEthereum === undefined) {
      try {
        delete window.ethereum;
      } catch (_) {
        window.ethereum = undefined;
      }
    } else {
      window.ethereum = originalEthereum;
    }

    if (originalWeb3 === undefined) {
      try {
        delete window.web3;
      } catch (_) {
        window.web3 = undefined;
      }
    } else {
      window.web3 = originalWeb3;
      if (originalWeb3Provider !== undefined) {
        window.web3.currentProvider = originalWeb3Provider;
      }
    }
  };

  applyOverride(initialEnabled);

  const respondAddress = async (requestId) => {
    let address = null;
    try {
      if (passthrough.selectedAddress) {
        address = passthrough.selectedAddress;
      } else if (passthrough.request) {
        const accounts = await passthrough.request({ method: "eth_accounts" });
        if (Array.isArray(accounts) && accounts.length) {
          address = accounts[0];
        }
      }
    } catch (_) {}

    window.postMessage(
      {
        source: "mm-passthrough",
        type: "MM_PASSTHROUGH_ADDRESS_RESPONSE",
        requestId,
        address
      },
      "*"
    );
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_GET_ADDRESS") return;
    respondAddress(event.data.requestId);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_SET_ENABLED") return;
    applyOverride(Boolean(event.data.enabled));
  });
})();
