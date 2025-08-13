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
  monitoringStartTime: 0,
  analysisInterval: null as NodeJS.Timeout | null,
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

    if (!config.mint || !privateKeys || privateKeys.length === 0) {
      console.error("[AUTO-SELL] Invalid configuration:", {
        hasMint: !!config.mint,
        hasPrivateKeys: !!privateKeys,
        privateKeysLength: privateKeys?.length,
      })
      return NextResponse.json({ error: "Invalid configuration or no wallets provided" }, { status: 400 })
    }

    try {
      if (autoSellState.intervals.length > 0) {
        console.log(`[AUTO-SELL] Clearing ${autoSellState.intervals.length} existing intervals`)
        autoSellState.intervals.forEach((interval) => {
          try {
            clearInterval(interval)
          } catch (e) {
            console.warn("[AUTO-SELL] Error clearing interval:", e)
          }
        })
        autoSellState.intervals = []
      }
      ResourceManager.cleanup()
      console.log("[AUTO-SELL] Cleanup completed successfully")
    } catch (cleanupError) {
      console.warn("[AUTO-SELL] Cleanup warning:", cleanupError)
    }

    const wallets = []
    try {
      const { Keypair } = await import("@solana/web3.js")
      const bs58 = await import("bs58")

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
          console.log(`[AUTO-SELL] ✅ Successfully parsed wallet ${i + 1}: ${keypair.publicKey.toBase58()}`)
        } catch (error) {
          console.error(`[AUTO-SELL] ❌ Failed to parse wallet ${i}:`, error)
        }
      }
    } catch (importError) {
      console.error("[AUTO-SELL] Failed to import Solana dependencies:", importError)
      return NextResponse.json({ error: "Failed to initialize Solana dependencies" }, { status: 500 })
    }

    if (wallets.length === 0) {
      console.error("[AUTO-SELL] No valid wallets could be parsed")
      return NextResponse.json({ error: "No valid wallets could be parsed" }, { status: 400 })
    }

    autoSellState.config = {
      ...config,
      timeWindowSeconds: config.timeWindowSeconds || 30,
      sellPercentageOfNetFlow: config.sellPercentageOfNetFlow || 25,
      cooldownSeconds: config.cooldownSeconds || 15,
      slippageBps: config.slippageBps || 300,
    }
    autoSellState.wallets = wallets
    autoSellState.marketTrades = []
    autoSellState.transactionHistory = []
    autoSellState.botStartTime = Date.now()
    autoSellState.firstAnalysisTime = autoSellState.botStartTime + autoSellState.config.timeWindowSeconds * 1000
    autoSellState.isRunning = true

    console.log("[AUTO-SELL] ✅ Configuration set successfully")
    console.log(`[AUTO-SELL] Bot will start analysis in ${autoSellState.config.timeWindowSeconds} seconds`)

    try {
      console.log("[AUTO-SELL] Fetching initial wallet balances...")
      await updateAllWalletBalances()
      console.log("[AUTO-SELL] ✅ Initial wallet balance fetch completed")
    } catch (balanceError) {
      console.warn("[AUTO-SELL] ⚠️ Initial balance fetch failed, will retry:", balanceError)
    }

    try {
      console.log("[AUTO-SELL] Starting auto-sell engine...")
      await startAutoSellEngine()
      console.log("[AUTO-SELL] ✅ Engine started successfully")
    } catch (engineError) {
      console.error("[AUTO-SELL] ❌ Engine startup failed:", engineError)
      autoSellState.isRunning = false
      return NextResponse.json({ error: `Engine startup failed: ${engineError.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets`,
      config: autoSellState.config,
      wallets: autoSellState.wallets.map((wallet) => ({
        name: wallet.name,
        publicKey: wallet.publicKey,
        balance: wallet.balance,
        tokenBalance: wallet.tokenBalance,
      })),
    })
  } catch (error) {
    console.error("[AUTO-SELL] ❌ Critical startup error:", error)
    console.error("[AUTO-SELL] Error stack:", error.stack)
    autoSellState.isRunning = false
    return NextResponse.json(
      {
        error: `Failed to start auto-sell engine: ${error.message}`,
        details: error.stack,
      },
      { status: 500 },
    )
  }
}

