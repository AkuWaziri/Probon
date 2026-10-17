# Probon

**Programmable Trust for Agent Payments**

Probon is an on-chain spending control layer for AI-agent payments on **Arc Mainnet**. The smart contract enforces payment policy even when the AI agent itself is untrusted: approved recipients, per-payment caps, daily caps, mandate expiry, funded balance, and revocation.

## Network configuration

- Network: Arc Mainnet
- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- Explorer: `https://explorer.arc.io`
- Native gas asset: USDC
- Native currency units: 18 decimals for native-value transactions
- Official Arc documentation: `https://docs.arc.io`

This app intentionally uses Arc's native USDC value for mandate funding and payments. It does not request ERC-20 approvals. Do not substitute a testnet RPC or a wrapped token address.

## Current implementation

- Responsive dashboard using the Probon white, black, and purple palette.
- Injected EVM wallet connection and Arc Mainnet switching.
- Live native USDC balance reading.
- Solidity mandate contract with owner-funded mandate balances.
- Per-mandate agent identity and recipient allowlist (up to 50 recipients).
- On-chain max-per-payment and daily spending limits.
- Expiry, funding, owner revocation with remaining-balance refund, and global emergency pause.
- UI for mandate creation, funding, revocation, agent inventory, security overview, and real payment execution.
- Reads mandate and payment events from the configured contract.
- Foundry tests and GitHub Actions workflows for frontend builds and Solidity tests.

## Important deployment status

The source code and app integration are committed, but **the Probon contract is not yet deployed**. The app will not submit a contract transaction until a valid contract address is configured.

The dashboard must not be treated as proof of a successful on-chain action. Only a confirmed transaction hash and matching Arc Explorer receipt count as on-chain evidence.

## Configure the deployed contract

After reviewing and deploying `contracts/src/Probon.sol` to Arc Mainnet:

1. Set `VITE_PROBON_CONTRACT_ADDRESS` to the verified deployment address in Vercel's project environment variables.
2. Set `VITE_PROBON_DEPLOYMENT_BLOCK` to the block number containing the deployment transaction. This narrows event queries to the contract's history.
3. Trigger a new GitHub push so the automatic Vercel deployment includes the settings.
4. Connect a wallet on Arc Mainnet.
5. Confirm the contract address shown in Settings matches the deployment you reviewed.
6. Begin with a small amount of native USDC and test mandate creation, allowed payments, blocked recipients, limits, expiry, funding, and revocation.

A mainnet transaction can move real funds. Never paste a seed phrase or private key into the app, repository, chat, or Vercel environment variables. Deployment secrets should be supplied only to a secure local deployment process or an approved secret manager. Review the contract and obtain an independent security review before production use.

## Contract development

Requirements: Foundry.

```powershell
cd contracts
forge build
forge test -vvv
```

The deployment script requires both `DEPLOYER_PRIVATE_KEY` and `EXPECTED_DEPLOYER_ADDRESS` as local environment variables and verifies that they correspond. Never commit these values.

Example deployment command after you explicitly choose to deploy:

```powershell
cd contracts
$env:EXPECTED_DEPLOYER_ADDRESS="0xYOUR_DEPLOYER_ADDRESS"
forge script script/Deploy.s.sol:DeployProbon --rpc-url https://rpc.mainnet.arc.io --broadcast
```

Set `DEPLOYER_PRIVATE_KEY` securely in your local shell before running the command. Do not use a key with funds you cannot afford to risk. This command is documentation only; it has not been run by this repository update.

## Frontend development

```powershell
npm install
npm run dev
npm run build
```

The app reads the contract address from `.env` / Vercel build environment as `VITE_PROBON_CONTRACT_ADDRESS`. Copy `.env.example` to `.env.local` for local development.

## Security model and current limitations

- Each mandate owner funds, configures, and revokes their own mandate.
- Only the configured agent can execute payments for that mandate.
- Recipient allowlisting, expiry, transaction caps, daily caps, and available balance are checked in the contract.
- Contract owner can pause new payments globally; existing mandate owners can still revoke and recover remaining funds.
- The contract has not been independently audited. Do not use substantial funds.
- Current event loading scans from block zero; consider a deployment-block setting or indexed API if the contract grows large.
- This is a smart-contract permission layer, not a guarantee that an agent's intent or recipient is benign.
