# API Reference

All routes are Next.js App Router Route Handlers under /app/api.

Environment variables used across APIs:
- HELIUS_RPC_URL or NEXT_PUBLIC_HELIUS_RPC_URL or NEXT_PUBLIC_RPC_URL: Mainnet RPC used by the server.
- BLOXROUTE_AUTH or BLOXROUTE_API_KEY (or NEXT_PUBLIC_BLOXROUTE_API_KEY as last fallback): Authorization header for bloXroute.
- BLOXROUTE_REGION_URL: Base URL for Jupiter proxy (e.g. https://ny.solana.dex.blxrbdn.com).
- BLOXROUTE_SUBMIT_URL: Base URL to submit signed transactions (e.g. http://global.solana.dex.blxrbdn.com).

Note: Only variables prefixed with NEXT_PUBLIC are available on the client; non‑prefixed variables are server-only [^1].

---

1) POST /api/snipe

Multiplexed buy across many wallets using the bloXroute Jupiter proxy.

Body
{
  "mint": "TokenMintAddress",
  "privateKeys": ["...base58OrJson...", "..."],
  "limitWallets": 65,          // optional, caps number of wallets used (default 65)
  "percentage": 50             // optional, % of each wallet's SOL balance to spend (default 50)
}

What it does
- Decodes each private key to a Keypair.
- Fetches SOL balance for each wallet using the configured RPC.
- For each wallet with funds:
  - spendLamports = floor(balance × percentage/100) − feeReserve
  - Asks bloXroute Jupiter proxy for an unsigned swap (SOL → mint).
  - Signs the VersionedTransaction with the wallet’s key.
  - Submits the signed base64 via bloXroute submit endpoint with skipPreFlight.

Response (example)
{
  "mint": "TokenMintAddress",
  "wallets": 22,
  "seconds": "1.86",
  "success": 18,
  "failures": 4,
  "ok": [
    { "wallet": "WalletPubkey...", "signature": "5k...Nh" }
  ],
  "fail": [
    { "wallet": "WalletPubkey...", "error": "insufficient after reserve" }
  ]
}

Errors you may see
- 400 mint and privateKeys required
- 400 no valid keys
- 500 BLOXROUTE_AUTH not set
- Per-wallet errors like swap 4xx, submit 4xx, or insufficient after reserve

---

Other endpoints you may also have in your workspace

Depending on your project state, these endpoints can exist as simpler/alternative flows:

2) POST /api/buy (if present)
- Purpose: Single-wallet or simple multi-wallet buy using Jupiter’s API directly (without bloXroute proxy).
- Typical body: { "mint": "...", "solAmount": number, "slippageBps": number, "secretKey": "..." }
- Returns: { "signature": "...", "explorerUrl": "..." }

3) POST /api/sell (if present)
- Purpose: Swap token back to SOL using Jupiter’s API.
- Typical body: { "mint": "...", "tokenAmount": number, "slippageBps": number, "secretKey": "..." }
- Returns: { "signature": "...", "explorerUrl": "..." }

4) POST /api/simple-buy (if present)
- Purpose: A minimal “quick buy” wrapper around Jupiter for demo or testing.
- Typical body: { "mint": "...", "solAmount": number, "privateKey": "..." }
- Returns: { "signature": "...", "outAmount": number }

5) POST /api/simple-sell (if present)
- Purpose: A minimal “quick sell” wrapper around Jupiter.
- Typical body: { "mint": "...", "tokenAmount": number, "privateKey": "..." }
- Returns: { "signature": "...", "outAmount": number }

6) GET /api/price (if present)
- Purpose: Helper to fetch current SOL price or token price for UI.
- Query: e.g. /api/price?symbol=SOL
- Returns: { "symbol": "SOL", "price": number }

If you’d like, I can generate or wire these endpoints exactly as described above so they’re guaranteed present and consistent with /api/snipe.
