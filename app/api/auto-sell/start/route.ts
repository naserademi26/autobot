import { type NextRequest, NextResponse } from "next/server"
import { Buffer } from "buffer"

const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  marketTrades: [] as any[],
  bitquerySubscription: null as any,
  botStartTime: 0,
  firstAnalysisTime: 0,
  metrics: {
    totalBought: 0,
    totalSold: 0,
    currentPrice: 0,
    currentPriceUsd: 0,
    solPriceUsd: 100,
    netUsdFlow: 0,
    buyVolumeUsd: 0,
    sellVolumeUsd: 0,
    lastSellTrigger: 0,
    botExecutedSellsUsd: 0,
    totalMarketSellsUsd: 0,
    lastSellTime: 0,
  },
  transactionHistory: [] as any[],
  intervals: [] as NodeJS.Timeout[],
  memoryUsage: {
    lastCheck: 0,
    peakRSS: 0,
    warnings: 0,
  },
  lastActivity: Date.now(),
  isServerless: true,
}

// Resource management and cleanup utilities
class ResourceManager {
  private static connections = new Map<string, any>()
  private static timers = new Set<NodeJS.Timeout>()
  private static cleanupScheduled = false

  static addTimer(timer: NodeJS.Timeout) {
    this.timers.add(timer)
    this.scheduleCleanup()
  }

  static clearTimer(timer: NodeJS.Timeout) {
    clearInterval(timer)
    this.timers.delete(timer)
  }

  static clearAllTimers() {
    this.timers.forEach((timer) => clearInterval(timer))
    this.timers.clear()
  }

  static getConnection(key: string, factory: () => any) {
    if (!this.connections.has(key)) {
      this.connections.set(key, factory())
    }
    return this.connections.get(key)
  }

  static scheduleCleanup() {
    if (!this.cleanupScheduled) {
      this.cleanupScheduled = true
      // Clean up after 4 minutes of inactivity (before Vercel timeout)
      setTimeout(() => {
        if (Date.now() - autoSellState.lastActivity > 240000) {
          console.log("[VERCEL] Auto-cleanup due to inactivity")
          this.cleanup()
        }
        this.cleanupScheduled = false
      }, 240000)
    }
  }

  static cleanup() {
    this.clearAllTimers()
    this.connections.clear()
  }
}

