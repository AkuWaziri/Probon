# Probon Mainnet Test Plan

**Network:** Arc Mainnet, chain ID 5042  
**RPC:** https://rpc.mainnet.arc.io  
**Explorer:** https://explorer.arc.io

This plan is for use after the contract has been reviewed, deployed, and configured. Do not treat UI preview states as on-chain evidence. Mainnet tests use real USDC and are irreversible.

## 1. Build checks

- [ ] GitHub Actions frontend build passes.
- [ ] Foundry contract tests pass with `cd contracts && forge test -vvv`.
- [ ] Review the exact Solidity source intended for deployment.
- [ ] Confirm the deployer address matches the intended administrator.
- [ ] Never commit or paste a private key, seed phrase, or entity secret.

## 2. Configure the deployed contract

- [ ] Deploy `contracts/src/Probon.sol` to Arc Mainnet using the intended deployer.
- [ ] Record the deployment transaction hash and contract address.
- [ ] Confirm the receipt is successful and the deployed bytecode exists on Arc Explorer.
- [ ] Set `VITE_PROBON_CONTRACT_ADDRESS` in the Vercel production environment.
- [ ] Set `VITE_PROBON_DEPLOYMENT_BLOCK` to the deployment block number.
- [ ] Push a commit so the environment configuration is included in the next automatic build.
- [ ] Open Settings in Probon and confirm chain ID, contract address, and connected wallet.

## 3. Low-value end-to-end checks

Use a wallet with only the small amount of native USDC you intend to risk. Leave enough native USDC for gas.

- [ ] Connect an EVM wallet; confirm the app switches to Arc Mainnet and reads the native USDC balance.
- [ ] Create a mandate with a dedicated agent wallet, one controlled recipient, conservative per-payment and daily limits, short expiry, and zero or minimal initial funding.
- [ ] Confirm the transaction on Arc Explorer and check that the mandate appears in the app.
- [ ] Fund the mandate with a small amount and confirm the on-chain balance changes.
- [ ] Connect the designated agent wallet and execute a small payment to the allowed recipient.
- [ ] Confirm the recipient balance, contract event, transaction receipt, and payment history.
- [ ] Simulate or attempt a payment to a non-allowlisted recipient. Prefer wallet simulation first; a reverted mainnet transaction still costs gas.
- [ ] Confirm the contract rejects an amount above the per-payment cap.
- [ ] Confirm the contract rejects spend above the daily cap.
- [ ] Revoke the mandate from its owner wallet and confirm remaining funds are refunded.
- [ ] If the deployment administrator is available, test global pause/resume with a minimal-value setup and verify that owner revocation still works while paused.

## 4. Contract-level test coverage

The Foundry suite covers creation, funding balance, allowed payments, recipient allowlisting, per-payment caps, daily caps, expiry, revocation refunds, and global pause. Use Foundry's timestamp controls to test expiry and daily-window boundaries without waiting on mainnet.

## 5. Arc Studio evidence

Open Probon from GitHub in Arc Studio for a genuine source review and app trace/review session, then retain the relevant review or trace evidence for the hackathon submission. Arc Studio's current public page describes one-click deployment to Arc Testnet and other EVM testnets; do not treat a testnet deployment as the required Arc Mainnet deployment or as proof of a mainnet transaction.

## Pass criteria

A test passes only when the UI result matches the confirmed Arc Mainnet receipt, emitted contract event, and resulting balances. Screenshots or local preview states alone do not prove on-chain execution.
