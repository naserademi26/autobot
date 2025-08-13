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

  autoSellState.metrics.analysisWindowStart = Date.now()
  autoSellState.metrics.windowCompleted = false
  console.log(`[ENGINE] Starting new ${autoSellState.config.timeWindowSeconds}s analysis window`)

  const marketMonitorInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    if (Date.now() - autoSellState.startTime > autoSellState.maxRunTimeMs) {
      console.log("[ENGINE] Max runtime reached, shutting down")
      await stopAutoSellEngine()
      return
    }

    try {
      await monitorMarketActivity()
      if (autoSellState.errorCount > 0) {
        autoSellState.errorCount = Math.max(0, autoSellState.errorCount - 1)
      }
    } catch (error: any) {
      autoSellState.errorCount++
      autoSellState.lastError = error?.message || "Market monitoring error"
      console.error("Market monitoring error:", error)

      if (autoSellState.errorCount > 10) {
        console.error("Too many errors, stopping auto-sell engine")
        await stopAutoSellEngine()
      }
    }
  }, 10000)

  const executionInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await checkAndExecuteAutoSell()
    } catch (error: any) {
      autoSellState.errorCount++
      autoSellState.lastError = error?.message || "Auto-sell execution error"
      console.error("Auto-sell execution error:", error)

      if (autoSellState.errorCount > 10) {
        console.error("Too many errors, stopping auto-sell engine")
        await stopAutoSellEngine()
      }
    }
  }, 30000) // Check every 30 seconds instead of 15

  const balanceInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await updateAllWalletBalances()
    } catch (error: any) {
      console.error("Balance update error:", error)
    }
  }, 60000) // Reduced to every 60 seconds to save resources

  autoSellState.intervals.push(marketMonitorInterval, executionInterval, balanceInterval)
  autoSellState.intervalIds.add(marketMonitorInterval)
  autoSellState.intervalIds.add(executionInterval)
  autoSellState.intervalIds.add(balanceInterval)
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

