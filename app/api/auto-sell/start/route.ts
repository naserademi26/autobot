import { type NextRequest, NextResponse } from "next/server"

// Global state for the auto-sell engine
const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  marketTrades: [] as any[], // Store market buy/sell activity for the token
  metrics: {
    totalBought: 0,
    totalSold: 0,
    currentPrice: 0,
    currentPriceUsd: 0,
    solPriceUsd: 100,
    netUsdFlow: 0, // Net USD flow (buyers - sellers) in time window
    buyVolumeUsd: 0, // Total buy volume in USD in time window
    sellVolumeUsd: 0, // Total sell volume in USD in time window
    lastSellTrigger: 0, // Timestamp of last sell trigger
  },
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
          balance: 0,
          tokenBalance: 0,
          lastTransactionSignature: "",
        })
      } catch (error) {
        console.error(`Failed to parse wallet ${i}:`, error)
      }
    }

    if (wallets.length === 0) {
      return NextResponse.json({ error: "No valid wallets could be parsed" }, { status: 400 })
    }

    // Update global state
    autoSellState.config = {
      ...config,
      timeWindowSeconds: config.timeWindowSeconds || 120, // Default 2 minutes
      sellPercentageOfNetFlow: config.sellPercentageOfNetFlow || 25, // Default 25% of net flow
      minNetFlowUsd: config.minNetFlowUsd || 10, // Minimum $10 net flow to trigger
      cooldownSeconds: config.cooldownSeconds || 30, // 30 second cooldown between sells
    }
    autoSellState.wallets = wallets
    autoSellState.marketTrades = []
    autoSellState.isRunning = true

    // Start monitoring and execution intervals
    startAutoSellEngine()

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets`,
      config: autoSellState.config,
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

  // Market monitoring interval (every 10 seconds)
  const marketMonitorInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await monitorMarketActivity()
    } catch (error) {
      console.error("Market monitoring error:", error)
    }
  }, 10000)

  // Auto-sell execution interval (every 15 seconds)
  const executionInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await executeAutoSell()
    } catch (error) {
      console.error("Auto-sell execution error:", error)
    }
  }, 15000)

  // Wallet balance update interval (every 30 seconds)
  const balanceInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await updateAllWalletBalances()
    } catch (error) {
      console.error("Balance update error:", error)
    }
  }, 30000)

  autoSellState.intervals.push(marketMonitorInterval, executionInterval, balanceInterval)
}

async function monitorMarketActivity() {
  try {
    // Get SOL price in USD
    const solPriceResponse = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
    const solPriceData = await solPriceResponse.json()
    const solPriceUsd = solPriceData?.solana?.usd || 100
    autoSellState.metrics.solPriceUsd = solPriceUsd

    // Get token data from DexScreener
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
    const data = await response.json()

    if (!data.pairs || data.pairs.length === 0) {
      console.log("[MARKET MONITOR] No trading pairs found")
      return
    }

    // Get the most liquid pair
    const pair = data.pairs.sort((a: any, b: any) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0]

    if (!pair) return

    const currentPriceUsd = Number(pair.priceUsd || 0)
    const currentPrice = currentPriceUsd / solPriceUsd

    autoSellState.metrics.currentPrice = currentPrice
    autoSellState.metrics.currentPriceUsd = currentPriceUsd

    // Get recent transactions from the pair
    const volume24h = Number(pair.volume?.h24 || 0)
    const priceChange24h = Number(pair.priceChange?.h24 || 0)
    const txns24h = pair.txns?.h24 || { buys: 0, sells: 0 }

    // Estimate recent buy/sell activity based on volume and price movement
    // This is an approximation since DexScreener doesn't provide real-time trade data
    const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
    const currentTime = Date.now()

    // Clean old trades outside time window
    autoSellState.marketTrades = autoSellState.marketTrades.filter(
      (trade) => currentTime - trade.timestamp < timeWindowMs,
    )

    // Estimate current market momentum based on price change and volume
    const volumeInWindow = (volume24h / 24 / 60) * (autoSellState.config.timeWindowSeconds / 60) // Approximate volume in time window
    const buyRatio = priceChange24h > 0 ? 0.6 : 0.4 // If price is up, assume more buying

    const estimatedBuyVolumeUsd = volumeInWindow * buyRatio
    const estimatedSellVolumeUsd = volumeInWindow * (1 - buyRatio)

    // Add estimated trade data
    const tradeData = {
      timestamp: currentTime,
      buyVolumeUsd: estimatedBuyVolumeUsd,
      sellVolumeUsd: estimatedSellVolumeUsd,
      priceUsd: currentPriceUsd,
    }

    autoSellState.marketTrades.push(tradeData)

    // Calculate net USD flow in time window
    const buyVolumeUsd = autoSellState.marketTrades.reduce((sum, trade) => sum + trade.buyVolumeUsd, 0)
    const sellVolumeUsd = autoSellState.marketTrades.reduce((sum, trade) => sum + trade.sellVolumeUsd, 0)
    const netUsdFlow = buyVolumeUsd - sellVolumeUsd

    autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
    autoSellState.metrics.netUsdFlow = netUsdFlow

    console.log(
      `[MARKET MONITOR] Price: $${currentPriceUsd.toFixed(6)} | Buy: $${buyVolumeUsd.toFixed(2)} | Sell: $${sellVolumeUsd.toFixed(2)} | Net: $${netUsdFlow.toFixed(2)}`,
    )
  } catch (error) {
    console.error("Market monitoring error:", error)
  }
}

async function executeAutoSell() {
  try {
    const netUsdFlow = autoSellState.metrics.netUsdFlow
    const minNetFlowUsd = autoSellState.config.minNetFlowUsd
    const cooldownMs = autoSellState.config.cooldownSeconds * 1000
    const currentTime = Date.now()

    // Check if we're in cooldown period
    if (currentTime - autoSellState.metrics.lastSellTrigger < cooldownMs) {
      console.log(
        `[AUTO-SELL] In cooldown period, ${Math.ceil((cooldownMs - (currentTime - autoSellState.metrics.lastSellTrigger)) / 1000)}s remaining`,
      )
      return
    }

    // Check if net flow is positive and above threshold
    if (netUsdFlow <= minNetFlowUsd) {
      console.log(`[AUTO-SELL] Net flow $${netUsdFlow.toFixed(2)} <= threshold $${minNetFlowUsd}, no sell triggered`)
      return
    }

    console.log(`[AUTO-SELL] Positive net flow detected: $${netUsdFlow.toFixed(2)} > $${minNetFlowUsd}`)

    // Calculate USD amount to sell (percentage of net flow)
    const sellPercentage = autoSellState.config.sellPercentageOfNetFlow
    const usdAmountToSell = (netUsdFlow * sellPercentage) / 100
    const currentPriceUsd = autoSellState.metrics.currentPriceUsd

    if (currentPriceUsd <= 0) {
      console.log("[AUTO-SELL] Invalid current price, skipping")
      return
    }

    // Convert USD amount to token amount
    const tokensToSell = usdAmountToSell / currentPriceUsd

    console.log(
      `[AUTO-SELL] Selling ${sellPercentage}% of net flow: $${usdAmountToSell.toFixed(2)} (${tokensToSell.toFixed(4)} tokens)`,
    )

    // Get wallets with tokens and distribute the sell amount
    const walletsWithTokens = autoSellState.wallets.filter((wallet) => wallet.tokenBalance > 0)

    if (walletsWithTokens.length === 0) {
      console.log("[AUTO-SELL] No wallets have tokens to sell")
      return
    }

    const totalTokensHeld = walletsWithTokens.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)

    if (totalTokensHeld < tokensToSell) {
      console.log(
        `[AUTO-SELL] Not enough tokens held (${totalTokensHeld.toFixed(4)}) to sell required amount (${tokensToSell.toFixed(4)})`,
      )
      return
    }

    // Distribute sell amount proportionally across wallets
    let totalSold = 0
    for (const wallet of walletsWithTokens) {
      if (Date.now() < wallet.cooldownUntil) continue

      const walletProportion = wallet.tokenBalance / totalTokensHeld
      const walletSellAmount = tokensToSell * walletProportion

      if (walletSellAmount < 0.000001) continue // Minimum sell amount

      try {
        const signature = await executeSell(wallet, walletSellAmount)
        wallet.cooldownUntil = Date.now() + 30000 // 30 second wallet cooldown
        totalSold += walletSellAmount

        const estimatedSolReceived = walletSellAmount * autoSellState.metrics.currentPrice
        const estimatedUsdValue = walletSellAmount * currentPriceUsd

        console.log(
          `[AUTO-SELL] ${wallet.name} sold ${walletSellAmount.toFixed(4)} tokens for ~${estimatedSolReceived.toFixed(4)} SOL (~$${estimatedUsdValue.toFixed(2)} USD), sig: ${signature}`,
        )
      } catch (error) {
        console.error(`[AUTO-SELL ERROR] ${wallet.name}:`, error)
      }
    }

    if (totalSold > 0) {
      autoSellState.metrics.lastSellTrigger = currentTime
      autoSellState.metrics.totalSold += totalSold
      console.log(
        `[AUTO-SELL] Total sold: ${totalSold.toFixed(4)} tokens worth ~$${(totalSold * currentPriceUsd).toFixed(2)} USD`,
      )
    }
  } catch (error) {
    console.error("Auto-sell execution error:", error)
  }
}

async function updateAllWalletBalances() {
  for (const wallet of autoSellState.wallets) {
    await updateWalletBalances(wallet)
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
  const outputMint = "So11111111111111111111111111111111111111112" // SOL

  const quoteResponse = await axios.default.get(`${jupiterBase}/v6/quote`, {
    params: {
      inputMint: autoSellState.config.mint,
      outputMint: outputMint,
      amount: amountInAtoms,
      slippageBps: autoSellState.config.slippageBps || 300,
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

  const auth = process.env.BLOXROUTE_API_KEY
  if (auth) {
    try {
      const serializedTx = Buffer.from(tx.serialize()).toString("base64")

      // Use the correct bloXroute endpoint with HTTPS
      const bloxrouteUrl = process.env.BLOXROUTE_SUBMIT_URL || "https://ny.solana.dex.blxrbdn.com"

      const response = await axios.default.post(
        `${bloxrouteUrl}/api/v2/submit`,
        {
          transaction: {
            content: serializedTx,
            encoding: "base64",
          },
        },
        {
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        },
      )

      if (response.data?.signature) {
        console.log(`[BLOXROUTE] Transaction submitted successfully: ${response.data.signature}`)
        return response.data.signature
      } else {
        throw new Error("No signature returned from bloXroute")
      }
    } catch (error: any) {
      console.error("bloXroute submission failed:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url,
      })
      console.log("Falling back to RPC submission...")
    }
  }

  // Fallback to RPC
  try {
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3,
    })
    console.log(`[RPC] Transaction submitted: ${signature}`)
    await connection.confirmTransaction(signature, "confirmed")
    return signature
  } catch (error) {
    console.error("RPC submission also failed:", error)
    throw error
  }
}

// Export the state for status endpoint
export { autoSellState }
