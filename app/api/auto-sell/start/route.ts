import { type NextRequest, NextResponse } from "next/server"

// Global state for the auto-sell engine with enhanced tracking
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
    analysisWindowStart: 0, // When current analysis window started
    windowCompleted: false, // Whether current window is complete and ready for analysis
  },
  intervals: [] as NodeJS.Timeout[],
  intervalIds: new Set<NodeJS.Timeout>(), // Track interval IDs for cleanup
  lastError: null as string | null,
  errorCount: 0,
  startTime: 0, // Track when engine started
  maxRunTimeMs: 24 * 60 * 60 * 1000, // 24 hours max runtime
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
  // Don't exit, just log the error
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason)
  // Don't exit, just log the error
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { config, privateKeys } = body

    if (autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is already running" }, { status: 400 })
    }

    if (!config) {
      return NextResponse.json({ error: "Configuration is required" }, { status: 400 })
    }

    if (!config.mint || typeof config.mint !== "string" || config.mint.trim().length === 0) {
      return NextResponse.json({ error: "Valid mint address is required" }, { status: 400 })
    }

    if (!privateKeys || !Array.isArray(privateKeys) || privateKeys.length === 0) {
      return NextResponse.json({ error: "At least one private key is required" }, { status: 400 })
    }

    const validatedConfig = {
      mint: config.mint.trim(),
      timeWindowSeconds: Math.max(60, Math.min(600, Number(config.timeWindowSeconds) || 120)),
      sellPercentageOfNetFlow: Math.max(1, Math.min(100, Number(config.sellPercentageOfNetFlow) || 25)),
      minNetFlowUsd: Math.max(1, Number(config.minNetFlowUsd) || 10),
      cooldownSeconds: Math.max(10, Number(config.cooldownSeconds) || 30),
      slippageBps: Math.max(50, Math.min(1000, Number(config.slippageBps) || 300)),
    }

    // Initialize wallets with better error handling
    const { Keypair } = await import("@solana/web3.js")
    const bs58 = await import("bs58")

    const wallets = []
    const walletErrors = []

    const maxWallets = Math.min(privateKeys.length, 20) // Limit to 20 wallets max

    for (let i = 0; i < maxWallets; i++) {
      try {
        const privateKey = privateKeys[i]

        if (!privateKey || typeof privateKey !== "string") {
          walletErrors.push(`Wallet ${i + 1}: Invalid private key format`)
          continue
        }

        let keypair

        if (privateKey.trim().startsWith("[")) {
          try {
            const arr = Uint8Array.from(JSON.parse(privateKey.trim()))
            if (arr.length !== 64) {
              throw new Error("Invalid array length")
            }
            keypair = Keypair.fromSecretKey(arr)
          } catch (parseError) {
            walletErrors.push(`Wallet ${i + 1}: Invalid JSON array format`)
            continue
          }
        } else {
          try {
            const secret = bs58.default.decode(privateKey.trim())
            if (secret.length !== 64) {
              throw new Error("Invalid key length")
            }
            keypair = Keypair.fromSecretKey(secret)
          } catch (decodeError) {
            walletErrors.push(`Wallet ${i + 1}: Invalid base58 format`)
            continue
          }
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
      } catch (error: any) {
        walletErrors.push(`Wallet ${i + 1}: ${error?.message || "Unknown error"}`)
        console.error(`Failed to parse wallet ${i}:`, error)
      }
    }

    if (wallets.length === 0) {
      return NextResponse.json(
        {
          error: "No valid wallets could be parsed",
          details: walletErrors.slice(0, 5), // Limit error details
        },
        { status: 400 },
      )
    }

    autoSellState.lastError = null
    autoSellState.errorCount = 0
    autoSellState.startTime = Date.now()

    // Update global state
    autoSellState.config = validatedConfig
    autoSellState.wallets = wallets
    autoSellState.marketTrades = []
    autoSellState.isRunning = true

    // Start monitoring and execution intervals with error handling
    try {
      await startAutoSellEngine()
    } catch (engineError: any) {
      autoSellState.isRunning = false
      console.error("Failed to start auto-sell engine:", engineError)
      return NextResponse.json(
        {
          error: "Failed to start auto-sell engine",
          details: engineError?.message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets`,
      config: autoSellState.config,
      warnings: walletErrors.length > 0 ? `${walletErrors.length} wallets failed to parse` : undefined,
    })
  } catch (error: any) {
    console.error("Error starting auto-sell:", error)
    autoSellState.isRunning = false
    return NextResponse.json(
      {
        error: "Failed to start auto-sell engine",
        details: error?.message || "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function startAutoSellEngine() {
  autoSellState.intervals.forEach((interval) => {
    try {
      clearInterval(interval)
      autoSellState.intervalIds.delete(interval)
    } catch (e) {
      console.warn("Error clearing interval:", e)
    }
  })
  autoSellState.intervals = []
  autoSellState.intervalIds.clear()

  autoSellState.errorCount = 0
  autoSellState.lastError = null

  console.log(`[ENGINE] Starting simplified 2-minute analysis cycle`)

  console.log("[ENGINE] Fetching initial wallet balances...")
  try {
    await updateAllWalletBalances()
    console.log("[ENGINE] Initial wallet balances fetched successfully")

    // Log current balances for debugging
    autoSellState.wallets.forEach((wallet, index) => {
      console.log(
        `[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, ${wallet.tokenBalance.toFixed(2)} tokens`,
      )
    })
  } catch (balanceError) {
    console.warn("[ENGINE] Initial balance fetch failed:", balanceError)
  }

  const mainAnalysisInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    // Check max runtime
    if (Date.now() - autoSellState.startTime > autoSellState.maxRunTimeMs) {
      console.log("[ENGINE] Max runtime reached, shutting down")
      await stopAutoSellEngine()
      return
    }

    try {
      console.log(`[ANALYSIS CYCLE] Starting new 2-minute analysis cycle...`)

      // Reset metrics for new cycle
      autoSellState.marketTrades = []
      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0
      autoSellState.metrics.netUsdFlow = 0

      // Collect market data for 2 minutes
      await collectMarketDataFor2Minutes()

      // After 2 minutes, analyze and make sell decision
      await analyzeAndExecuteSell()

      // Update wallet balances after analysis
      await updateAllWalletBalances()

      console.log(`[ANALYSIS CYCLE] Cycle completed, starting next cycle...`)
    } catch (error: any) {
      autoSellState.errorCount++
      autoSellState.lastError = error?.message || "Analysis cycle error"
      console.error("Analysis cycle error:", error)

      if (autoSellState.errorCount > 10) {
        console.error(`Too many errors (${autoSellState.errorCount}), stopping auto-sell engine`)
        await stopAutoSellEngine()
      }
    }
  }, autoSellState.config.timeWindowSeconds * 1000) // Every 2 minutes (or configured time window)

  autoSellState.intervals.push(mainAnalysisInterval)
  autoSellState.intervalIds.add(mainAnalysisInterval)

  console.log("[ENGINE] Simplified 2-minute analysis cycle started")
}

async function collectMarketDataFor2Minutes() {
  const startTime = Date.now()
  const endTime = startTime + autoSellState.config.timeWindowSeconds * 1000
  const collectInterval = 15000 // Collect data every 15 seconds during the 2-minute window

  console.log(`[DATA COLLECTION] Collecting market data for ${autoSellState.config.timeWindowSeconds} seconds...`)

  while (Date.now() < endTime && autoSellState.isRunning) {
    try {
      await monitorMarketActivity()

      const remainingSeconds = Math.ceil((endTime - Date.now()) / 1000)
      if (remainingSeconds > 0) {
        console.log(`[DATA COLLECTION] ${remainingSeconds}s remaining in analysis window...`)
        await new Promise((resolve) => setTimeout(resolve, Math.min(collectInterval, endTime - Date.now())))
      }
    } catch (error) {
      console.error("Error during data collection:", error)
      await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5s before retry
    }
  }

  console.log(`[DATA COLLECTION] 2-minute data collection completed`)
}

async function analyzeAndExecuteSell() {
  const netUsdFlow = autoSellState.metrics.netUsdFlow
  const minNetFlowUsd = autoSellState.config.minNetFlowUsd

  console.log(
    `[ANALYSIS] 2-Minute Window Results:`,
    `Buy Volume: $${autoSellState.metrics.buyVolumeUsd.toFixed(2)}`,
    `Sell Volume: $${autoSellState.metrics.sellVolumeUsd.toFixed(2)}`,
    `Net Flow: $${netUsdFlow.toFixed(2)}`,
    `Threshold: $${minNetFlowUsd}`,
  )

  if (netUsdFlow > minNetFlowUsd) {
    console.log(`[TRIGGER] ✅ Net flow $${netUsdFlow.toFixed(2)} > threshold $${minNetFlowUsd} - EXECUTING SELL`)
    await executeAutoSell()
    autoSellState.metrics.lastSellTrigger = Date.now()
  } else {
    console.log(`[NO TRIGGER] ❌ Net flow $${netUsdFlow.toFixed(2)} <= threshold $${minNetFlowUsd} - No sell executed`)
  }
}

async function monitorMarketActivity() {
  try {
    const solPriceController = new AbortController()
    const solPriceTimeout = setTimeout(() => solPriceController.abort(), 8000)

    let solPriceUsd = autoSellState.metrics.solPriceUsd

    try {
      const solPriceResponse = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        {
          signal: solPriceController.signal,
          headers: { "User-Agent": "AutoSellBot/1.0" },
        },
      )
      clearTimeout(solPriceTimeout)

      if (solPriceResponse.ok) {
        const solPriceData = await solPriceResponse.json()
        const newSolPrice = solPriceData?.solana?.usd
        if (newSolPrice && typeof newSolPrice === "number" && newSolPrice > 0) {
          solPriceUsd = newSolPrice
        }
      }
    } catch (solPriceError) {
      clearTimeout(solPriceTimeout)
      console.warn("Failed to fetch SOL price, using previous value:", solPriceError)
    }

    autoSellState.metrics.solPriceUsd = solPriceUsd

    const dexController = new AbortController()
    const dexTimeout = setTimeout(() => dexController.abort(), 12000)

    try {
      // Get token pair data for current price
      const pairResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`, {
        signal: dexController.signal,
        headers: { "User-Agent": "AutoSellBot/1.0" },
      })

      if (!pairResponse.ok) {
        throw new Error(`DexScreener pair API returned ${pairResponse.status}`)
      }

      const pairData = await pairResponse.json()

      if (!pairData.pairs || !Array.isArray(pairData.pairs) || pairData.pairs.length === 0) {
        console.log("[MARKET MONITOR] No trading pairs found")
        return
      }

      const validPairs = pairData.pairs.filter(
        (pair: any) =>
          pair && typeof pair.priceUsd === "string" && !isNaN(Number(pair.priceUsd)) && Number(pair.priceUsd) > 0,
      )

      if (validPairs.length === 0) {
        console.log("[MARKET MONITOR] No valid pairs found")
        return
      }

      const pair = validPairs.sort(
        (a: any, b: any) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0),
      )[0]

      const currentPriceUsd = Number(pair.priceUsd || 0)
      const currentPrice = currentPriceUsd / solPriceUsd

      if (currentPriceUsd > 0 && currentPrice > 0 && isFinite(currentPriceUsd) && isFinite(currentPrice)) {
        autoSellState.metrics.currentPrice = currentPrice
        autoSellState.metrics.currentPriceUsd = currentPriceUsd
      } else {
        console.warn("[MARKET MONITOR] Invalid price data received")
        return
      }

      const searchResponse = await fetch(
        `https://api.dexscreener.com/latest/dex/search/?q=${autoSellState.config.mint}`,
        {
          signal: dexController.signal,
          headers: { "User-Agent": "AutoSellBot/1.0" },
        },
      )

      let realBuyVolumeUsd = 0
      let realSellVolumeUsd = 0

      if (searchResponse.ok) {
        const searchData = await searchResponse.json()
        const searchPair = searchData.pairs?.find(
          (p: any) =>
            p.baseToken?.address === autoSellState.config.mint || p.quoteToken?.address === autoSellState.config.mint,
        )

        if (searchPair) {
          // Use real volume data from the last few minutes
          const volume5m = Number(searchPair.volume?.m5 || 0)
          const volume1h = Number(searchPair.volume?.h1 || 0)
          const priceChange5m = Number(searchPair.priceChange?.m5 || 0)

          // Calculate buy/sell ratio based on recent price movement
          const buyRatio =
            priceChange5m > 0 ? Math.min(0.8, 0.5 + priceChange5m / 100) : Math.max(0.2, 0.5 + priceChange5m / 100)

          // Use 5-minute volume scaled to our time window
          const windowMinutes = autoSellState.config.timeWindowSeconds / 60
          const scaledVolume = (volume5m / 5) * windowMinutes

          realBuyVolumeUsd = scaledVolume * buyRatio
          realSellVolumeUsd = scaledVolume * (1 - buyRatio)

          console.log(
            `[REAL TRADES] 5m Volume: $${volume5m.toFixed(2)} | Price Change: ${priceChange5m.toFixed(2)}% | Buy Ratio: ${(buyRatio * 100).toFixed(1)}%`,
          )
        }
      }

      if (realBuyVolumeUsd === 0 && realSellVolumeUsd === 0) {
        const txns24h = Number(pair.txns?.h24?.buys || 0) + Number(pair.txns?.h24?.sells || 0)
        const volume24h = Number(pair.volume?.h24 || 0)

        if (txns24h > 0 && volume24h > 0) {
          // Estimate recent activity based on transaction frequency
          const avgTxnValue = volume24h / txns24h
          const recentTxns = Math.max(1, txns24h / ((24 * 60) / autoSellState.config.timeWindowSeconds))
          const estimatedVolume = avgTxnValue * recentTxns

          const priceChange1h = Number(pair.priceChange?.h1 || 0)
          const buyRatio =
            priceChange1h > 0 ? Math.min(0.75, 0.5 + priceChange1h / 200) : Math.max(0.25, 0.5 + priceChange1h / 200)

          realBuyVolumeUsd = estimatedVolume * buyRatio
          realSellVolumeUsd = estimatedVolume * (1 - buyRatio)

          console.log(
            `[ESTIMATED TRADES] Recent Txns: ${recentTxns.toFixed(1)} | Avg Value: $${avgTxnValue.toFixed(2)} | Buy Ratio: ${(buyRatio * 100).toFixed(1)}%`,
          )
        }
      }

      clearTimeout(dexTimeout)

      const currentTime = Date.now()
      const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000

      // Clean old trades
      autoSellState.marketTrades = autoSellState.marketTrades
        .filter((trade) => trade && trade.timestamp && currentTime - trade.timestamp < timeWindowMs)
        .slice(-50) // Keep last 50 trades max

      // Add new trade data if we have meaningful volume
      if (realBuyVolumeUsd > 0.01 || realSellVolumeUsd > 0.01) {
        const tradeData = {
          timestamp: currentTime,
          buyVolumeUsd: realBuyVolumeUsd,
          sellVolumeUsd: realSellVolumeUsd,
          priceUsd: autoSellState.metrics.currentPriceUsd,
        }

        autoSellState.marketTrades.push(tradeData)
      }

      const buyVolumeUsd = autoSellState.marketTrades.reduce((sum, trade) => sum + (Number(trade.buyVolumeUsd) || 0), 0)
      const sellVolumeUsd = autoSellState.marketTrades.reduce(
        (sum, trade) => sum + (Number(trade.sellVolumeUsd) || 0),
        0,
      )
      const netUsdFlow = buyVolumeUsd - sellVolumeUsd

      if (isFinite(buyVolumeUsd) && isFinite(sellVolumeUsd) && isFinite(netUsdFlow)) {
        autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
        autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
        autoSellState.metrics.netUsdFlow = netUsdFlow
      }

      console.log(
        `[MARKET MONITOR] Price: $${autoSellState.metrics.currentPriceUsd.toFixed(6)} | Window Buy: $${buyVolumeUsd.toFixed(2)} | Window Sell: $${sellVolumeUsd.toFixed(2)} | Net Flow: $${netUsdFlow.toFixed(2)} | Trades: ${autoSellState.marketTrades.length}`,
      )
    } catch (dexError: any) {
      clearTimeout(dexTimeout)
      if (dexError.name === "AbortError") {
        throw new Error("DexScreener request timeout")
      } else {
        throw new Error(`DexScreener error: ${dexError?.message || "Unknown error"}`)
      }
    }
  } catch (error: any) {
    console.error("Market monitoring error:", error)
    throw error
  }
}

