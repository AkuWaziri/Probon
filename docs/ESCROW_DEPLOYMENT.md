# Probon Arc escrow contract

## What this does

- Compiles and tests the escrow contract on pushes and pull requests.
- Supports a guarded, manual deployment to Arc Mainnet (chain ID 5042) from GitHub Actions.
- Routes the 5% campaign fee to the configured fee recipient in the same transaction that creates the campaign; if the fee transfer fails, the whole transaction reverts.
- Holds the campaign reward budget in escrow, pays a participant only when the campaign creator approves submitted work, and allows the creator to recover remaining budget after the deadline only after every joined participant has been finalized.

Arc's native asset is used for amounts. Confirm Arc Mainnet's current native-asset semantics and test with a small value before real use.

## One-time GitHub setup

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `DEPLOYER_PRIVATE_KEY`: private key for the deployment wallet
- `EXPECTED_DEPLOYER_ADDRESS`: public address for that same wallet; the workflow verifies that it matches the private key
- Optional: `ARC_RPC_URL` to override the default Arc Mainnet RPC endpoint (`https://rpc.mainnet.arc.io`)

Never commit the private key, put it in a `VITE_*` variable, or paste it into chat. Use a dedicated wallet and verify the fee recipient before deploying.

Then open **Settings → Environments → New environment**, create `arc-mainnet`, and consider adding required reviewers / deployment protection.

## Deploy from GitHub

1. Open **Actions → Probon Arc escrow**.
2. Select **Run workflow** on the `main` branch.
3. Enter `DEPLOY` exactly in the deployment confirmation field.
4. Keep the fee recipient as `0x5Bce25397eEfbc76f6479e6838c00a5115dbEA4c`, unless intentionally changing it.
5. Click **Run workflow**. The workflow builds and runs tests first; deployment runs only if tests pass and the confirmation is exact.
6. Open the completed run and its summary/artifact to retrieve the contract address and deployment transaction.

## After deployment

Set these Vercel environment variables and redeploy the frontend:

- `VITE_PROBON_CONTRACT_ADDRESS`: deployed address from the workflow
- `VITE_PROBON_DEPLOYMENT_BLOCK`: deployment block number from Arc explorer / transaction receipt

The current frontend is not yet integrated with the escrow ABI for funding, submissions, approval, or payouts. Deploying the contract does not automatically enable those UI actions. Do not accept production funds until contract tests, independent review, and end-to-end wallet tests are complete.

## Contract semantics

- `createCampaign(budget, rewardPerParticipant, slots, deadline)` expects `msg.value == budget + floor(budget * 5 / 100)`.
- `joinCampaign(campaignId)` is limited to one participation per address and available slots.
- `submitWork(campaignId, url)` is one-time per participant and only before the deadline.
- `approveSubmission(campaignId, participant)` pays the configured reward immediately.
- `rejectSubmission(campaignId, participant)` finalizes a submitted item, or a non-submission after the deadline.
- `refundRemainingBudget(campaignId)` is available after the deadline only after all joined participants have been finalized.

This is an initial implementation, not an audited contract. Review and test it before handling real funds.
