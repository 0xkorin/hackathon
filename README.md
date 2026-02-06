# MetaMask Passthrough Wallet (Chrome Extension)

A minimal Chrome extension that exposes a Web3 wallet interface by passing all calls through to the existing MetaMask provider.

## What it does
- Injects `inpage.js` at `document_start`.
- If MetaMask is present, exposes `window.passthroughEthereum` as a direct passthrough provider.
- Overrides `window.ethereum` with the passthrough provider when enabled.
- Adds a tiny legacy `window.web3.currentProvider` shim.

## Install (unpacked)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Notes
- This extension does not request permissions beyond content script injection.
- It does not add its own UI or key management; it delegates to MetaMask.
- If MetaMask is not installed, it logs a warning and does nothing.
- Toggling the override applies on the next page load.
