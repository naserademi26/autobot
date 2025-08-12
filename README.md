# Solana Sniper – 65 Wallets (Vercel-ready)

- Smooth Next.js + Tailwind UI
- Connect step: paste private keys into a local vault (client-side)
- Token resolution from Jupiter token list then Pump.fun
- Buy with percentage buttons (25/50/75/95/100)
- Backend builds swaps via bloXroute Jupiter proxy, signs, submits all at once

## Environment Variables (set in your platform/dashboard)

- HELIUS_RPC_URL – your Helius mainnet RPC (or public Solana RPC)
- BLOXROUTE_AUTH – your bloXroute Authorization header (or use BLOXROUTE_API_KEY)
- BLOXROUTE_REGION_URL – e.g. https://ny.solana.dex.blxrbdn.com
- BLOXROUTE_SUBMIT_URL – e.g. http://global.solana.dex.blxrbdn.com
- NEXT_PUBLIC_HELIUS_RPC_URL – for wallet adapter connection (client)

This v0 environment does not load .env files; set them in the deployment environment.

## Run locally

npm install
npm run dev

## Notes

- Client UI keeps keys local until you execute; then they are sent only for this run to sign the swaps.
- API uses bloXroute Jupiter proxy to construct and submit transactions quickly.
