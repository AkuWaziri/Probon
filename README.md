# Probon

**Programmable Trust for Agent Payments**

Probon is a smart-contract-based spending control layer for AI agents that need to make USDC payments. The contract, not the AI model, should enforce transaction limits, recipient permissions, mandate expiry, and revocation.

## Current status

This repository starts with the responsive React dashboard UI. Wallet interactions, smart contracts, live transaction data, and Arc integration are **not implemented yet**. The dashboard intentionally labels its transaction area as preview data; do not treat any displayed activity as on-chain evidence.

## Stack

- React + TypeScript
- Vite
- Lucide icons
- Solidity contracts and viem integration will be added after the contract architecture and Arc network configuration are verified against official documentation.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Planned implementation order

1. Dashboard and responsive UI foundation.
2. Define mandate and payment security requirements.
3. Implement and test Solidity contracts.
4. Verify Arc Testnet configuration and connect wallet.
5. Integrate mandate creation, policy-enforced payments, and revocation.
6. Add integration tests and verify real testnet transactions.

Never place private keys, seed phrases, or production secrets in this repository.