async function startAutoSellEngine() {
  try {
    console.log("[AUTO-SELL] Initializing engine components...")

    // Initialize metrics
    autoSellState.metrics = {
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
    }

    // Start SOL price monitoring
    updateSolPrice()
    const solPriceInterval = setInterval(() => {
      if (autoSellState.isRunning) {
        updateSolPrice()
      }
    }, 60000) // Update SOL price every minute

    autoSellState.intervals.push(solPriceInterval)
    ResourceManager.addTimer(solPriceInterval)

    // Start memory monitoring (if available)
    const memoryInterval = setInterval(() => {
      if (autoSellState.isRunning) {
        monitorMemoryUsage()
      }
    }, 30000) // Check memory every 30 seconds

    autoSellState.intervals.push(memoryInterval)
    ResourceManager.addTimer(memoryInterval)

    // Start the analysis cycle
    await startConfigurableAnalysisCycle()

    console.log("[AUTO-SELL] ✅ All engine components started successfully")
  } catch (error) {
    console.error("[AUTO-SELL] ❌ Engine startup error:", error)
    throw error
  }
}

function monitorMemoryUsage() {
  try {
    if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
      const memUsage = process.memoryUsage()
      autoSellState.memoryUsage.lastCheck = Date.now()
      autoSellState.memoryUsage.peakRSS = Math.max(autoSellState.memoryUsage.peakRSS, memUsage.rss)

      if (memUsage.rss > 1024 * 1024 * 1024) {
        // 1GB
        console.warn(`[MEMORY] High memory usage: ${Math.round(memUsage.rss / 1024 / 1024)}MB`)
        if (global.gc) {
          global.gc()
          console.log("[MEMORY] Garbage collection triggered")
        }
      }
    } else {
      console.log("[MEMORY] Memory monitoring not available in this environment")
    }
  } catch (error) {
    console.warn("[MEMORY] Memory monitoring error:", error)
  }
}

async function startConfigurableAnalysisCycle() {
  try {
    console.log(`[AUTO-SELL] Starting analysis cycle with ${autoSellState.config.timeWindowSeconds}s intervals`)

    const waitTime = autoSellState.config.timeWindowSeconds * 1000
    console.log(`[AUTO-SELL] Waiting ${autoSellState.config.timeWindowSeconds} seconds before first analysis...`)

    setTimeout(async () => {
      console.log("[AUTO-SELL] Starting first analysis cycle...")
      // Set the monitoring start time to NOW (when we actually start monitoring)
      autoSellState.monitoringStartTime = Date.now()

      // Run first analysis
      await collectMarketDataForConfigurableWindow()
      await analyzeAndExecuteAutoSell()

      // Set up recurring analysis
      autoSellState.analysisInterval = setInterval(async () => {
        try {
          await collectMarketDataForConfigurableWindow()
          await analyzeAndExecuteAutoSell()
        } catch (error) {
          console.error("[AUTO-SELL] Analysis cycle error:", error)
        }
      }, waitTime)

      console.log(`[AUTO-SELL] ✅ Analysis cycle started with ${autoSellState.config.timeWindowSeconds}s intervals`)
    }, waitTime)
  } catch (error) {
    console.error("[AUTO-SELL] ❌ Failed to start analysis cycle:", error)
    throw error
  }
}