export async function POST(request: NextRequest) {
  try {
    autoSellState.lastActivity = Date.now()

    const { config, privateKeys } = await request.json()

    if (autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is already running" }, { status: 400 })
    }

    // Validate configuration
    if (!config.mint || !privateKeys || privateKeys.length === 0) {
      return NextResponse.json({ error: "Invalid configuration or no wallets provided" }, { status: 400 })
    }

    ResourceManager.cleanup()
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []

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
      timeWindowSeconds: config.timeWindowSeconds || 30, // Changed from 120 to 30 seconds for faster reaction
      sellPercentageOfNetFlow: config.sellPercentageOfNetFlow || 25, // Default 25% of net flow
      minNetFlowUsd: config.minNetFlowUsd || 10, // Minimum $10 net flow to trigger
      cooldownSeconds: config.cooldownSeconds || 15, // Reduced from 30 to 15 seconds for faster execution
      slippageBps: config.slippageBps || 300, // Default slippage
    }
    autoSellState.wallets = wallets
    autoSellState.marketTrades = []
    autoSellState.isRunning = true

    console.log("[AUTO-SELL] Fetching wallet balances immediately...")
    await updateAllWalletBalances()

    // Start monitoring and execution intervals
    await startAutoSellEngine()

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets (Vercel optimized)`,
      config: autoSellState.config,
      wallets: autoSellState.wallets.map((wallet) => ({
        name: wallet.name,
        publicKey: wallet.publicKey,
        balance: wallet.balance,
        tokenBalance: wallet.tokenBalance,
      })),
    })
  } catch (error) {
    console.error("Error starting auto-sell:", error)
    return NextResponse.json({ error: "Failed to start auto-sell engine" }, { status: 500 })
  }
}

async function startAutoSellEngine() {
  ResourceManager.cleanup()
  autoSellState.intervals.forEach((interval) => clearInterval(interval))
  autoSellState.intervals = []

  autoSellState.botStartTime = Date.now()
  const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
  autoSellState.firstAnalysisTime = autoSellState.botStartTime + timeWindowMs

  console.log(`[AUTO-SELL] Bot started at ${new Date(autoSellState.botStartTime).toISOString()}`)
  console.log(`[AUTO-SELL] First analysis will begin at ${new Date(autoSellState.firstAnalysisTime).toISOString()}`)
  console.log(
    `[AUTO-SELL] Waiting ${autoSellState.config.timeWindowSeconds} seconds before starting market analysis...`,
  )

  await startConfigurableAnalysisCycle()

  const balanceInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return
    autoSellState.lastActivity = Date.now()

    try {
      await updateAllWalletBalances()
      console.log("[AUTO-SELL] Wallet balances updated")
      monitorMemoryUsage()
    } catch (error) {
      console.error("Balance update error:", error)
    }
  }, 45000) // Increased to 45 seconds for Vercel

  autoSellState.intervals.push(balanceInterval)
  ResourceManager.addTimer(balanceInterval)
}

function monitorMemoryUsage() {
  try {
    // Check if process.memoryUsage is available (Node.js runtime)
    if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
      const usage = process.memoryUsage()
      const now = Date.now()

      if (usage.rss > autoSellState.memoryUsage.peakRSS) {
        autoSellState.memoryUsage.peakRSS = usage.rss
      }

      if (now - autoSellState.memoryUsage.lastCheck > 180000) {
        autoSellState.memoryUsage.lastCheck = now
        const memoryMB = Math.round(usage.rss / 1024 / 1024)
        console.log(
          `[MEMORY] Current: ${memoryMB}MB, Peak: ${Math.round(autoSellState.memoryUsage.peakRSS / 1024 / 1024)}MB`,
        )

        if (memoryMB > 800) {
          autoSellState.memoryUsage.warnings++
          console.warn(`[MEMORY] High memory usage detected: ${memoryMB}MB`)

          if (global.gc) {
            global.gc()
            console.log("[MEMORY] Forced garbage collection")
          }
        }
      }
    } else {
      // Serverless environment - use simplified monitoring
      const now = Date.now()
      if (now - autoSellState.memoryUsage.lastCheck > 300000) {
        // Check every 5 minutes
        autoSellState.memoryUsage.lastCheck = now
        console.log("[MEMORY] Running in serverless environment - memory monitoring limited")
      }
    }
  } catch (error) {
    console.warn("[MEMORY] Memory monitoring unavailable in this environment:", error.message)
  }
}

async function startConfigurableAnalysisCycle() {
  updateSolPrice()

  const timeWindowSeconds = autoSellState.config.timeWindowSeconds
  const timeWindowMs = timeWindowSeconds * 1000

  console.log(`[AUTO-SELL] Setting up ${timeWindowSeconds}-second analysis cycles...`)

  const timeUntilFirstAnalysis = autoSellState.firstAnalysisTime - Date.now()

  const firstAnalysisTimeout = setTimeout(
    () => {
      if (!autoSellState.isRunning) return

      autoSellState.lastActivity = Date.now()
      console.log(`[AUTO-SELL] ${timeWindowSeconds}-second wait complete. Starting market analysis...`)

      collectMarketDataForConfigurableWindow()
      analyzeAndExecuteAutoSell()

      const analysisInterval = setInterval(async () => {
        if (!autoSellState.isRunning) {
          clearInterval(analysisInterval)
          ResourceManager.clearTimer(analysisInterval)
          return
        }

        autoSellState.lastActivity = Date.now()

        try {
          console.log(`[AUTO-SELL] Starting ${timeWindowSeconds}-second market analysis...`)
          await collectMarketDataForConfigurableWindow()
          await analyzeAndExecuteAutoSell()
        } catch (error) {
          console.error(`[AUTO-SELL] ${timeWindowSeconds}-second analysis error:`, error)
        }
      }, timeWindowMs)

      autoSellState.intervals.push(analysisInterval)
      ResourceManager.addTimer(analysisInterval)
    },
    Math.max(0, timeUntilFirstAnalysis),
  )

  ResourceManager.addTimer(firstAnalysisTimeout as any)
}

async function collectMarketDataForConfigurableWindow() {
  try {
    const timeWindowSeconds = autoSellState.config.timeWindowSeconds
    console.log(`[AUTO-SELL] Collecting ${timeWindowSeconds}-second market data...`)

    try {
      await collectDirectSolanaTransactions()
      console.log("[SOLANA-RPC] Successfully collected real transaction data as primary source")
      return
    } catch (error) {
      console.log("[SOLANA-RPC] Primary failed, falling back to DexScreener:", error.message)
    }

    // Use DexScreener as fallback only
    await collectDexScreenerData()
  } catch (error) {
    console.error("[AUTO-SELL] Data collection failed:", error)
    // Reset metrics if all data sources fail
    autoSellState.metrics.buyVolumeUsd = 0
    autoSellState.metrics.sellVolumeUsd = 0
    autoSellState.metrics.netUsdFlow = 0
  }
}

async function collectDirectSolanaTransactions() {
  const { Connection, PublicKey } = await import("@solana/web3.js")

  const connection = ResourceManager.getConnection(
    "solana-rpc",
    () =>
      new Connection(
        process.env.NEXT_PUBLIC_RPC_URL ||
          process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
          "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
        {
          commitment: "confirmed",
          httpHeaders: {
            "User-Agent": "solana-auto-sell-bot/1.0",
          },
        },
      ),
  )

  const timeWindowSeconds = autoSellState.config.timeWindowSeconds
  const cutoffTime = Date.now() - timeWindowSeconds * 1000

  console.log(
    `[SOLANA-RPC] Monitoring transactions for token ${autoSellState.config.mint} from last ${timeWindowSeconds} seconds`,
  )

  try {
    const mintPubkey = new PublicKey(autoSellState.config.mint)

    const signatures = (await Promise.race([
      connection.getSignaturesForAddress(mintPubkey, { limit: 50 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 15000)),
    ])) as any[]

    console.log(`[SOLANA-RPC] Found ${signatures.length} recent signatures`)

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    const concurrencyLimit = 5
    for (let i = 0; i < signatures.length; i += concurrencyLimit) {
      const batch = signatures.slice(i, i + concurrencyLimit)

      const batchPromises = batch.map(async (sigInfo) => {
        const txTime = (sigInfo.blockTime || 0) * 1000

        if (txTime < cutoffTime) {
          return null
        }

        try {
          const tx = await Promise.race([
            connection.getTransaction(sigInfo.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("TX timeout")), 10000)),
          ])

          if (!tx || !tx.meta) return null

          const tradeInfo = analyzeTransaction(tx, autoSellState.config.mint)
          return { tradeInfo, txTime, signature: sigInfo.signature }
        } catch (txError) {
          return null
        }
      })

      const batchResults = await Promise.allSettled(batchPromises)

      batchResults.forEach((result) => {
        if (result.status === "fulfilled" && result.value?.tradeInfo) {
          const { tradeInfo, txTime, signature } = result.value

          if (tradeInfo.type === "buy") {
            totalBuyVolumeUsd += tradeInfo.usdAmount
            buyCount++
            console.log(
              `[SOLANA-RPC] BUY: $${tradeInfo.usdAmount.toFixed(2)} at ${new Date(txTime).toISOString()} (${signature.substring(0, 8)}...)`,
            )
          } else if (tradeInfo.type === "sell") {
            totalSellVolumeUsd += tradeInfo.usdAmount
            sellCount++
            console.log(
              `[SOLANA-RPC] SELL: $${tradeInfo.usdAmount.toFixed(2)} at ${new Date(txTime).toISOString()} (${signature.substring(0, 8)}...)`,
            )
          }
        }
      })
    }

    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.totalMarketSellsUsd = totalSellVolumeUsd

    // Net Flow = Buy Volume USD - Sell Volume USD (market sells only, not including bot sells)
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(
      `[SOLANA-RPC] MARKET DATA - Buy: $${totalBuyVolumeUsd.toFixed(2)} (${buyCount} txs) | Market Sells: $${totalSellVolumeUsd.toFixed(2)} (${sellCount} txs) | Net: $${autoSellState.metrics.netUsdFlow.toFixed(2)}`,
    )

    if (buyCount === 0 && sellCount === 0) {
      console.log("[SOLANA-RPC] No trading activity detected in the time window")
    }
  } catch (error) {
    console.error("[SOLANA-RPC] Error collecting transaction data:", error)
    throw error
  }
}

function analyzeTransaction(tx: any, tokenMint: string) {
  try {
    if (!tx.meta || !tx.meta.preBalances || !tx.meta.postBalances) {
      return null
    }

    // Look for SOL balance changes to determine buy/sell
    const solBalanceChanges = tx.meta.postBalances.map(
      (post: number, index: number) => post - tx.meta.preBalances[index],
    )

    // Find the largest SOL balance change (excluding fees)
    let maxSolChange = 0
    let maxSolChangeIndex = -1

    solBalanceChanges.forEach((change: number, index: number) => {
      if (Math.abs(change) > Math.abs(maxSolChange) && Math.abs(change) > 5000) {
        // Ignore small fee changes
        maxSolChange = change
        maxSolChangeIndex = index
      }
    })

    if (maxSolChangeIndex === -1) {
      return null
    }

    const solChange = maxSolChange / 1e9 // Convert lamports to SOL
    const solPriceUsd = autoSellState.metrics.solPriceUsd || 100
    const usdAmount = Math.abs(solChange) * solPriceUsd

    // Determine if it's a buy or sell based on SOL flow
    const type = solChange < 0 ? "buy" : "sell" // Negative SOL change = buying tokens with SOL

    return {
      type,
      solAmount: Math.abs(solChange),
      usdAmount,
      signature: tx.transaction.signatures[0],
    }
  } catch (error) {
    return null
  }
}

async function collectDexScreenerData() {
  try {
    console.log("[DEXSCREENER] Bitquery failed, using DexScreener with conservative estimation")

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
    const data = await response.json()

    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0]
      const priceUsd = Number(pair.priceUsd || 0)
      const volume24h = Number(pair.volume?.h24 || 0)
      const priceChange5m = Number(pair.priceChange?.m5 || 0)

      autoSellState.metrics.currentPriceUsd = priceUsd
      autoSellState.metrics.currentPrice = priceUsd / autoSellState.metrics.solPriceUsd

      const timeWindowMinutes = autoSellState.config.timeWindowSeconds / 60
      const estimatedVolume = (volume24h / (24 * 60)) * timeWindowMinutes

      if (priceChange5m > 0.5) {
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.6
        autoSellState.metrics.totalMarketSellsUsd = estimatedVolume * 0.4
      } else if (priceChange5m < -0.5) {
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.4
        autoSellState.metrics.totalMarketSellsUsd = estimatedVolume * 0.6
      } else {
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.5
        autoSellState.metrics.totalMarketSellsUsd = estimatedVolume * 0.5
      }

      autoSellState.metrics.sellVolumeUsd = autoSellState.metrics.totalMarketSellsUsd
      autoSellState.metrics.netUsdFlow = autoSellState.metrics.buyVolumeUsd - autoSellState.metrics.sellVolumeUsd

      console.log(
        `[DEXSCREENER] Price: $${priceUsd.toFixed(8)} | 5m Change: ${priceChange5m.toFixed(2)}% | Buy: $${autoSellState.metrics.buyVolumeUsd.toFixed(2)} | Market Sells: $${autoSellState.metrics.totalMarketSellsUsd.toFixed(2)} | Bot Sells: $${autoSellState.metrics.botExecutedSellsUsd.toFixed(2)} | Total Sells: $${autoSellState.metrics.sellVolumeUsd.toFixed(2)} | Net: $${autoSellState.metrics.netUsdFlow.toFixed(2)}`,
      )
    } else {
      console.log("[DEXSCREENER] No trading pairs found")
      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.totalMarketSellsUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0 // No market sells detected
      autoSellState.metrics.netUsdFlow = 0 - 0 // Buy Volume USD - Sell Volume USD = 0
    }
  } catch (error) {
    console.error("[DEXSCREENER] Data collection failed:", error)
    autoSellState.metrics.buyVolumeUsd = 0
    autoSellState.metrics.totalMarketSellsUsd = 0
    autoSellState.metrics.sellVolumeUsd = 0 // No market sells
    autoSellState.metrics.netUsdFlow = 0 - 0 // Buy Volume USD - Sell Volume USD = 0
  }
}

async function analyzeAndExecuteAutoSell() {
  try {
    const netUsdFlow = autoSellState.metrics.netUsdFlow
    const buyVolumeUsd = autoSellState.metrics.buyVolumeUsd
    const sellVolumeUsd = autoSellState.metrics.sellVolumeUsd
    const cooldownMs = autoSellState.config.cooldownSeconds * 1000
    const currentTime = Date.now()

    console.log(
      `[AUTO-SELL] Analysis - Buy Volume: $${buyVolumeUsd.toFixed(2)}, Sell Volume: $${sellVolumeUsd.toFixed(2)}, Net Flow: $${netUsdFlow.toFixed(2)}`,
    )

    if (netUsdFlow > 0 && buyVolumeUsd > 0) {
      console.log(
        `[AUTO-SELL] ✅ POSITIVE NET FLOW DETECTED! Buy: $${buyVolumeUsd.toFixed(2)} > Sell: $${sellVolumeUsd.toFixed(2)} = Net: +$${netUsdFlow.toFixed(2)}`,
      )

      if (currentTime - autoSellState.metrics.lastSellTrigger < cooldownMs) {
        const remainingCooldown = Math.ceil((cooldownMs - (currentTime - autoSellState.metrics.lastSellTrigger)) / 1000)
        console.log(`[AUTO-SELL] ⏳ In cooldown period, ${remainingCooldown}s remaining`)
        return
      }

      console.log(`[AUTO-SELL] 🚀 AUTOMATIC SELL TRIGGERED! Executing immediately...`)
      console.log(`[AUTO-SELL] 🎯 Sell Parameters:`)
      console.log(`[AUTO-SELL]   - Buy Volume: $${buyVolumeUsd.toFixed(2)}`)
      console.log(`[AUTO-SELL]   - Sell Volume: $${sellVolumeUsd.toFixed(2)}`)
      console.log(`[AUTO-SELL]   - Net USD Flow: +$${netUsdFlow.toFixed(2)}`)
      console.log(`[AUTO-SELL]   - Sell Percentage: ${autoSellState.config.sellPercentageOfNetFlow}%`)
      console.log(
        `[AUTO-SELL]   - Target Sell Amount: $${((netUsdFlow * autoSellState.config.sellPercentageOfNetFlow) / 100).toFixed(2)}`,
      )

      // Mark sell as triggered immediately to prevent double execution
      autoSellState.metrics.lastSellTrigger = currentTime

      try {
        console.log(`[AUTO-SELL] Step 1: Updating token price...`)
        await updateTokenPrice()
        console.log(`[AUTO-SELL] Step 1 Complete: Current price = $${autoSellState.metrics.currentPriceUsd}`)

        console.log(`[AUTO-SELL] Step 2: Updating wallet balances...`)
        await updateAllWalletBalances()
        const totalTokens = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
        console.log(`[AUTO-SELL] Step 2 Complete: Total tokens = ${totalTokens.toFixed(4)}`)

        console.log(`[AUTO-SELL] Step 3: Executing coordinated sell across all wallets...`)
        await executeCoordinatedSell(netUsdFlow)
        console.log(`[AUTO-SELL] Step 3 Complete: ✅ AUTOMATIC SELL EXECUTION FINISHED`)

        console.log(`[AUTO-SELL] 🎉 SUCCESS! Automatic sell completed at ${new Date().toISOString()}`)
      } catch (sellError) {
        console.error(`[AUTO-SELL] ❌ AUTOMATIC SELL FAILED:`, sellError)
        // Reset the trigger time so it can try again on next cycle
        autoSellState.metrics.lastSellTrigger = 0
        throw sellError
      }
    } else if (netUsdFlow <= 0) {
      console.log(
        `[AUTO-SELL] ❌ No positive net flow detected. Buy: $${buyVolumeUsd.toFixed(2)}, Sell: $${sellVolumeUsd.toFixed(2)}, Net: $${netUsdFlow.toFixed(2)} - NO SELL TRIGGERED`,
      )
    } else if (buyVolumeUsd <= 0) {
      console.log(`[AUTO-SELL] ❌ No buy volume detected ($${buyVolumeUsd.toFixed(2)}) - NO SELL TRIGGERED`)
    }
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in automatic sell analysis:", error)
    console.error("[AUTO-SELL] Error stack:", error.stack)
  }
}

async function executeCoordinatedSell(netUsdFlow: number) {
  try {
    console.log(`[AUTO-SELL] 🚀 STARTING COORDINATED SELL EXECUTION`)
    console.log(`[AUTO-SELL] Net USD Flow: $${netUsdFlow.toFixed(2)}`)

    // Force price update with multiple fallbacks
    console.log(`[AUTO-SELL] Step 1: Forcing price update...`)
    let currentPriceUsd = autoSellState.metrics.currentPriceUsd

    if (currentPriceUsd <= 0) {
      console.log(`[AUTO-SELL] Current price is $0, forcing fresh price fetch...`)
      await updateTokenPrice()
      currentPriceUsd = autoSellState.metrics.currentPriceUsd

      if (currentPriceUsd <= 0) {
        console.log(`[AUTO-SELL] Price still $0, using conservative fallback price...`)
        currentPriceUsd = 0.000001 // Conservative fallback
        autoSellState.metrics.currentPriceUsd = currentPriceUsd
      }
    }

    console.log(`[AUTO-SELL] Using price: $${currentPriceUsd}`)

    // Force wallet balance update
    console.log(`[AUTO-SELL] Step 2: Forcing wallet balance update...`)
    await updateAllWalletBalances()

    const walletsWithTokens = autoSellState.wallets.filter((wallet) => {
      const hasTokens = wallet.tokenBalance > 0
      console.log(
        `[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, ${wallet.tokenBalance.toFixed(2)} tokens - ${hasTokens ? "✅ WILL SELL" : "❌ SKIP"}`,
      )
      return hasTokens
    })

    if (walletsWithTokens.length === 0) {
      console.log("[AUTO-SELL] ❌ NO WALLETS HAVE TOKENS TO SELL!")
      autoSellState.wallets.forEach((wallet) => {
        console.log(
          `[AUTO-SELL]   ${wallet.name}: SOL=${wallet.balance.toFixed(4)}, Tokens=${wallet.tokenBalance.toFixed(4)}`,
        )
      })
      return
    }

    const totalTokensHeld = walletsWithTokens.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
    const sellPercentage = autoSellState.config.sellPercentageOfNetFlow || 25
    const targetSellUsd = (netUsdFlow * sellPercentage) / 100
    const totalTokensToSell = targetSellUsd / currentPriceUsd

    console.log(`[AUTO-SELL] 🎯 SELL CALCULATION:`)
    console.log(`[AUTO-SELL]   - Total tokens held: ${totalTokensHeld.toFixed(4)}`)
    console.log(
      `[AUTO-SELL]   - Target sell USD: $${targetSellUsd.toFixed(2)} (${sellPercentage}% of $${netUsdFlow.toFixed(2)})`,
    )
    console.log(`[AUTO-SELL]   - Total tokens to sell: ${totalTokensToSell.toFixed(4)}`)
    console.log(`[AUTO-SELL]   - Price per token: $${currentPriceUsd}`)

    if (totalTokensToSell > totalTokensHeld) {
      console.log(
        `[AUTO-SELL] ⚠️ Adjusting sell amount: Want ${totalTokensToSell.toFixed(4)} but only have ${totalTokensHeld.toFixed(4)}`,
      )
    }

    // Execute sells with enhanced error handling
    const sellPromises = walletsWithTokens.map(async (wallet, index) => {
      try {
        const walletTokenRatio = wallet.tokenBalance / totalTokensHeld
        const walletSellAmount = Math.min(totalTokensToSell * walletTokenRatio, wallet.tokenBalance)

        if (walletSellAmount < 0.0001) {
          console.log(`[AUTO-SELL] ${wallet.name}: Sell amount too small (${walletSellAmount.toFixed(6)}), skipping`)
          return null
        }

        console.log(
          `[AUTO-SELL] ${wallet.name}: Selling ${walletSellAmount.toFixed(4)} tokens (${(walletTokenRatio * 100).toFixed(1)}% of total)`,
        )

        const signature = await executeSell(wallet, walletSellAmount)
        const sellUsdValue = walletSellAmount * currentPriceUsd

        console.log(`[AUTO-SELL] ${wallet.name}: ✅ SELL SUCCESS! Signature: ${signature}`)

        // Update metrics immediately
        autoSellState.metrics.totalSold += sellUsdValue
        autoSellState.metrics.sellVolumeUsd += sellUsdValue
        autoSellState.metrics.lastSellTime = Date.now()

        // Add to transaction history
        autoSellState.transactionHistory.unshift({
          timestamp: Date.now(),
          type: "sell",
          wallet: wallet.name,
          tokenAmount: walletSellAmount,
          usdValue: sellUsdValue,
          price: currentPriceUsd,
          signature: signature,
        })

        // Keep only last 50 transactions
        if (autoSellState.transactionHistory.length > 50) {
          autoSellState.transactionHistory = autoSellState.transactionHistory.slice(0, 50)
        }

        return {
          wallet: wallet.name,
          tokenAmount: walletSellAmount,
          usdValue: sellUsdValue,
          signature: signature,
        }
      } catch (error) {
        console.error(`[AUTO-SELL] ${wallet.name}: ❌ SELL FAILED:`, error)
        return {
          wallet: wallet.name,
          error: error.message,
        }
      }
    })

    console.log(`[AUTO-SELL] 🔄 Executing ${sellPromises.length} sell transactions...`)
    const results = await Promise.all(sellPromises)

    const successful = results.filter((r) => r && !r.error)
    const failed = results.filter((r) => r && r.error)

    console.log(`[AUTO-SELL] 📊 EXECUTION RESULTS:`)
    console.log(`[AUTO-SELL]   - Successful: ${successful.length}`)
    console.log(`[AUTO-SELL]   - Failed: ${failed.length}`)

    if (successful.length > 0) {
      const totalSoldUsd = successful.reduce((sum, r) => sum + (r.usdValue || 0), 0)
      const totalSoldTokens = successful.reduce((sum, r) => sum + (r.tokenAmount || 0), 0)

      console.log(`[AUTO-SELL] 🎉 TOTAL SOLD: ${totalSoldTokens.toFixed(4)} tokens = $${totalSoldUsd.toFixed(2)}`)

      successful.forEach((result) => {
        console.log(
          `[AUTO-SELL]   ✅ ${result.wallet}: ${result.tokenAmount.toFixed(4)} tokens = $${result.usdValue.toFixed(2)} (${result.signature})`,
        )
      })

      // Update wallet balances after successful sells
      await updateAllWalletBalances()
    }

    if (failed.length > 0) {
      console.log(`[AUTO-SELL] ❌ FAILED SELLS:`)
      failed.forEach((result) => {
        console.log(`[AUTO-SELL]   ❌ ${result.wallet}: ${result.error}`)
      })
    }

    console.log(`[AUTO-SELL] ✅ COORDINATED SELL EXECUTION COMPLETED`)
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in coordinated sell:", error)
    console.error("[AUTO-SELL] Error stack:", error.stack)
    throw error
  }
}

async function executeSell(wallet: any, amount: number) {
  console.log(`[SELL] Starting sell for ${wallet.name}: ${amount.toFixed(4)} tokens`)

  try {
    const axios = await import("axios")
    const { Connection, VersionedTransaction } = await import("@solana/web3.js")

    const connection = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ||
        process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
        "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
      { commitment: "confirmed" },
    )

    const { getMint } = await import("@solana/spl-token")
    const { PublicKey } = await import("@solana/web3.js")

    console.log(`[SELL] Getting mint info for ${autoSellState.config.mint}`)
    const mintInfo = await getMint(connection, new PublicKey(autoSellState.config.mint))
    const decimals = mintInfo.decimals
    const amountInAtoms = BigInt(Math.floor(amount * 10 ** decimals)).toString()

    console.log(`[SELL] Amount: ${amount} tokens = ${amountInAtoms} atoms (decimals: ${decimals})`)

    const jupiterBase = "https://quote-api.jup.ag"
    const outputMint = "So11111111111111111111111111111111111111112" // SOL

    console.log(`[SELL] Getting Jupiter quote...`)
    const quoteResponse = await axios.default.get(`${jupiterBase}/v6/quote`, {
      params: {
        inputMint: autoSellState.config.mint,
        outputMint: outputMint,
        amount: amountInAtoms,
        slippageBps: autoSellState.config.slippageBps || 300,
      },
      timeout: 10000,
    })

    console.log(`[SELL] Quote received, getting swap transaction...`)
    const swapResponse = await axios.default.post(
      `${jupiterBase}/v6/swap`,
      {
        userPublicKey: wallet.keypair.publicKey.toBase58(),
        quoteResponse: quoteResponse.data,
      },
      { timeout: 10000 },
    )

    console.log(`[SELL] Signing transaction...`)
    const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.data.swapTransaction, "base64"))
    tx.sign([wallet.keypair])

    // Try bloXroute first
    const auth =
      process.env.BLOXROUTE_API_KEY ||
      "NTI4Y2JhNWYtM2UwMy00NmFlLTg3MjEtMDE0NzI0OTMwNmRkOmU1YThkYjkxMDFhYTI5ZjM4MWQ1YmY3ZTBhMjIyYjk0"
    if (auth) {
      try {
        console.log(`[SELL] Submitting via bloXroute...`)
        const serializedTx = Buffer.from(tx.serialize()).toString("base64")
        const bloxrouteUrl = "https://ny.solana.dex.blxrbdn.com"

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
            timeout: 15000,
          },
        )

        if (response.data?.signature) {
          console.log(`[SELL] ✅ bloXroute success: ${response.data.signature}`)
          return response.data.signature
        } else {
          throw new Error("No signature returned from bloXroute")
        }
      } catch (error: any) {
        console.error(`[SELL] bloXroute failed:`, error.message)
        console.log(`[SELL] Falling back to RPC...`)
      }
    }

    // Fallback to RPC
    try {
      console.log(`[SELL] Submitting via RPC...`)
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 3,
      })
      console.log(`[SELL] ✅ RPC success: ${signature}`)

      // Don't wait for confirmation to speed up execution
      connection.confirmTransaction(signature, "confirmed").catch((err) => {
        console.log(`[SELL] Confirmation warning for ${signature}:`, err.message)
      })

      return signature
    } catch (error) {
      console.error(`[SELL] ❌ RPC also failed:`, error)
      throw error
    }
  } catch (error) {
    console.error(`[SELL] ❌ COMPLETE FAILURE for ${wallet.name}:`, error)
    throw error
  }
}

async function updateTokenPrice() {
  try {
    console.log(`[PRICE-UPDATE] Fetching current price for token ${autoSellState.config.mint}...`)

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
    const data = await response.json()

    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0]
      const priceUsd = Number(pair.priceUsd || 0)

      if (priceUsd > 0) {
        autoSellState.metrics.currentPriceUsd = priceUsd
        autoSellState.metrics.currentPrice = priceUsd / autoSellState.metrics.solPriceUsd
        console.log(`[PRICE-UPDATE] ✅ Updated token price: $${priceUsd.toFixed(8)} USD`)
      } else {
        console.log(`[PRICE-UPDATE] ❌ Invalid price received: ${priceUsd}`)
      }
    } else {
      console.log(`[PRICE-UPDATE] ❌ No trading pairs found for token`)
    }
  } catch (error) {
    console.error("[PRICE-UPDATE] Failed to update token price:", error)
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

    const solBalance = await connection.getBalance(wallet.keypair.publicKey)
    wallet.balance = solBalance / 1e9

    try {
      const mintPubkey = new PublicKey(autoSellState.config.mint)
      const ata = await getAssociatedTokenAddress(mintPubkey, wallet.keypair.publicKey)

      const accountInfo = await connection.getAccountInfo(ata)
      if (accountInfo) {
        const tokenAccount = await connection.getTokenAccountBalance(ata)
        wallet.tokenBalance = tokenAccount.value?.uiAmount || 0
        console.log(
          `[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, ${wallet.tokenBalance.toFixed(2)} tokens`,
        )
      } else {
        wallet.tokenBalance = 0
        console.log(`[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, 0 tokens (no token account)`)
      }
    } catch (tokenError) {
      wallet.tokenBalance = 0
      console.log(`[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, 0 tokens (error: ${tokenError.message})`)
    }
  } catch (error) {
    console.error(`[BALANCE] Error updating ${wallet.name} balances:`, error)
    wallet.balance = wallet.balance || 0
    wallet.tokenBalance = wallet.tokenBalance || 0
  }
}

async function updateAllWalletBalances() {
  const balancePromises = autoSellState.wallets.map((wallet) => updateWalletBalances(wallet))
  await Promise.all(balancePromises)

  const totalTokens = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
  console.log(`[BALANCE] All wallet balances updated. Total tokens across wallets: ${totalTokens.toFixed(2)}`)
}

export { autoSellState }

async function updateSolPrice() {
  try {
    const solPriceResponse = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
    const solPriceData = await solPriceResponse.json()
    const solPriceUsd = solPriceData?.solana?.usd || 100
    autoSellState.metrics.solPriceUsd = solPriceUsd
  } catch (error) {
    console.error("Failed to update SOL price:", error)
  }
}

process.on("SIGTERM", () => {
  console.log("[AUTO-SELL] Received SIGTERM (Vercel), shutting down gracefully...")
  gracefulShutdown()
})

process.on("SIGINT", () => {
  console.log("[AUTO-SELL] Received SIGINT, shutting down gracefully...")
  gracefulShutdown()
})

process.on("uncaughtException", (error) => {
  console.error("[AUTO-SELL] Uncaught Exception:", error)
  console.error("[AUTO-SELL] Stack:", error.stack)
  // Don't exit immediately, try to recover
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("[AUTO-SELL] Unhandled Rejection at:", promise, "reason:", reason)
  // Don't exit immediately, try to recover
})

function gracefulShutdown() {
  if (autoSellState.isRunning) {
    autoSellState.isRunning = false
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []
    ResourceManager.cleanup()
  }

  setTimeout(() => {
    process.exit(0)
  }, 1000) // Reduced from 2000ms
}
