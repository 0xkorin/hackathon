# MetaMask Passthrough Wallet (Chrome Extension)

## Overview
A minimal Chrome extension that exposes a passthrough provider for MetaMask and adds an approval/allowance capture layer used by the hackathon UI flow.

## Repo relationship (hackathon-ui)
- This extension is designed to be used with https://github.com/0xkorin/hackathon-ui.
- It intercepts ERC20 approvals, stores them, and can spoof allowance reads so the hackathon-ui UI enables the deposit flow.
- Deposit still goes to MetaMask as a normal transaction (no on-chain bundle).

## Setup (unpacked)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Use the popup to toggle the passthrough override if needed.

## How it works
- `content-script.js` injects `inpage.js` at `document_start`.
- `inpage.js` exposes `window.passthroughEthereum`, optionally overrides `window.ethereum`, and adds a legacy `window.web3.currentProvider` shim.
- ERC20 `approve` transactions are detected (`0x095ea7b3`), blocked, and stored in `chrome.storage.local`.
- ERC20 `allowance` reads (`0xdd62ed3e`) are checked against stored approvals; matching requests return the stored amount so dapps see the allowance.
- All other requests are forwarded to MetaMask unchanged.

## Contracts / test tx
- This extension does not hardcode token or spender addresses; it only inspects calldata.
- Reference test tx (Sepolia): https://sepolia.etherscan.io/tx/0x43f9d50160e98104eade0a47da8166630a6198954651426c581e5de4e7c89a8e#eventlog

## Tests
- No automated test suite is included in this repo.