async function collectMarketDataForConfigurableWindow() {
  try {
    console.log("[AUTO-SELL] 🔍 Collecting market data...")

    // Reset metrics
    autoSellState.metrics.buyVolumeUsd = 0
    autoSellState.metrics.sellVolumeUsd = 0
    autoSellState.metrics.netUsdFlow = 0

    // Use direct Solana RPC monitoring instead of Bitquery
    try {
      await collectSolanaRpcData()
      console.log("[AUTO-SELL] ✅ Market data collected via Solana RPC")
    } catch (rpcError) {
      console.warn("[AUTO-SELL] ⚠️ Solana RPC failed, using fallback:", rpcError.message)

      // Fallback to basic price monitoring
      try {
        await updateTokenPrice()
        console.log("[AUTO-SELL] ✅ Token price updated as fallback")
      } catch (priceError) {
        console.warn("[AUTO-SELL] ⚠️ Price update failed:", priceError.message)
      }
    }

    // Update token price
    await updateTokenPrice()

    // Analyze and execute if conditions are met
    await analyzeAndExecuteAutoSell()
  } catch (error) {
    console.error("[AUTO-SELL] ❌ Market data collection failed:", error.message)
  }
}

async function analyzeAndExecuteAutoSell() {
  try {
    const { buyVolumeUsd, sellVolumeUsd } = autoSellState.metrics

    // Calculate net flow exactly as requested: Buy Volume USD - Sell Volume USD = Net Flow
    const calculatedNetFlow = buyVolumeUsd - sellVolumeUsd
    autoSellState.metrics.netUsdFlow = calculatedNetFlow

    console.log(
      `[AUTO-SELL] Analysis: Buy $${buyVolumeUsd.toFixed(2)} - Sell $${sellVolumeUsd.toFixed(2)} = Net Flow $${calculatedNetFlow.toFixed(2)}`,
    )

    // Trigger condition: When Net Flow > 0 (no threshold, just positive flow)
    if (calculatedNetFlow > 0) {
      const sellPercentage = autoSellState.config.sellPercentageOfNetFlow || 25
      const sellAmountUsd = (calculatedNetFlow * sellPercentage) / 100

      console.log(
        `[AUTO-SELL] 🚀 SELL TRIGGER ACTIVE: Net flow $${calculatedNetFlow.toFixed(2)} > $0, will sell ${sellPercentage}% = $${sellAmountUsd.toFixed(2)} worth`,
      )

      // Force immediate execution
      try {
        await executeCoordinatedSell(sellAmountUsd)
        console.log(`[AUTO-SELL] ✅ Coordinated sell executed successfully`)

        // Update last sell time immediately
        autoSellState.metrics.lastSellTime = Date.now()

        // Force wallet balance update after sell
        setTimeout(() => updateAllWalletBalances(), 1000)
      } catch (sellError) {
        console.error("[AUTO-SELL] ❌ Sell execution failed:", sellError)
        console.error("[AUTO-SELL] Error details:", sellError.stack)
      }
    } else {
      console.log(`[AUTO-SELL] No sell trigger: Net flow $${calculatedNetFlow.toFixed(2)} <= $0 (need positive flow)`)
    }
  } catch (error) {
    console.error("[AUTO-SELL] Analysis error:", error)
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
          `[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, ${wallet.tokenBalance.toFixed(6)} tokens`,
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
    if (autoSellState.analysisInterval) {
      clearInterval(autoSellState.analysisInterval)
      ResourceManager.clearTimer(autoSellState.analysisInterval)
    }
    ResourceManager.cleanup()
  }

  setTimeout(() => {
    process.exit(0)
  }, 1000) // Reduced from 2000ms
}