async function monitorMarketActivity() {
  try {
    const solPriceController = new AbortController()
    const solPriceTimeout = setTimeout(() => solPriceController.abort(), 5000)

    let solPriceUsd = autoSellState.metrics.solPriceUsd // Use previous value as fallback

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
    const dexTimeout = setTimeout(() => dexController.abort(), 8000)

    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`, {
        signal: dexController.signal,
        headers: { "User-Agent": "AutoSellBot/1.0" },
      })
      clearTimeout(dexTimeout)

      if (!response.ok) {
        throw new Error(`DexScreener API returned ${response.status}`)
      }

      const data = await response.json()

      if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        console.log("[MARKET MONITOR] No trading pairs found")
        return
      }

      // Get the most liquid pair with validation
      const validPairs = data.pairs.filter(
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

      // Get recent transactions from the pair with validation
      const volume24h = Math.max(0, Number(pair.volume?.h24 || 0))
      const priceChange24h = Number(pair.priceChange?.h24 || 0)

      // Estimate recent buy/sell activity based on volume and price movement
      const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
      const currentTime = Date.now()

      autoSellState.marketTrades = autoSellState.marketTrades
        .filter((trade) => trade && trade.timestamp && currentTime - trade.timestamp < timeWindowMs)
        .slice(-100) // Keep only last 100 trades max

      // Estimate current market momentum based on price change and volume
      const volumeInWindow = Math.max(0, (volume24h / 24 / 60) * (autoSellState.config.timeWindowSeconds / 60))
      const buyRatio = Math.max(0.1, Math.min(0.9, priceChange24h > 0 ? 0.6 : 0.4))

      const estimatedBuyVolumeUsd = volumeInWindow * buyRatio
      const estimatedSellVolumeUsd = volumeInWindow * (1 - buyRatio)

      // Add estimated trade data with validation
      if (isFinite(estimatedBuyVolumeUsd) && isFinite(estimatedSellVolumeUsd)) {
        const tradeData = {
          timestamp: currentTime,
          buyVolumeUsd: estimatedBuyVolumeUsd,
          sellVolumeUsd: estimatedSellVolumeUsd,
          priceUsd: currentPriceUsd,
        }

        autoSellState.marketTrades.push(tradeData)
      }

      // Calculate net USD flow in time window with validation
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
        `[MARKET MONITOR] Price: $${currentPriceUsd.toFixed(6)} | Buy: $${buyVolumeUsd.toFixed(2)} | Sell: $${sellVolumeUsd.toFixed(2)} | Net: $${netUsdFlow.toFixed(2)}`,
      )
    } catch (dexError: any) {
      clearTimeout(dexTimeout)
      throw new Error(`DexScreener error: ${dexError?.message || "Unknown error"}`)
    }
  } catch (error: any) {
    console.error("Market monitoring error:", error)
    throw error
  }
}

async function checkAndExecuteAutoSell() {
  try {
    const currentTime = Date.now()
    const windowDurationMs = autoSellState.config.timeWindowSeconds * 1000
    const timeSinceWindowStart = currentTime - autoSellState.metrics.analysisWindowStart

    // Check if analysis window is complete
    if (timeSinceWindowStart < windowDurationMs) {
      const remainingSeconds = Math.ceil((windowDurationMs - timeSinceWindowStart) / 1000)
      console.log(`[WINDOW] Analysis window in progress... ${remainingSeconds}s remaining`)
      return
    }

    // Window is complete, check if we should sell
    if (!autoSellState.metrics.windowCompleted) {
      autoSellState.metrics.windowCompleted = true
      console.log(`[WINDOW] Analysis window completed! Analyzing ${autoSellState.config.timeWindowSeconds}s of data...`)

      const netUsdFlow = autoSellState.metrics.netUsdFlow
      const minNetFlowUsd = autoSellState.config.minNetFlowUsd

      console.log(
        `[ANALYSIS] Window Results: Buy Volume: $${autoSellState.metrics.buyVolumeUsd.toFixed(2)} | Sell Volume: $${autoSellState.metrics.sellVolumeUsd.toFixed(2)} | Net Flow: $${netUsdFlow.toFixed(2)}`,
      )

      if (netUsdFlow > minNetFlowUsd) {
        console.log(
          `[TRIGGER] Positive net flow $${netUsdFlow.toFixed(2)} > threshold $${minNetFlowUsd} - EXECUTING SELL`,
        )
        await executeAutoSell()
      } else {
        console.log(`[NO TRIGGER] Net flow $${netUsdFlow.toFixed(2)} <= threshold $${minNetFlowUsd} - No sell executed`)
      }

      console.log(`[WINDOW] Starting new ${autoSellState.config.timeWindowSeconds}s analysis window`)
      autoSellState.metrics.analysisWindowStart = currentTime
      autoSellState.metrics.windowCompleted = false
      autoSellState.marketTrades = [] // Clear old trades for new window
      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0
      autoSellState.metrics.netUsdFlow = 0
    }
  } catch (error: any) {
    console.error("Window check error:", error)
    throw error
  }
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

    // Convert USD amount to equivalent token amount based on current price
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
      // Calculate proportional amount for this wallet
      const walletProportion = wallet.tokenBalance / totalTokensHeld
      const walletTokensToSell = exactTokensToSell * walletProportion

      // Only sell if amount is meaningful (> 0.000001 tokens)
      if (walletTokensToSell > 0.000001) {
        totalTokensToSell += walletTokensToSell

        const sellPromise = executeSell(wallet, walletTokensToSell)
          .then((signature) => {
            const actualUsdSold = walletTokensToSell * currentPriceUsd
            const actualSolReceived = walletTokensToSell * autoSellState.metrics.currentPrice

            // Set cooldown for this wallet
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

    // Calculate totals and update metrics
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

    autoSellState.metrics.lastSellTrigger = Date.now()
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
  // Process wallets in batches to prevent overwhelming RPC
  const batchSize = 3
  const walletBatches = []

  for (let i = 0; i < autoSellState.wallets.length; i += batchSize) {
    walletBatches.push(autoSellState.wallets.slice(i, i + batchSize))
  }

  for (const batch of walletBatches) {
    const balancePromises = batch.map((wallet) =>
      updateWalletBalances(wallet).catch((error) => {
        console.error(`Error updating balance for ${wallet.name}:`, error)
        return null
      }),
    )

    await Promise.allSettled(balancePromises)

    // Small delay between batches to prevent rate limiting
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

    const balanceController = new AbortController()
    const balanceTimeout = setTimeout(() => balanceController.abort(), 10000)

    try {
      // Get SOL balance
      const solBalance = await connection.getBalance(wallet.keypair.publicKey)
      wallet.balance = solBalance / 1e9

      // Get token balance
      try {
        const mintPubkey = new PublicKey(autoSellState.config.mint)
        const ata = await getAssociatedTokenAddress(mintPubkey, wallet.keypair.publicKey)
        const tokenAccount = await connection.getTokenAccountBalance(ata)
        wallet.tokenBalance = tokenAccount.value?.uiAmount || 0
      } catch (tokenError) {
        // Token account might not exist, set to 0
        wallet.tokenBalance = 0
      }

      clearTimeout(balanceTimeout)
    } catch (rpcError: any) {
      clearTimeout(balanceTimeout)
      throw new Error(`RPC error: ${rpcError?.message || "Unknown RPC error"}`)
    }
  } catch (error: any) {
    console.error("Error updating wallet balances:", error)
    throw error
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

    // Convert to atoms with validation
    const amountInAtoms = BigInt(Math.floor(amount * 10 ** decimals)).toString()

    if (!amountInAtoms || amountInAtoms === "0") {
      throw new Error("Invalid amount calculation")
    }

    // Get Jupiter quote with timeout
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

    // Get swap transaction with timeout
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

    // Sign and submit transaction
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
          statusText: error.response?.statusText,
          data: error.response?.data,
        })
        console.log("Falling back to RPC submission...")
      }
    }

    // Fallback to RPC with better error handling
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

// Export the state for status endpoint
export { autoSellState }