async function stopAutoSellEngine() {
  console.log("[ENGINE] Stopping auto-sell engine...")
  autoSellState.isRunning = false

  autoSellState.intervals.forEach((interval) => {
    try {
      clearInterval(interval)
      autoSellState.intervalIds.delete(interval)
    } catch (e) {
      console.warn("Error clearing interval:", e)
    }
  })
  autoSellState.intervals = []
  autoSellState.intervalIds.clear()

  autoSellState.marketTrades = []
  console.log("[ENGINE] Auto-sell engine stopped and cleaned up")
}

async function checkAndExecuteAutoSell() {
  // This function is no longer needed with the new analysis cycle
}

async function executeAutoSell() {
  try {
    const netUsdFlow = autoSellState.metrics.netUsdFlow
    const sellPercentage = autoSellState.config.sellPercentageOfNetFlow
    const exactUsdAmountToSell = (netUsdFlow * sellPercentage) / 100 // Exact 25% of net USD flow
    const currentPriceUsd = autoSellState.metrics.currentPriceUsd

    if (!isFinite(currentPriceUsd) || currentPriceUsd <= 0) {
      console.log("[AUTO-SELL] Invalid current price, skipping")
      return
    }

    if (!isFinite(exactUsdAmountToSell) || exactUsdAmountToSell <= 0) {
      console.log("[AUTO-SELL] Invalid sell amount calculated, skipping")
      return
    }

    const exactTokensToSell = exactUsdAmountToSell / currentPriceUsd

    console.log(
      `[AUTO-SELL] CALCULATION: Net USD Flow: $${netUsdFlow.toFixed(2)} | ${sellPercentage}% = $${exactUsdAmountToSell.toFixed(2)} | Tokens to sell: ${exactTokensToSell.toFixed(6)}`,
    )

    const walletsWithTokens = autoSellState.wallets.filter(
      (wallet) =>
        wallet &&
        typeof wallet.tokenBalance === "number" &&
        wallet.tokenBalance > 0 &&
        Date.now() >= wallet.cooldownUntil,
    )

    if (walletsWithTokens.length === 0) {
      console.log("[AUTO-SELL] No wallets available with tokens (all in cooldown or no tokens)")
      return
    }

    const totalTokensHeld = walletsWithTokens.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)

    if (!isFinite(totalTokensHeld) || totalTokensHeld < exactTokensToSell) {
      console.log(
        `[AUTO-SELL] Not enough tokens held (${totalTokensHeld.toFixed(6)}) to sell required amount (${exactTokensToSell.toFixed(6)})`,
      )
      return
    }

    const maxConcurrentSells = Math.min(walletsWithTokens.length, 5) // Max 5 concurrent sells
    const sellPromises = []
    let totalTokensToSell = 0

    for (let i = 0; i < maxConcurrentSells; i++) {
      const wallet = walletsWithTokens[i]
      const walletProportion = wallet.tokenBalance / totalTokensHeld
      const walletTokensToSell = exactTokensToSell * walletProportion

      if (walletTokensToSell > 0.000001) {
        totalTokensToSell += walletTokensToSell

        const sellPromise = executeSell(wallet, walletTokensToSell)
          .then((signature) => {
            const actualUsdSold = walletTokensToSell * currentPriceUsd
            const actualSolReceived = walletTokensToSell * autoSellState.metrics.currentPrice

            wallet.cooldownUntil = Date.now() + autoSellState.config.timeWindowSeconds * 1000

            console.log(
              `[AUTO-SELL] ${wallet.name} sold ${walletTokensToSell.toFixed(6)} tokens for ~${actualSolReceived.toFixed(4)} SOL (~$${actualUsdSold.toFixed(2)} USD), sig: ${signature}`,
            )

            return {
              wallet: wallet.name,
              tokens: walletTokensToSell,
              usd: actualUsdSold,
              sol: actualSolReceived,
              signature,
            }
          })
          .catch((error) => {
            console.error(`[AUTO-SELL ERROR] ${wallet.name}:`, error)
            return {
              wallet: wallet.name,
              error: error.message,
            }
          })

        sellPromises.push(sellPromise)
      }
    }

    if (sellPromises.length === 0) {
      console.log("[AUTO-SELL] No meaningful sell amounts calculated for any wallet")
      return
    }

    console.log(`[AUTO-SELL] Executing sells across ${sellPromises.length} wallets simultaneously...`)
    const results = await Promise.all(sellPromises)

    let totalUsdSold = 0
    let totalTokensSold = 0
    let successfulSells = 0

    results.forEach((result) => {
      if (result.signature) {
        totalUsdSold += result.usd
        totalTokensSold += result.tokens
        successfulSells++
      }
    })

    autoSellState.metrics.totalSold += totalTokensSold

    console.log(`[AUTO-SELL] SUMMARY: ${successfulSells}/${sellPromises.length} wallets sold successfully`)
    console.log(`[AUTO-SELL] TOTAL: ${totalTokensSold.toFixed(6)} tokens for ~$${totalUsdSold.toFixed(2)} USD`)
    console.log(
      `[AUTO-SELL] TARGET: $${exactUsdAmountToSell.toFixed(2)} | ACTUAL: $${totalUsdSold.toFixed(2)} | DIFFERENCE: $${(totalUsdSold - exactUsdAmountToSell).toFixed(2)}`,
    )
  } catch (error: any) {
    console.error("Auto-sell execution error:", error)
    throw error
  }
}

