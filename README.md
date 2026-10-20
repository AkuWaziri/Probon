# Probon

Probon is a creator-campaign marketplace being prepared for Arc Mainnet.

## Stack

- Vite + React + TypeScript
- Supabase Auth and Postgres with row-level security
- Arc Mainnet (chain ID 5042) for campaign escrow and payouts

## Supabase setup

1. In Supabase, enable **Authentication → Sign In / Providers → Web3 Wallet → Ethereum**.
2. Add the production Probon URL and local development URL to Authentication URL configuration / allowed redirect URLs.
3. Apply `supabase/migrations/202610200001_initial_marketplace.sql` in the Supabase SQL Editor, or use the Supabase CLI migration workflow.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel for Production, Preview, and Development. These are browser-public values; never use a service-role key in a `VITE_*` variable.
5. Test row-level security with two separate wallets before enabling real campaigns.

## Launch status

The migration establishes the initial persistent schema and row-level security baseline. It does not deploy an Arc escrow contract, confirm deposits, send notifications, or execute payouts. Real-money features must remain disabled until the escrow contract and transaction verification flow are implemented and tested.

The campaign budget and 5% platform fee must be handled atomically by the escrow contract; a failed transaction must not leave partial transfers. The platform fee recipient is `0x5Bce25397eEfbc76f6479e6838c00a5115dbEA4c`.