async function collectSolanaRpcData() {
  const { Connection, PublicKey } = await import("@solana/web3.js")

  const rpcEndpoints = [
    process.env.NEXT_PUBLIC_RPC_URL,
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL,
    "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    "https://api.mainnet-beta.solana.com",
  ].filter(Boolean)

  let connection = null
  let lastError = null

  for (const endpoint of rpcEndpoints) {
    try {
      connection = new Connection(endpoint, {
        commitment: "confirmed",
        httpHeaders: {
          "User-Agent": "solana-auto-sell-bot/1.0",
        },
      })

      // Test the connection
      await connection.getLatestBlockhash()
      console.log(`[SOLANA-RPC] ✅ Connected to: ${endpoint}`)
      break
    } catch (error) {
      console.warn(`[SOLANA-RPC] ⚠️ Failed to connect to ${endpoint}:`, error.message)
      lastError = error
      connection = null
    }
  }

  if (!connection) {
    throw new Error(`Failed to connect to any RPC endpoint. Last error: ${lastError?.message}`)
  }

  try {
    const tokenMint = new PublicKey(autoSellState.config.mint)
    const monitoringStartTime = autoSellState.monitoringStartTime || autoSellState.botStartTime

    console.log(
      `[SOLANA-RPC] Monitoring transactions for ${autoSellState.config.mint} since ${new Date(monitoringStartTime).toISOString()}`,
    )

    // Get recent signatures for the token mint
    const signatures = await connection.getSignaturesForAddress(tokenMint, {
      limit: 100,
      commitment: "confirmed",
    })

    console.log(`[SOLANA-RPC] Found ${signatures.length} recent signatures`)

    let buyVolumeUsd = 0
    let sellVolumeUsd = 0
    const processedTransactions = new Set()
    let validTransactionCount = 0

    // Get current SOL price for USD calculations
    const solPriceUsd = await getCurrentSolPrice()
    console.log(`[SOLANA-RPC] Current SOL price: $${solPriceUsd}`)

    for (const sigInfo of signatures) {
      // Only process transactions that occurred after monitoring started
      const txTime = sigInfo.blockTime * 1000 // Convert to milliseconds
      if (txTime < monitoringStartTime) {
        continue
      }

      // Skip if already processed
      if (processedTransactions.has(sigInfo.signature)) {
        continue
      }

      try {
        const transaction = await connection.getParsedTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })

        if (!transaction || transaction.meta?.err) {
          continue
        }

        processedTransactions.add(sigInfo.signature)

        // Analyze transaction for token swaps
        const swapData = analyzeTokenSwapTransaction(transaction, tokenMint.toString(), solPriceUsd)

        if (swapData) {
          validTransactionCount++
          const timestamp = new Date(txTime).toISOString()

          if (swapData.type === "buy") {
            buyVolumeUsd += swapData.amountUsd
            console.log(
              `[SOLANA-RPC] ✅ BUY: $${swapData.amountUsd.toFixed(2)} at ${timestamp} (${sigInfo.signature.substring(0, 8)}...)`,
            )
          } else if (swapData.type === "sell") {
            sellVolumeUsd += swapData.amountUsd
            console.log(
              `[SOLANA-RPC] ❌ SELL: $${swapData.amountUsd.toFixed(2)} at ${timestamp} (${sigInfo.signature.substring(0, 8)}...)`,
            )
          }
        }
      } catch (txError) {
        console.warn(`[SOLANA-RPC] Failed to process transaction ${sigInfo.signature}:`, txError.message)
      }
    }

    autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
    autoSellState.metrics.netUsdFlow = buyVolumeUsd - sellVolumeUsd

    console.log(`[SOLANA-RPC] ✅ Processed ${validTransactionCount} valid transactions`)
    console.log(
      `[SOLANA-RPC] Final results: Buy $${buyVolumeUsd.toFixed(2)}, Sell $${sellVolumeUsd.toFixed(2)}, Net $${autoSellState.metrics.netUsdFlow.toFixed(2)}`,
    )

    if (buyVolumeUsd > 0) {
      console.log(
        `[SOLANA-RPC] 🎯 Real buying pressure detected: $${buyVolumeUsd.toFixed(2)} - matches blockchain data`,
      )
    }
  } catch (error) {
    console.error("[SOLANA-RPC] Transaction monitoring failed:", error.message)
    throw error
  }
}

