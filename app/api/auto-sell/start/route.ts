import { type NextRequest, NextResponse } from "next/server"

// Global state for the auto-sell engine
const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  window: { trades: [], windowSec: 120, minUsd: 1 } as any,
  metrics: { buys: 0, sells: 0, net: 0, priceUsd: 0 },
  intervals: [] as NodeJS.Timeout[],
}

export async function POST(request: NextRequest) {
  try {
    const { config, privateKeys } = await request.json()

    if (autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is already running" }, { status: 400 })
    }

    // Validate configuration
    if (!config.mint || !privateKeys || privateKeys.length === 0) {
      return NextResponse.json({ error: "Invalid configuration or no wallets provided" }, { status: 400 })
    }

    // Initialize wallets
    const { Keypair } = await import("@solana/web3.js")
    const bs58 = await import("bs58")

    const wallets = []
    for (let i = 0; i < privateKeys.length; i++) {
      try {
        const privateKey = privateKeys[i]
        let keypair

        if (privateKey.startsWith("[")) {
          const arr = Uint8Array.from(JSON.parse(privateKey))
          keypair = Keypair.fromSecretKey(arr)
        } else {
          const secret = bs58.default.decode(privateKey)
          keypair = Keypair.fromSecretKey(secret)
        }

        wallets.push({
          name: `Wallet ${i + 1}`,
          keypair,
          publicKey: keypair.publicKey.toBase58(),
          cooldownUntil: 0,
          lastBal: 0,
          lastSig: "",
          balance: 0,
          tokenBalance: 0,
        })
      } catch (error) {
        console.error(`Failed to parse wallet ${i}:`, error)
      }
    }

    if (wallets.length === 0) {
      return NextResponse.json({ error: "No valid wallets could be parsed" }, { status: 400 })
    }

    // Update global state
    autoSellState.config = config
    autoSellState.wallets = wallets
    autoSellState.window = {
      trades: [],
      windowSec: config.windowSeconds,
      minUsd: config.minTradeUsd,
    }
    autoSellState.isRunning = true

    // Start monitoring and execution intervals
    startAutoSellEngine()

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets`,
      config: config,
    })
  } catch (error) {
    console.error("Error starting auto-sell:", error)
    return NextResponse.json({ error: "Failed to start auto-sell engine" }, { status: 500 })
  }
}

function startAutoSellEngine() {
  // Clear any existing intervals
  autoSellState.intervals.forEach((interval) => clearInterval(interval))
  autoSellState.intervals = []

  // Trade monitoring interval (every 15 seconds - DexScreener fallback)
  const tradeMonitorInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await monitorTrades()
    } catch (error) {
      console.error("Trade monitoring error:", error)
    }
  }, 15000)

  // Auto-sell execution interval (every 5 seconds)
  const executionInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await executeAutoSell()
    } catch (error) {
      console.error("Auto-sell execution error:", error)
    }
  }, 5000)

  autoSellState.intervals.push(tradeMonitorInterval, executionInterval)
}

async function monitorTrades() {
  try {
    // Use DexScreener to estimate net USD activity
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${autoSellState.config.mint}`)
    const data = await response.json()

    if (!Array.isArray(data) || data.length === 0) return

    const pairs = data.sort((a: any, b: any) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))
    const pair = pairs[0] || {}

    const buys = Number(pair?.txns?.m5?.buys || 0)
    const sells = Number(pair?.txns?.m5?.sells || 0)
    const vol5 = Number((pair?.volume && (pair.volume.m5 ?? pair.volume.h1)) || 0)
    const priceUsd = Number(pair?.priceUsd || 0)

    if (!vol5 || (!buys && !sells)) return

    // Calculate net activity and add to window
    const imbalance = (buys - sells) / Math.max(1, buys + sells)
    const net5 = vol5 * imbalance
    const net2 = net5 * (2 / 5) // Scale to 2-minute window

    if (Math.abs(net2) >= autoSellState.window.minUsd) {
      const side = net2 >= 0 ? "buy" : "sell"
      pushAndPrune(autoSellState.window, {
        side,
        usd: Math.abs(net2),
        ts: Date.now(),
      })
    }

    // Update price
    autoSellState.metrics.priceUsd = priceUsd
  } catch (error) {
    console.error("Trade monitoring error:", error)
  }
}

