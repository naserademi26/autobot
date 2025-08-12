# What this bot does

This app is a multi‑wallet Solana “sniper” that buys a target token from many wallets at once, fast.

Core flow:
- Import wallets (client-side “vault”): Paste base58 or JSON secret keys. The app derives public keys locally and lets you select which wallets to use for a run.
- Pick a token mint: The UI resolves name/symbol from Jupiter’s token list first, then Pump.fun as fallback.
- Choose percentage: Select how much of each wallet’s SOL balance to spend (25/50/75/95/100).
- Execute a buy across wallets:
  - The API fetches each wallet’s SOL balance.
  - It computes per-wallet spend = balance × percentage − small fee reserve.
  - For each wallet, it requests an unsigned swap transaction (SOL → your token) from the bloXroute Jupiter proxy, signs it with that wallet’s keypair, and submits the signed transaction through bloXroute.
  - Results are aggregated (signatures/errors), with total run time.

Why it’s fast:
- All wallets are processed in parallel (Promise.all).
- Transactions are constructed via Jupiter and broadcast with bloXroute using skipPreFlight to reduce latency.
- A small fee reserve prevents “insufficient funds” during submission.

Environment model:
- Sensitive environment variables (RPC URL, bloXroute credentials) are used on the server route handlers and are not exposed to the client unless prefixed with NEXT_PUBLIC, per Next.js conventions [^1].