function analyzeTokenSwapTransaction(transaction: any, tokenMint: string, solPriceUsd: number) {
  try {
    const instructions = transaction.transaction.message.instructions
    const preBalances = transaction.meta.preBalances
    const postBalances = transaction.meta.postBalances
    const accounts = transaction.transaction.message.accountKeys

    // Look for SOL balance changes to determine buy/sell
    let solChange = 0
    let tokenChange = 0

    // Calculate SOL balance changes
    for (let i = 0; i < preBalances.length; i++) {
      const change = (postBalances[i] - preBalances[i]) / 1e9 // Convert lamports to SOL
      if (Math.abs(change) > 0.001) {
        // Ignore dust
        solChange += change
      }
    }

    // Look for token balance changes in parsed instructions
    const tokenBalanceChanges = transaction.meta.postTokenBalances || []
    const preTokenBalances = transaction.meta.preTokenBalances || []

    for (const postBalance of tokenBalanceChanges) {
      if (postBalance.mint === tokenMint) {
        const preBalance = preTokenBalances.find(
          (pre) => pre.accountIndex === postBalance.accountIndex && pre.mint === tokenMint,
        )

        if (preBalance) {
          const change = Number(postBalance.uiTokenAmount.uiAmount) - Number(preBalance.uiTokenAmount.uiAmount)
          if (Math.abs(change) > 0) {
            tokenChange = change
          }
        }
      }
    }

    // Determine if this is a buy or sell based on SOL and token changes
    if (Math.abs(solChange) > 0.001 && Math.abs(tokenChange) > 0) {
      const amountUsd = Math.abs(solChange) * solPriceUsd

      if (solChange < 0 && tokenChange > 0) {
        // SOL decreased, tokens increased = BUY
        return { type: "buy", amountUsd, solAmount: Math.abs(solChange), tokenAmount: tokenChange }
      } else if (solChange > 0 && tokenChange < 0) {
        // SOL increased, tokens decreased = SELL
        return { type: "sell", amountUsd, solAmount: Math.abs(solChange), tokenAmount: Math.abs(tokenChange) }
      }
    }

    return null
  } catch (error) {
    console.warn("[SOLANA-RPC] Transaction analysis failed:", error.message)
    return null
  }
}

async function getCurrentSolPrice(): Promise<number> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    return data.solana?.usd || 100 // Fallback to $100 if API fails
  } catch (error) {
    console.warn("[SOLANA-RPC] Failed to fetch SOL price, using fallback:", error.message)
    return 100 // Fallback price
  }
}