async function executeAutoSell() {
  try {
    // Calculate net position
    const { buys, sells, net } = netUsd(autoSellState.window)
    autoSellState.metrics = { buys, sells, net, priceUsd: autoSellState.metrics.priceUsd }

    if (net <= 0 || autoSellState.metrics.priceUsd <= 0) return

    const targetUsd = net * autoSellState.config.sellFractionOfNetUsd
    const sellTokens = targetUsd / autoSellState.metrics.priceUsd

    // Execute sells for eligible wallets
    for (const wallet of autoSellState.wallets) {
      if (Date.now() < wallet.cooldownUntil) continue

      // Update wallet balances
      await updateWalletBalances(wallet)

      const toSell = Math.min(sellTokens, wallet.tokenBalance)
      if (toSell <= 0) continue

      try {
        const signature = await executeSell(wallet, toSell)
        wallet.lastSig = signature
        wallet.cooldownUntil = Date.now() + autoSellState.config.cooldownSeconds * 1000

        console.log(`[AUTO-SELL] ${wallet.name} sold ${toSell.toFixed(4)} tokens, sig: ${signature}`)
      } catch (error) {
        console.error(`[AUTO-SELL ERROR] ${wallet.name}:`, error)
      }
    }
  } catch (error) {
    console.error("Auto-sell execution error:", error)
  }
}

async function updateWalletBalances(wallet: any) {
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js")
    const { getAssociatedTokenAddress } = await import("@solana/spl-token")

    const connection = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ||
        process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
        "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
      { commitment: "confirmed" },
    )

    // Get SOL balance
    const solBalance = await connection.getBalance(wallet.keypair.publicKey)
    wallet.balance = solBalance / 1e9

    // Get token balance
    try {
      const mintPubkey = new PublicKey(autoSellState.config.mint)
      const ata = await getAssociatedTokenAddress(mintPubkey, wallet.keypair.publicKey)
      const tokenAccount = await connection.getTokenAccountBalance(ata)
      wallet.tokenBalance = tokenAccount.value?.uiAmount || 0
    } catch {
      wallet.tokenBalance = 0
    }
  } catch (error) {
    console.error("Error updating wallet balances:", error)
  }
}

async function executeSell(wallet: any, amount: number) {
  const axios = await import("axios")
  const { Connection, VersionedTransaction } = await import("@solana/web3.js")

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    { commitment: "confirmed" },
  )

  // Get token decimals
  const { getMint } = await import("@solana/spl-token")
  const { PublicKey } = await import("@solana/web3.js")
  const mintInfo = await getMint(connection, new PublicKey(autoSellState.config.mint))
  const decimals = mintInfo.decimals

  // Convert to atoms
  const amountInAtoms = BigInt(Math.floor(amount * 10 ** decimals)).toString()

  // Get Jupiter quote
  const jupiterBase = process.env.JUPITER_BASE || "https://quote-api.jup.ag"
  const quoteMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC

  const quoteResponse = await axios.default.get(`${jupiterBase}/v6/quote`, {
    params: {
      inputMint: autoSellState.config.mint,
      outputMint: quoteMint,
      amount: amountInAtoms,
      slippageBps: autoSellState.config.slippageBps,
    },
  })

  // Get swap transaction
  const swapResponse = await axios.default.post(`${jupiterBase}/v6/swap`, {
    userPublicKey: wallet.keypair.publicKey.toBase58(),
    quoteResponse: quoteResponse.data,
  })

  // Sign and submit transaction
  const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.data.swapTransaction, "base64"))
  tx.sign([wallet.keypair])

  // Try bloXroute first, fallback to RPC
  const auth = process.env.BLOXROUTE_API_KEY
  if (auth) {
    try {
      const content = Buffer.from(tx.serialize()).toString("base64")
      const region = process.env.BLOXROUTE_REGION || "ny"
      const url = `http://${region}.solana.dex.blxrbdn.com/api/v2/submit`

      const response = await axios.default.post(
        url,
        {
          transaction: { content },
          skipPreFlight: true,
        },
        {
          headers: { Authorization: auth },
        },
      )

      return response.data?.signature || "unknown"
    } catch (error) {
      console.error("bloXroute submission failed, falling back to RPC:", error)
    }
  }

  // Fallback to RPC
  const signature = await connection.sendTransaction(tx, { skipPreflight: true })
  await connection.confirmTransaction(signature, "confirmed")
  return signature
}

// Utility functions
function pushAndPrune(window: any, trade: any) {
  if (trade.usd >= window.minUsd) {
    window.trades.push(trade)
  }

  const cutoff = Date.now() - window.windowSec * 1000
  while (window.trades.length && window.trades[0].ts < cutoff) {
    window.trades.shift()
  }
}

function netUsd(window: any) {
  let buys = 0,
    sells = 0
  for (const trade of window.trades) {
    if (trade.side === "buy") {
      buys += trade.usd
    } else {
      sells += trade.usd
    }
  }
  return { buys, sells, net: buys - sells }
}

// Export the state for status endpoint
export { autoSellState }
