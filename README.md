# Probon

Probon is a creator-campaign marketplace. The `base-sepolia-usdc-migration` branch prepares the escrow contract for Base Sepolia using ERC-20 USDC.

## Base Sepolia test configuration

- Network: Base Sepolia
- Chain ID: 84532
- RPC: https://sepolia.base.org
- Explorer: https://sepolia.basescan.org
- USDC test token: 0x036CbD53842c5426634e7929541eC2318f3dCF7e (6 decimals)
- Gas token: test ETH

## Contract build and tests

Install Foundry, then run from the repository root:

```sh
forge build --sizes
forge test -vvv
```

The tests use a local mock ERC-20 with six decimals. They do not send transactions to Base Sepolia.

## Deploy to Base Sepolia

1. Ensure the contract tests pass and review the Solidity source.
2. In GitHub repository settings, add Actions secrets:
   - `DEPLOYER_PRIVATE_KEY`: private key of the testnet deployer only; never commit it or paste it into chat.
   - `EXPECTED_DEPLOYER_ADDRESS`: public address corresponding to that key.
   - Optional `BASE_SEPOLIA_RPC_URL`: defaults to the public Base Sepolia RPC.
3. Ensure the deployer wallet has Base Sepolia test ETH for gas.
4. Open Actions → **Probon Base Sepolia escrow** → Run workflow.
5. Enter `DEPLOY`, the published Base Sepolia USDC address, and the intended platform fee recipient wallet.
6. Confirm the deployment summary includes a successful transaction and contract address; verify it on Base Sepolia Explorer.

## Important status

This branch migrates the escrow contract and adds a gated testnet deployment workflow. The existing frontend currently saves campaign drafts and participation UI state without invoking this contract. Do not treat a campaign draft, join, submission, or approval shown in the UI as an on-chain transaction. The frontend must be integrated with the deployed contract and the database's campaign records before end-to-end campaign use is enabled. Real-money Base Mainnet use requires a separate review and deployment.