async function updateAllWalletBalances() {
  const batchSize = 3
  const walletBatches = []

  for (let i = 0; i < autoSellState.wallets.length; i += batchSize) {
    walletBatches.push(autoSellState.wallets.slice(i, i + batchSize))
  }

  for (const batch of walletBatches) {
    const balancePromises = batch.map((wallet) =>
      updateWalletBalances(wallet).catch((error) => {
        console.error(`Error updating balance for ${wallet.name}:`, error.message)
        return null
      }),
    )

    await Promise.allSettled(balancePromises)

    if (walletBatches.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

async function updateWalletBalances(wallet: any) {
  if (!wallet || !wallet.keypair) {
    throw new Error("Invalid wallet object")
  }

  try {
    const { Connection, PublicKey } = await import("@solana/web3.js")
    const { getAssociatedTokenAddress } = await import("@solana/spl-token")

    const connection = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ||
        process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
        "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
      { commitment: "confirmed" },
    )

    const solBalancePromise = connection.getBalance(wallet.keypair.publicKey)
    const solBalance = await Promise.race([
      solBalancePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SOL balance timeout")), 8000)),
    ])

    wallet.balance = Number(solBalance) / 1e9
    console.log(`[BALANCE UPDATE] ${wallet.name} SOL: ${wallet.balance.toFixed(4)}`)

    try {
      const mintPubkey = new PublicKey(autoSellState.config.mint)
      const ata = await getAssociatedTokenAddress(mintPubkey, wallet.keypair.publicKey)

      const tokenBalancePromise = connection.getTokenAccountBalance(ata)
      const tokenAccount = await Promise.race([
        tokenBalancePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Token balance timeout")), 8000)),
      ])

      wallet.tokenBalance = Number(tokenAccount.value?.uiAmount) || 0
      console.log(`[BALANCE UPDATE] ${wallet.name} Token: ${wallet.tokenBalance.toFixed(6)}`)
    } catch (tokenError: any) {
      if (tokenError.message?.includes("could not find account") || tokenError.message?.includes("Invalid param")) {
        console.log(`[BALANCE UPDATE] ${wallet.name} Token: 0 (no token account)`)
        wallet.tokenBalance = 0
      } else {
        console.warn(`[BALANCE UPDATE] ${wallet.name} Token balance error:`, tokenError.message)
        wallet.tokenBalance = 0
      }
    }
  } catch (error: any) {
    console.error(`[BALANCE ERROR] ${wallet.name}:`, error.message)
    // Don't throw, just log the error and continue
  }
}

async function executeSell(wallet: any, amount: number) {
  if (!wallet || !wallet.keypair || !isFinite(amount) || amount <= 0) {
    throw new Error("Invalid wallet or amount")
  }

  const axios = await import("axios")
  const { Connection, VersionedTransaction } = await import("@solana/web3.js")
  const { getMint } = await import("@solana/spl-token")
  const { PublicKey } = await import("@solana/web3.js")

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    { commitment: "confirmed" },
  )

  try {
    const mintInfo = await getMint(connection, new PublicKey(autoSellState.config.mint))
    const decimals = mintInfo.decimals

    const amountInAtoms = BigInt(Math.floor(amount * 10 ** decimals)).toString()

    if (!amountInAtoms || amountInAtoms === "0") {
      throw new Error("Invalid amount calculation")
    }

    const jupiterBase = process.env.JUPITER_BASE || "https://quote-api.jup.ag"
    const outputMint = "So11111111111111111111111111111111111111112" // SOL

    const quoteResponse = await axios.default.get(`${jupiterBase}/v6/quote`, {
      params: {
        inputMint: autoSellState.config.mint,
        outputMint: outputMint,
        amount: amountInAtoms,
        slippageBps: autoSellState.config.slippageBps || 300,
      },
      timeout: 10000,
      headers: { "User-Agent": "AutoSellBot/1.0" },
    })

    if (!quoteResponse.data) {
      throw new Error("No quote received from Jupiter")
    }

    const swapResponse = await axios.default.post(
      `${jupiterBase}/v6/swap`,
      {
        userPublicKey: wallet.keypair.publicKey.toBase58(),
        quoteResponse: quoteResponse.data,
      },
      {
        timeout: 10000,
        headers: { "User-Agent": "AutoSellBot/1.0" },
      },
    )

    if (!swapResponse.data?.swapTransaction) {
      throw new Error("No swap transaction received from Jupiter")
    }

    const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.data.swapTransaction, "base64"))
    tx.sign([wallet.keypair])

    const auth = process.env.BLOXROUTE_API_KEY
    if (auth) {
      try {
        const serializedTx = Buffer.from(tx.serialize()).toString("base64")

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
              Authorization: `Bearer ${auth}`,
              "Content-Type": "application/json",
              "User-Agent": "AutoSellBot/1.0",
            },
            timeout: 10000,
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
          statusText: error.response?.statusText,
          data: error.response?.data,
        })
        console.log("Falling back to RPC submission...")
      }
    }

    try {
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 3,
      })
      console.log(`[RPC] Transaction submitted: ${signature}`)

      connection.confirmTransaction(signature, "confirmed").catch((confirmError) => {
        console.warn(`Transaction confirmation failed for ${signature}:`, confirmError)
      })

      return signature
    } catch (rpcError: any) {
      console.error("RPC submission also failed:", rpcError)
      throw new Error(`Transaction submission failed: ${rpcError?.message || "Unknown RPC error"}`)
    }
  } catch (error: any) {
    console.error(`Execute sell error for ${wallet.name}:`, error)
    throw error
  }
}

export { autoSellState }
