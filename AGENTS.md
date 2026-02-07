# AGENTS.md

## Intent
Maintain a minimal MetaMask passthrough extension that supports the hackathon UI demo flow.

## Repo relationship (hackathon-ui)
- This extension is designed to be used with https://github.com/0xkorin/hackathon-ui.
- It intercepts ERC20 approvals, stores them, and can spoof allowance reads so the hackathon-ui UI enables the deposit flow.
- Deposit still goes to MetaMask as a normal transaction (no on-chain bundle).

## Verified behavior (code-backed)
- `inpage.js` detects `eth_sendTransaction` calls with ERC20 `approve` calldata (`0x095ea7b3`), blocks the transaction, and emits an approval message.
- `content-script.js` stores captured approvals in `chrome.storage.local`.
- `inpage.js` intercepts `eth_call` allowance reads (`0xdd62ed3e`) and asks the content script for a stored approval match; if found, it returns the stored amount.
- All other provider requests are forwarded to MetaMask unchanged.

## Reference
- Etherscan test tx (Sepolia): https://sepolia.etherscan.io/tx/0x43f9d50160e98104eade0a47da8166630a6198954651426c581e5de4e7c89a8e#eventlog

## Key files
- `inpage.js` - passthrough provider + approval/allowance interception
- `content-script.js` - injects inpage script + stores approvals
- `popup.js` - toggle + batch status UI
- `manifest.json` - extension wiring