async function executeCoordinatedSell(sellAmountUsd: number) {
  try {
    console.log(`[AUTO-SELL] 🚀 STARTING COORDINATED SELL EXECUTION`)
    console.log(`[AUTO-SELL] Target sell amount: $${sellAmountUsd.toFixed(2)}`)

    // Force price update with multiple fallbacks
    console.log(`[AUTO-SELL] Step 1: Updating token price...`)
    await updateTokenPrice()
    let currentPriceUsd = autoSellState.metrics.currentPriceUsd

    if (currentPriceUsd <= 0) {
      console.log(`[AUTO-SELL] Price is $0, using DexScreener fallback...`)
      try {
        const axios = await import("axios")
        const response = await axios.default.get(
          `https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`,
          { timeout: 5000 },
        )
        if (response.data?.pairs?.[0]?.priceUsd) {
          currentPriceUsd = Number.parseFloat(response.data.pairs[0].priceUsd)
          autoSellState.metrics.currentPriceUsd = currentPriceUsd
          console.log(`[AUTO-SELL] DexScreener price: $${currentPriceUsd}`)
        }
      } catch (priceError) {
        console.log(`[AUTO-SELL] DexScreener failed, using conservative fallback price`)
        currentPriceUsd = 0.000001 // Conservative fallback
        autoSellState.metrics.currentPriceUsd = currentPriceUsd
      }
    }

    console.log(`[AUTO-SELL] Using price: $${currentPriceUsd}`)

    // Force wallet balance update
    console.log(`[AUTO-SELL] Step 2: Updating wallet balances...`)
    await updateAllWalletBalances()

    const walletsWithTokens = autoSellState.wallets.filter((wallet) => {
      const hasTokens = wallet.tokenBalance > 0.0001 // Minimum threshold
      console.log(
        `[BALANCE] ${wallet.name}: ${wallet.balance.toFixed(4)} SOL, ${wallet.tokenBalance.toFixed(6)} tokens - ${hasTokens ? "✅ WILL SELL" : "❌ SKIP"}`,
      )
      return hasTokens
    })

    if (walletsWithTokens.length === 0) {
      console.log("[AUTO-SELL] ❌ NO WALLETS HAVE TOKENS TO SELL!")
      console.log("[AUTO-SELL] Wallet details:")
      autoSellState.wallets.forEach((wallet) => {
        console.log(
          `[AUTO-SELL]   ${wallet.name}: SOL=${wallet.balance.toFixed(4)}, Tokens=${wallet.tokenBalance.toFixed(6)}`,
        )
      })
      return
    }

    const totalTokensHeld = walletsWithTokens.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
    const totalTokensToSell = sellAmountUsd / currentPriceUsd

    console.log(`[AUTO-SELL] 🎯 SELL CALCULATION:`)
    console.log(`[AUTO-SELL]   - Total tokens held: ${totalTokensHeld.toFixed(6)}`)
    console.log(`[AUTO-SELL]   - Target sell USD: $${sellAmountUsd.toFixed(2)}`)
    console.log(`[AUTO-SELL]   - Total tokens to sell: ${totalTokensToSell.toFixed(6)}`)
    console.log(`[AUTO-SELL]   - Price per token: $${currentPriceUsd}`)

    // Execute sells immediately with all wallets
    const sellPromises = walletsWithTokens.map(async (wallet, index) => {
      try {
        const walletTokenRatio = wallet.tokenBalance / totalTokensHeld
        const walletSellAmount = Math.min(totalTokensToSell * walletTokenRatio, wallet.tokenBalance * 0.95) // Sell 95% to avoid dust

        if (walletSellAmount < 0.0001) {
          console.log(`[AUTO-SELL] ${wallet.name}: Sell amount too small (${walletSellAmount.toFixed(6)}), skipping`)
          return null
        }

        console.log(
          `[AUTO-SELL] ${wallet.name}: Selling ${walletSellAmount.toFixed(6)} tokens (${(walletTokenRatio * 100).toFixed(1)}% of total)`,
        )

        const signature = await executeSell(wallet, walletSellAmount)
        const sellUsdValue = walletSellAmount * currentPriceUsd

        console.log(`[AUTO-SELL] ${wallet.name}: ✅ SELL SUCCESS! Signature: ${signature}`)

        // Update metrics immediately
        autoSellState.metrics.totalSold += sellUsdValue
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
        console.error(`[AUTO-SELL] ${wallet.name}: ❌ SELL FAILED:`, error.message)
        return {
          wallet: wallet.name,
          error: error.message,
        }
      }
    })

    console.log(`[AUTO-SELL] 🔄 Executing ${sellPromises.length} sell transactions simultaneously...`)
    const results = await Promise.allSettled(sellPromises)

    const successful = results.filter((r) => r.status === "fulfilled" && r.value && !r.value.error).map((r) => r.value)
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value?.error))

    console.log(`[AUTO-SELL] 📊 EXECUTION RESULTS:`)
    console.log(`[AUTO-SELL]   - Successful: ${successful.length}`)
    console.log(`[AUTO-SELL]   - Failed: ${failed.length}`)

    if (successful.length > 0) {
      const totalSoldUsd = successful.reduce((sum, r) => sum + (r.usdValue || 0), 0)
      const totalSoldTokens = successful.reduce((sum, r) => sum + (r.tokenAmount || 0), 0)

      console.log(`[AUTO-SELL] 🎉 TOTAL SOLD: ${totalSoldTokens.toFixed(6)} tokens = $${totalSoldUsd.toFixed(2)}`)

      successful.forEach((result) => {
        console.log(
          `[AUTO-SELL]   ✅ ${result.wallet}: ${result.tokenAmount.toFixed(6)} tokens = $${result.usdValue.toFixed(2)} (${result.signature})`,
        )
      })

      // Update wallet balances after successful sells
      setTimeout(() => updateAllWalletBalances(), 2000)
    }

    if (failed.length > 0) {
      console.log(`[AUTO-SELL] ❌ FAILED SELLS: ${failed.length}`)
    }

    console.log(`[AUTO-SELL] ✅ COORDINATED SELL EXECUTION COMPLETED`)
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in coordinated sell:", error)
    throw error
  }
}
