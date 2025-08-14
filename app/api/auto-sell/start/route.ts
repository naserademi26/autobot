import { type NextRequest, NextResponse } from "next/server"
import {
  updateAllWalletBalances,
  updateTokenPrice,
  collectMarketDataForConfigurableWindow,
  analyzeAndExecuteAutoSell,
  handleRealTimeTransaction,
} from "./utils" // Assuming these functions are declared in a utils file

const PREMIUM_APIS = {
  alchemy: {
    mainnet1: "https://solana-mainnet.g.alchemy.com/v2/xPZFpP1qn7EApXWTwYAdP",
    mainnet2: "https://solana-mainnet.g.alchemy.com/v2/DmvQMkbPZW42fYymT4V3Z3Qb7PNI-kIf",
  },
  moralis: {
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjMzYTE1NmJiLWZhMGQtNDU4Zi04NGEyLWVkNDIwYjQ1NDNjNiIsIm9yZ0lkIjoiNDY1MTk3IiwidXNlcklkIjoiNDc4NTkwIiwidHlwZUlkIjoiYTM2NDI2OTctYmYwMy00OWVhLWIwZTYtYTc5OGU1NDNkMTA4IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NTUyMDUwODUsImV4cCI6NDkxMDk2NTA4NX0.tErjySs0lpTELwue3KDhq5jQGTLf5cIlUP88BPo65ks",
  },
  quicknode: {
    apiKey: "f1e32d45-d3d2-4895-8123-708173a75f40",
  },
  ankr: {
    endpoint: "https://rpc.ankr.com/solana_devnet/ea81565d15b5f5217552fb8ca13e8c8c3db650af668d910fa6369bc619e9e9c4d",
  },
  drpc: {
    endpoint: "https://lb.drpc.org/solana/AoLSJPx3VEsDmDDks2UasTR-g70MeVMR8Is_IgaNGuYu",
  },
  chainstack: {
    https: "https://solana-mainnet.core.chainstack.com/1dddd2834b79c0f3f43138bd4a45e3eb",
    wss: "wss://solana-mainnet.core.chainstack.com/1dddd2834b79c0f3f43138bd4a45e3eb",
  },
}

const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  marketTrades: [] as any[],
  bitquerySubscription: null as any,
  moralisStream: null as any,
  chainstackWs: null as any,
  quicknodeStream: null as any,
  botStartTime: 0,
  firstAnalysisTime: 0,
  monitoringStartTime: 0,
  monitoringEndTime: 0,
  lastDataUpdateTime: 0,
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
    buyTransactionCount: 0,
    sellTransactionCount: 0,
    dataSourceConfidence: 0, // 0-100 confidence in data accuracy
    lastRealTimeUpdate: 0,
  },
  intervals: [] as NodeJS.Timeout[],
}

process.on("uncaughtException", (error) => {
  console.error("[CRASH-PREVENTION] Uncaught Exception:", error)
  // Don't exit the process, just log the error
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRASH-PREVENTION] Unhandled Rejection at:", promise, "reason:", reason)
  // Don't exit the process, just log the error
})

const bulletproofTransactionClassifier = {
  classifyTransaction: (apiType: string, tokenAmount: number, usdAmount: number, source: string) => {
    console.log(
      `[BULLETPROOF-CLASSIFIER] Input - API Type: "${apiType}", Token Amount: ${tokenAmount}, USD: $${usdAmount.toFixed(6)}, Source: ${source}`,
    )

    let finalType: string

    // BULLETPROOF LOGIC: Use token amount direction as PRIMARY classifier
    // This is the most reliable method across all APIs
    if (tokenAmount < 0) {
      finalType = "buy" // Negative = tokens leaving pool = someone bought
      console.log(`[BULLETPROOF-CLASSIFIER] Token amount ${tokenAmount} < 0 = BUY (tokens leaving pool)`)
    } else if (tokenAmount > 0) {
      finalType = "sell" // Positive = tokens entering pool = someone sold
      console.log(`[BULLETPROOF-CLASSIFIER] Token amount ${tokenAmount} > 0 = SELL (tokens entering pool)`)
    } else {
      // If token amount is zero, use API type but apply source-specific corrections
      if (source === "DexScreener") {
        // DexScreener API returns reversed types
        finalType = apiType === "buy" ? "sell" : apiType === "sell" ? "buy" : "unknown"
        console.log(`[BULLETPROOF-CLASSIFIER] DexScreener reversal: API "${apiType}" -> "${finalType}"`)
      } else if (source === "DexTools") {
        // DexTools API ALSO returns reversed types (discovered from user testing)
        finalType = apiType === "buy" ? "sell" : apiType === "sell" ? "buy" : "unknown"
        console.log(`[BULLETPROOF-CLASSIFIER] DexTools reversal: API "${apiType}" -> "${finalType}"`)
      } else {
        // Other APIs use correct types
        finalType = apiType
        console.log(`[BULLETPROOF-CLASSIFIER] Using API type directly: "${apiType}"`)
      }
    }

    console.log(`[BULLETPROOF-CLASSIFIER] 🎯 FINAL RESULT: ${finalType.toUpperCase()} for $${usdAmount.toFixed(6)}`)
    return finalType
  },
}

const transactionClassifier = {
  // Cross-validate transaction types from multiple sources
  classifyTransaction: (apiType: string, tokenAmount: number, priceChange: number, source: string) => {
    console.log(
      `[CLASSIFIER] Raw data - API Type: ${apiType}, Token Amount: ${tokenAmount}, Price Change: ${priceChange}%, Source: ${source}`,
    )

    let finalType = "unknown"

    if (tokenAmount < 0) {
      finalType = "buy" // Negative token amount = tokens leaving pool = someone bought
    } else if (tokenAmount > 0) {
      finalType = "sell" // Positive token amount = tokens entering pool = someone sold
    } else {
      // Fallback to API type only if token amount is zero
      finalType = apiType === "buy" ? "buy" : apiType === "sell" ? "sell" : "unknown"
    }

    console.log(`[CLASSIFIER] FINAL CLASSIFICATION: ${finalType.toUpperCase()} (${source})`)
    return finalType
  },

  validateClassification: (transactions: any[]) => {
    const buyCount = transactions.filter((t) => t.type === "buy").length
    const sellCount = transactions.filter((t) => t.type === "sell").length
    const confidence = transactions.length > 0 ? ((buyCount + sellCount) / transactions.length) * 100 : 0

    console.log(
      `[CLASSIFIER] Validation - Buys: ${buyCount}, Sells: ${sellCount}, Confidence: ${confidence.toFixed(1)}%`,
    )
    return { buyCount, sellCount, confidence }
  },
}

const sellTriggerManager = {
  activeTriggers: new Set<string>(),

  createTriggerId: (netFlow: number, timestamp: number) => {
    return `trigger_${Math.round(netFlow * 1000)}_${Math.floor(timestamp / 10000)}`
  },

  canExecuteSell: (netFlow: number, timestamp: number) => {
    const triggerId = sellTriggerManager.createTriggerId(netFlow, timestamp)

    if (sellTriggerManager.activeTriggers.has(triggerId)) {
      console.log(`[TRIGGER] ❌ DUPLICATE TRIGGER BLOCKED: ${triggerId}`)
      return false
    }

    sellTriggerManager.activeTriggers.add(triggerId)
    console.log(`[TRIGGER] ✅ NEW TRIGGER REGISTERED: ${triggerId}`)

    // Clean old triggers (older than 5 minutes)
    setTimeout(
      () => {
        sellTriggerManager.activeTriggers.delete(triggerId)
        console.log(`[TRIGGER] 🧹 CLEANED OLD TRIGGER: ${triggerId}`)
      },
      5 * 60 * 1000,
    )

    return true
  },
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
      timeWindowSeconds: config.timeWindowSeconds || 30, // 30-second tracking window
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

    try {
      await startAutoSellEngine()
    } catch (error) {
      console.error("[AUTO-SELL] Failed to start engine:", error)
      autoSellState.isRunning = false
      return NextResponse.json({ error: "Failed to start auto-sell engine" }, { status: 500 })
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
    console.error("Error starting auto-sell:", error)
    autoSellState.isRunning = false
    return NextResponse.json({ error: "Failed to start auto-sell engine" }, { status: 500 })
  }
}

async function startAutoSellEngine() {
  try {
    // Clear any existing intervals
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []

    autoSellState.botStartTime = Date.now()
    autoSellState.firstAnalysisTime = autoSellState.botStartTime

    console.log(`[AUTO-SELL] Bot started at ${new Date(autoSellState.botStartTime).toISOString()}`)
    console.log(`[AUTO-SELL] Starting immediate market analysis...`)

    try {
      await updateTokenPrice()
    } catch (error) {
      console.error("[AUTO-SELL] Token price update failed:", error)
    }

    try {
      await startConfigurableAnalysisCycle()
    } catch (error) {
      console.error("[AUTO-SELL] Analysis cycle start failed:", error)
    }

    const balanceInterval = setInterval(async () => {
      if (!autoSellState.isRunning) return
      try {
        await updateAllWalletBalances()
        console.log("[AUTO-SELL] Wallet balances updated")
      } catch (error) {
        console.error("Balance update error:", error)
        // Don't crash, just continue
      }
    }, 30000)

    autoSellState.intervals.push(balanceInterval)
  } catch (error) {
    console.error("[AUTO-SELL] Critical error in startAutoSellEngine:", error)
    autoSellState.isRunning = false
    throw error
  }
}

async function startConfigurableAnalysisCycle() {
  const timeWindowSeconds = autoSellState.config?.timeWindowSeconds || 30
  const scanIntervalSeconds = 10 // Scan every 10 seconds

  console.log(`[AUTO-SELL] Starting ${timeWindowSeconds}-second analysis cycle (scan every ${scanIntervalSeconds}s)`)

  try {
    await collectMarketDataForConfigurableWindow()
    await analyzeAndExecuteAutoSell()
  } catch (error) {
    console.error("[AUTO-SELL] Initial analysis failed:", error)
    // Don't crash, continue with interval
  }

  const analysisInterval = setInterval(async () => {
    if (!autoSellState.isRunning) {
      clearInterval(analysisInterval)
      return
    }

    try {
      console.log(
        `[AUTO-SELL] Running ${timeWindowSeconds}-second market analysis (scan every ${scanIntervalSeconds}s)...`,
      )
      await collectMarketDataForConfigurableWindow()
      await analyzeAndExecuteAutoSell()
    } catch (error) {
      console.error(`[AUTO-SELL] ${timeWindowSeconds}-second analysis error:`, error)
      // Don't crash the interval, just log and continue
    }
  }, scanIntervalSeconds * 1000)

  autoSellState.intervals.push(analysisInterval)
}

async function collectDirectSolanaTransactions() {
  if (!autoSellState.config) {
    console.error("[SOLANA-RPC] Error: autoSellState.config is null")
    return
  }

  const { Connection, PublicKey } = await import("@solana/web3.js")

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    { commitment: "confirmed" },
  )

  const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
  const currentTime = Date.now()
  const windowStartTime = currentTime - timeWindowMs

  autoSellState.monitoringStartTime = windowStartTime
  autoSellState.monitoringEndTime = currentTime
  autoSellState.lastDataUpdateTime = currentTime

  console.log(`[SOLANA-RPC] 🔍 DEBUGGING TRANSACTION DETECTION`)
  console.log(`[SOLANA-RPC] Token mint: ${autoSellState.config.mint}`)
  console.log(`[SOLANA-RPC] Current time: ${new Date(currentTime).toISOString()}`)
  console.log(`[SOLANA-RPC] Window start: ${new Date(windowStartTime).toISOString()}`)
  console.log(`[SOLANA-RPC] Time window: ${autoSellState.config.timeWindowSeconds} seconds`)
  console.log(`[SOLANA-RPC] Current token price: $${autoSellState.metrics.currentPriceUsd.toFixed(8)}`)

  try {
    const tokenMintPubkey = new PublicKey(autoSellState.config.mint)

    console.log(`[SOLANA-RPC] 📋 Getting signatures for token mint address...`)

    const allSignatures = []
    let before = undefined
    let totalFetched = 0

    // Fetch signatures in batches to handle high-volume tokens
    while (totalFetched < 1000) {
      // Scan up to 1000 recent transactions
      const signatures = await connection.getSignaturesForAddress(tokenMintPubkey, {
        limit: 1000,
        before: before,
      })

      if (signatures.length === 0) break

      allSignatures.push(...signatures)
      totalFetched += signatures.length
      before = signatures[signatures.length - 1].signature

      // Stop if we've gone beyond our time window
      const oldestTime = (signatures[signatures.length - 1].blockTime || 0) * 1000
      if (oldestTime < windowStartTime) break
    }

    console.log(`[SOLANA-RPC] 📋 Found ${allSignatures.length} total signatures for token mint`)

    // Filter signatures by time window
    const recentSignatures = allSignatures.filter((sig) => {
      const txTime = (sig.blockTime || 0) * 1000
      return txTime >= windowStartTime
    })

    console.log(
      `[SOLANA-RPC] 📋 ${recentSignatures.length} signatures within ${autoSellState.config.timeWindowSeconds}-second window`,
    )

    if (recentSignatures.length === 0) {
      console.log(`[SOLANA-RPC] ⚠️ NO RECENT TRANSACTIONS FOUND!`)
      console.log(`[SOLANA-RPC] This could mean:`)
      console.log(`[SOLANA-RPC] 1. No trading activity in the last ${autoSellState.config.timeWindowSeconds} seconds`)
      console.log(`[SOLANA-RPC] 2. RPC endpoint has delays`)
      console.log(`[SOLANA-RPC] 3. Token mint address is incorrect`)
      console.log(`[SOLANA-RPC] 4. Transactions are going through different programs`)
    }

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0
    let analyzedCount = 0
    let filteredCount = 0
    const processedTransactions = []

    for (const sigInfo of recentSignatures) {
      const txTime = (sigInfo.blockTime || 0) * 1000

      try {
        console.log(`[SOLANA-RPC] 🔍 Fetching transaction ${sigInfo.signature.substring(0, 8)}...`)

        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })

        if (!tx || !tx.meta) {
          console.log(`[SOLANA-RPC] ❌ No transaction data for ${sigInfo.signature.substring(0, 8)}`)
          continue
        }

        console.log(`[SOLANA-RPC] ✅ Transaction data retrieved for ${sigInfo.signature.substring(0, 8)}`)
        analyzedCount++

        const tradeInfo = analyzeTokenMintTransaction(tx, autoSellState.config.mint)

        if (tradeInfo) {
          processedTransactions.push({
            signature: tradeInfo.signature,
            type: tradeInfo.type,
            usdAmount: tradeInfo.usdAmount,
            timestamp: txTime,
          })

          if (tradeInfo.type === "buy") {
            totalBuyVolumeUsd += tradeInfo.usdAmount
            buyCount++
            console.log(
              `[SOLANA-RPC] ✅ BUY DETECTED: $${tradeInfo.usdAmount.toFixed(4)} | ${tradeInfo.tokenAmount.toFixed(4)} tokens`,
            )
          } else if (tradeInfo.type === "sell") {
            totalSellVolumeUsd += tradeInfo.usdAmount
            sellCount++
            console.log(
              `[SOLANA-RPC] ❌ SELL DETECTED: $${tradeInfo.usdAmount.toFixed(4)} | ${tradeInfo.tokenAmount.toFixed(4)} tokens`,
            )
          }
        } else {
          filteredCount++
          console.log(`[SOLANA-RPC] ⚪ Transaction ${sigInfo.signature.substring(0, 8)} - NO TRADE DETECTED`)
        }
      } catch (txError) {
        console.log(
          `[SOLANA-RPC] ❌ Error analyzing transaction ${sigInfo.signature.substring(0, 8)}: ${txError.message}`,
        )
        continue
      }
    }

    autoSellState.marketTrades = processedTransactions
    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(`[SOLANA-RPC] 📊 FINAL RESULTS:`)
    console.log(`[SOLANA-RPC] - Total signatures: ${allSignatures.length}`)
    console.log(`[SOLANA-RPC] - Recent signatures: ${recentSignatures.length}`)
    console.log(`[SOLANA-RPC] - Analyzed: ${analyzedCount}`)
    console.log(`[SOLANA-RPC] - Filtered out: ${filteredCount}`)
    console.log(`[SOLANA-RPC] - Buy transactions: ${buyCount} ($${totalBuyVolumeUsd.toFixed(4)})`)
    console.log(`[SOLANA-RPC] - Sell transactions: ${sellCount} ($${totalSellVolumeUsd.toFixed(4)})`)
    console.log(`[SOLANA-RPC] - Net Flow: $${(totalBuyVolumeUsd - totalSellVolumeUsd).toFixed(4)}`)

    if (buyCount === 0 && sellCount === 0) {
      console.log(`[SOLANA-RPC] ⚠️ NO TRADES DETECTED - DEBUGGING INFO:`)
      console.log(`[SOLANA-RPC] - Token price: $${autoSellState.metrics.currentPriceUsd}`)
      console.log(`[SOLANA-RPC] - Minimum USD threshold: $0.0001`)
      console.log(`[SOLANA-RPC] - RPC endpoint: ${connection.rpcEndpoint}`)
      console.log(`[SOLANA-RPC] - Token mint: ${autoSellState.config.mint}`)
    }
  } catch (error) {
    console.error("[SOLANA-RPC] Error collecting transaction data:", error)
    throw error
  }
}

function analyzeTokenMintTransaction(transaction: any, tokenMint: string) {
  try {
    const { meta, transaction: txData } = transaction

    if (!meta || !txData) {
      console.log(`[TX-ANALYSIS] ❌ Missing transaction metadata`)
      return null
    }

    const preTokenBalances = meta.preTokenBalances || []
    const postTokenBalances = meta.postTokenBalances || []

    console.log(`[TX-ANALYSIS] 🔍 ANALYZING TRANSACTION: ${txData.signatures?.[0]?.substring(0, 8)}`)
    console.log(`[TX-ANALYSIS] - Pre token balances: ${preTokenBalances.length}`)
    console.log(`[TX-ANALYSIS] - Post token balances: ${postTokenBalances.length}`)

    // Find all token balance changes for our mint
    const tokenBalanceChanges = []

    // Check existing accounts
    for (const preBalance of preTokenBalances) {
      if (preBalance.mint === tokenMint) {
        const postBalance = postTokenBalances.find(
          (post: any) => post.accountIndex === preBalance.accountIndex && post.mint === tokenMint,
        )

        if (postBalance) {
          const preAmount = Number(preBalance.uiTokenAmount?.uiAmount || 0)
          const postAmount = Number(postBalance.uiTokenAmount?.uiAmount || 0)
          const change = postAmount - preAmount

          if (Math.abs(change) > 0.000001) {
            tokenBalanceChanges.push({
              accountIndex: preBalance.accountIndex,
              preAmount,
              postAmount,
              change,
            })
            console.log(
              `[TX-ANALYSIS] - Account ${preBalance.accountIndex}: ${preAmount.toFixed(6)} → ${postAmount.toFixed(6)} (${change > 0 ? "+" : ""}${change.toFixed(6)})`,
            )
          }
        }
      }
    }

    // Check for new token accounts
    for (const postBalance of postTokenBalances) {
      if (postBalance.mint === tokenMint) {
        const preBalance = preTokenBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex && pre.mint === tokenMint,
        )

        if (!preBalance) {
          const newTokens = Number(postBalance.uiTokenAmount?.uiAmount || 0)
          if (newTokens > 0.000001) {
            tokenBalanceChanges.push({
              accountIndex: postBalance.accountIndex,
              preAmount: 0,
              postAmount: newTokens,
              change: newTokens,
            })
            console.log(
              `[TX-ANALYSIS] - NEW Account ${postBalance.accountIndex}: 0 → ${newTokens.toFixed(6)} (+${newTokens.toFixed(6)})`,
            )
          }
        }
      }
    }

    if (tokenBalanceChanges.length === 0) {
      console.log(`[TX-ANALYSIS] ❌ No token balance changes found for mint ${tokenMint}`)
      return null
    }

    // Sort by absolute change amount to find the trader (not the pool)
    const sortedChanges = tokenBalanceChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

    let traderChange = null
    let transactionType = "unknown"
    let tradeAmount = 0

    for (const change of sortedChanges) {
      const absChange = Math.abs(change.change)

      // Skip extremely large changes that are likely pool operations (>10M tokens)
      if (absChange > 10000000) {
        console.log(`[TX-ANALYSIS] - Skipping massive pool change: ${change.change.toFixed(6)} tokens`)
        continue
      }

      // Look for significant trader-sized changes (>0.001 tokens)
      if (absChange > 0.001) {
        traderChange = change
        transactionType = change.change > 0 ? "buy" : "sell"
        tradeAmount = absChange
        console.log(
          `[TX-ANALYSIS] ✅ TRADER IDENTIFIED: Account ${change.accountIndex}, ${transactionType.toUpperCase()}, ${tradeAmount.toFixed(6)} tokens (${change.change > 0 ? "RECEIVED" : "SENT"})`,
        )
        break
      }
    }

    // If no clear trader found, use the largest non-pool change
    if (!traderChange && sortedChanges.length > 0) {
      const nonPoolChanges = sortedChanges.filter((change) => Math.abs(change.change) < 50000000)

      if (nonPoolChanges.length > 0) {
        traderChange = nonPoolChanges[0]
        transactionType = traderChange.change > 0 ? "buy" : "sell"
        tradeAmount = Math.abs(traderChange.change)
        console.log(
          `[TX-ANALYSIS] ⚠️ FALLBACK TRADER: ${transactionType.toUpperCase()}, ${tradeAmount.toFixed(6)} tokens`,
        )
      }
    }

    if (!traderChange) {
      console.log(`[TX-ANALYSIS] ❌ No trader identified in transaction`)
      return null
    }

    // Calculate USD amount with better price handling
    let currentPrice = autoSellState.metrics.currentPriceUsd || 0

    if (currentPrice === 0) {
      currentPrice = 0.00001 // Use a minimal price to avoid filtering out transactions
      console.log(`[TX-ANALYSIS] ⚠️ Using fallback price: $${currentPrice}`)
    }

    const usdAmount = tradeAmount * currentPrice

    if (usdAmount < 0.0001) {
      console.log(`[TX-ANALYSIS] ❌ USD amount too small: $${usdAmount.toFixed(8)}`)
      return null
    }

    console.log(
      `[TX-ANALYSIS] 🎯 FINAL CLASSIFICATION: ${transactionType.toUpperCase()} - $${usdAmount.toFixed(6)} (${tradeAmount.toFixed(6)} tokens at $${currentPrice.toFixed(8)})`,
    )

    return {
      signature: txData.signatures?.[0] || "unknown",
      type: transactionType,
      tokenAmount: tradeAmount,
      usdAmount,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error(`[TX-ANALYSIS] ❌ Error analyzing transaction:`, error)
    return null
  }
}

async function collectDexToolsData() {
  if (!autoSellState.config) {
    console.error("[DEXTOOLS] Error: autoSellState.config is null")
    return false
  }

  try {
    console.log(`[DEXTOOLS] 🚀 PREMIUM API - Starting transaction collection...`)

    const timeWindowSeconds = autoSellState.config.timeWindowSeconds || 30
    const endTime = Math.floor(Date.now() / 1000)
    const startTime = endTime - timeWindowSeconds

    console.log(`[DEXTOOLS] Time window: ${startTime} to ${endTime} (${timeWindowSeconds}s)`)

    const dextoolsApiKey = process.env.DEXTOOLS_API_KEY
    if (!dextoolsApiKey) {
      throw new Error("DEXTOOLS_API_KEY not configured")
    }

    const url = `https://public-api.dextools.io/standard/v2/token/solana/${autoSellState.config.mint}/transactions?limit=100&sort=desc`

    console.log(`[DEXTOOLS] Fetching from: ${url}`)

    const response = await Promise.race([
      fetch(url, {
        method: "GET",
        headers: {
          "X-API-Key": dextoolsApiKey,
          Accept: "application/json",
          "User-Agent": "AutoSellBot/3.0",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DexTools API timeout")), 15000)),
    ])

    if (!response.ok) {
      throw new Error(`DexTools API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    console.log(`[DEXTOOLS] API Response status: ${response.status}`)

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid DexTools API response format")
    }

    console.log(`[DEXTOOLS] Found ${data.data.length} total transactions`)

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const tx of data.data) {
      try {
        const txTime = new Date(tx.timeStamp).getTime() / 1000

        // Only process transactions within our time window
        if (txTime < startTime) {
          continue
        }

        const usdAmount = Number.parseFloat(tx.amountUSD || tx.amount_usd || "0")
        const tokenAmount = Number.parseFloat(tx.tokenAmount || tx.token_amount || "0")

        if (usdAmount < 0.0001) {
          continue // Skip tiny transactions
        }

        // Use bulletproof classifier
        const finalType = bulletproofTransactionClassifier.classifyTransaction(
          tx.type || "unknown",
          tokenAmount,
          usdAmount,
          "DexTools",
        )

        if (finalType === "buy") {
          totalBuyVolumeUsd += usdAmount
          buyCount++
          console.log(`[DEXTOOLS] ✅ BUY: $${usdAmount.toFixed(4)} (${tokenAmount.toFixed(2)} tokens)`)
        } else if (finalType === "sell") {
          totalSellVolumeUsd += usdAmount
          sellCount++
          console.log(`[DEXTOOLS] ✅ SELL: $${usdAmount.toFixed(4)} (${tokenAmount.toFixed(2)} tokens)`)
        }
      } catch (txError) {
        console.error(`[DEXTOOLS] Error processing transaction:`, txError)
        continue
      }
    }

    // DIRECT ASSIGNMENT - NO SWAPPING
    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd
    autoSellState.metrics.buyTransactionCount = buyCount
    autoSellState.metrics.sellTransactionCount = sellCount
    autoSellState.metrics.dataSourceConfidence = 95 // High confidence for premium API

    console.log(`[DEXTOOLS] 🎯 BULLETPROOF RESULTS:`)
    console.log(`[DEXTOOLS] 📈 BUY VOLUME: $${totalBuyVolumeUsd.toFixed(4)} (${buyCount} transactions)`)
    console.log(`[DEXTOOLS] 📉 SELL VOLUME: $${totalSellVolumeUsd.toFixed(4)} (${sellCount} transactions)`)
    console.log(`[DEXTOOLS] 💰 NET FLOW: $${autoSellState.metrics.netUsdFlow.toFixed(4)}`)
    console.log(`[DEXTOOLS] 🎯 CONFIDENCE: ${autoSellState.metrics.dataSourceConfidence}%`)

    return totalBuyVolumeUsd > 0 || totalSellVolumeUsd > 0
  } catch (error) {
    console.error("[DEXTOOLS] ❌ Error:", error)
    return false
  }
}

async function collectDexScreenerData() {
  if (!autoSellState.config) {
    console.error("[DEXSCREENER] Error: autoSellState.config is null")
    return false
  }

  try {
    console.log(`[DEXSCREENER] 🔄 FALLBACK API - Starting transaction collection...`)

    const timeWindowSeconds = autoSellState.config.timeWindowSeconds || 30
    const endTime = Math.floor(Date.now() / 1000)
    const startTime = endTime - timeWindowSeconds

    const url = `https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`

    const response = await Promise.race([
      fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "AutoSellBot/3.0",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DexScreener API timeout")), 10000)),
    ])

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.pairs || data.pairs.length === 0) {
      throw new Error("No trading pairs found")
    }

    // Get the most liquid pair
    const pair = data.pairs.reduce((best: any, current: any) =>
      (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best,
    )

    console.log(`[DEXSCREENER] Using pair: ${pair.baseToken.symbol}/${pair.quoteToken.symbol}`)

    // Get recent transactions for this pair
    const txUrl = `https://api.dexscreener.com/latest/dex/pairs/solana/${pair.pairAddress}/transactions`

    const txResponse = await Promise.race([
      fetch(txUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "AutoSellBot/3.0",
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DexScreener transactions timeout")), 10000)),
    ])

    if (!txResponse.ok) {
      throw new Error(`DexScreener transactions API error: ${txResponse.status}`)
    }

    const txData = await txResponse.json()

    if (!txData.transactions || !Array.isArray(txData.transactions)) {
      throw new Error("No transactions data available")
    }

    console.log(`[DEXSCREENER] Found ${txData.transactions.length} transactions`)

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const tx of txData.transactions) {
      try {
        const txTime = tx.timestamp || Date.now() / 1000

        if (txTime < startTime) {
          continue
        }

        const usdAmount = Number.parseFloat(tx.amountUSD || tx.amount_usd || "0")
        const tokenAmount = Number.parseFloat(tx.tokenAmount || tx.token_amount || "0")

        if (usdAmount < 0.0001) {
          continue
        }

        // Use bulletproof classifier
        const finalType = bulletproofTransactionClassifier.classifyTransaction(
          tx.type || "unknown",
          tokenAmount,
          usdAmount,
          "DexScreener",
        )

        if (finalType === "buy") {
          totalBuyVolumeUsd += usdAmount
          buyCount++
          console.log(`[DEXSCREENER] ✅ BUY: $${usdAmount.toFixed(4)}`)
        } else if (finalType === "sell") {
          totalSellVolumeUsd += usdAmount
          sellCount++
          console.log(`[DEXSCREENER] ✅ SELL: $${usdAmount.toFixed(4)}`)
        }
      } catch (txError) {
        console.error(`[DEXSCREENER] Error processing transaction:`, txError)
        continue
      }
    }

    // DIRECT ASSIGNMENT - NO SWAPPING
    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd
    autoSellState.metrics.buyTransactionCount = buyCount
    autoSellState.metrics.sellTransactionCount = sellCount
    autoSellState.metrics.dataSourceConfidence = 70 // Lower confidence for fallback API

    console.log(`[DEXSCREENER] 🎯 BULLETPROOF RESULTS:`)
    console.log(`[DEXSCREENER] 📈 BUY VOLUME: $${totalBuyVolumeUsd.toFixed(4)} (${buyCount} transactions)`)
    console.log(`[DEXSCREENER] 📉 SELL VOLUME: $${totalSellVolumeUsd.toFixed(4)} (${sellCount} transactions)`)
    console.log(`[DEXSCREENER] 💰 NET FLOW: $${autoSellState.metrics.netUsdFlow.toFixed(4)}`)

    return totalBuyVolumeUsd > 0 || totalSellVolumeUsd > 0
  } catch (error) {
    console.error("[DEXSCREENER] ❌ Error:", error)
    return false
  }
}

async function collectBitqueryEAPData() {
  if (!autoSellState.config) {
    console.error("[BITQUERY-EAP] Error: autoSellState.config is null")
    return
  }

  try {
    const timeWindowSeconds = autoSellState.config.timeWindowSeconds
    const mint = autoSellState.config.mint

    console.log(`[BITQUERY-EAP] 🔍 Fetching real-time DEX data for ${mint}`)
    console.log(`[BITQUERY-EAP] Time window: ${timeWindowSeconds} seconds`)

    const response = await fetch(`/api/eap?mints=${encodeURIComponent(mint)}&seconds=${timeWindowSeconds}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`EAP API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    console.log(`[BITQUERY-EAP] Raw response:`, JSON.stringify(data, null, 2))

    if (data && typeof data === "object") {
      const buyVolumeUsd = Number(data.buyers_usd || 0)
      const sellVolumeUsd = Number(data.sellers_usd || 0)
      const buyCount = Number(data.buyers_count || 0)
      const sellCount = Number(data.sellers_count || 0)

      console.log(`[BITQUERY-EAP] 📊 PARSED DATA:`)
      console.log(`[BITQUERY-EAP] - Buy Volume: $${buyVolumeUsd.toFixed(4)} (${buyCount} transactions)`)
      console.log(`[BITQUERY-EAP] - Sell Volume: $${sellVolumeUsd.toFixed(4)} (${sellCount} transactions)`)
      console.log(`[BITQUERY-EAP] - Net Flow: $${(buyVolumeUsd - sellVolumeUsd).toFixed(4)}`)

      autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
      autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
      autoSellState.metrics.netUsdFlow = buyVolumeUsd - sellVolumeUsd

      console.log(`[BITQUERY-EAP] ✅ Successfully updated metrics with real transaction data`)
    } else {
      console.log(`[BITQUERY-EAP] ⚠️ Invalid response format:`, data)
      throw new Error("Invalid response format from EAP API")
    }
  } catch (error) {
    console.error(`[BITQUERY-EAP] Data collection failed:`, error)
    throw error
  }
}

async function safeFetch(url: string, options: any = {}) {
  try {
    const response = await fetch(url, options)
    return response
  } catch (error: any) {
    console.error(`[FETCH] ❌ Failed to fetch ${url}: ${error.message}`)
    return undefined
  }
}

async function initializeMoralisStream() {
  if (!autoSellState.config?.mint) return

  try {
    console.log("[MORALIS] 🚀 Initializing real-time transaction stream...")

    const streamConfig = {
      chains: ["solana"],
      description: `Auto-sell monitoring for ${autoSellState.config.mint}`,
      tag: "auto-sell-monitor",
      includeContractLogs: true,
      includeInternalTxs: true,
      webhookUrl: `${process.env.NEXT_PUBLIC_API_BASE || "https://your-domain.com"}/api/webhooks/moralis`,
      triggers: [
        {
          type: "tx",
          contractAddress: autoSellState.config.mint,
          functionAbi: {
            type: "function",
            name: "transfer",
          },
        },
      ],
    }

    const response = await fetch("https://api.moralis-streams.com/streams/evm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PREMIUM_APIS.moralis.token,
      },
      body: JSON.stringify(streamConfig),
    })

    if (response.ok) {
      const streamData = await response.json()
      autoSellState.moralisStream = streamData
      console.log("[MORALIS] ✅ Real-time stream initialized successfully")
    }
  } catch (error) {
    console.error("[MORALIS] ❌ Failed to initialize stream:", error)
  }
}

async function initializeChainStackWebSocket() {
  if (!autoSellState.config?.mint) return

  try {
    console.log("[CHAINSTACK] 🚀 Connecting to WebSocket for real-time updates...")

    const WebSocket = require("ws")
    const ws = new WebSocket(PREMIUM_APIS.chainstack.wss)

    ws.on("open", () => {
      console.log("[CHAINSTACK] ✅ WebSocket connected")

      // Subscribe to account changes for the token mint
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "accountSubscribe",
          params: [
            autoSellState.config.mint,
            {
              encoding: "jsonParsed",
              commitment: "finalized",
            },
          ],
        }),
      )
    })

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString())
        if (message.method === "accountNotification") {
          console.log("[CHAINSTACK] 📡 Real-time account update received")
          handleRealTimeTransaction(message.params.result)
        }
      } catch (error) {
        console.error("[CHAINSTACK] ❌ Error processing WebSocket message:", error)
      }
    })

    autoSellState.chainstackWs = ws
  } catch (error) {
    console.error("[CHAINSTACK] ❌ Failed to initialize WebSocket:", error)
  }
}

async function processAlchemySignatures(signatures: any[], endpoint: string) {
  if (!autoSellState.config) {
    console.error("[ALCHEMY] Error: autoSellState.config is null")
    return
  }

  const { Connection } = await import("@solana/web3.js")

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    { commitment: "confirmed" },
  )

  const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
  const currentTime = Date.now()
  const windowStartTime = currentTime - timeWindowMs

  console.log(`[ALCHEMY] 🔍 Processing ${signatures.length} signatures from ${endpoint.slice(-10)}...`)

  let totalBuyVolumeUsd = 0
  let totalSellVolumeUsd = 0
  let buyCount = 0
  let sellCount = 0
  let analyzedCount = 0
  let filteredCount = 0
  const processedTransactions = []

  for (const sigInfo of signatures) {
    const txTime = (sigInfo.blockTime || 0) * 1000

    // Filter signatures by time window
    if (txTime >= windowStartTime) {
      try {
        console.log(`[ALCHEMY] 🔍 Fetching transaction ${sigInfo.signature.substring(0, 8)}...`)

        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })

        if (!tx || !tx.meta) {
          console.log(`[ALCHEMY] ❌ No transaction data for ${sigInfo.signature.substring(0, 8)}`)
          continue
        }

        console.log(`[ALCHEMY] ✅ Transaction data retrieved for ${sigInfo.signature.substring(0, 8)}`)
        analyzedCount++

        const tradeInfo = analyzeTokenMintTransaction(tx, autoSellState.config.mint)

        if (tradeInfo) {
          processedTransactions.push({
            signature: tradeInfo.signature,
            type: tradeInfo.type,
            usdAmount: tradeInfo.usdAmount,
            timestamp: txTime,
          })

          if (tradeInfo.type === "buy") {
            totalBuyVolumeUsd += tradeInfo.usdAmount
            buyCount++
            console.log(
              `[ALCHEMY] ✅ BUY DETECTED: $${tradeInfo.usdAmount.toFixed(4)} | ${tradeInfo.tokenAmount.toFixed(4)} tokens`,
            )
          } else if (tradeInfo.type === "sell") {
            totalSellVolumeUsd += tradeInfo.usdAmount
            sellCount++
            console.log(
              `[ALCHEMY] ❌ SELL DETECTED: $${tradeInfo.usdAmount.toFixed(4)} | ${tradeInfo.tokenAmount.toFixed(4)} tokens`,
            )
          }
        } else {
          filteredCount++
          console.log(`[ALCHEMY] ⚪ Transaction ${sigInfo.signature.substring(0, 8)} - NO TRADE DETECTED`)
        }
      } catch (txError) {
        console.log(`[ALCHEMY] ❌ Error analyzing transaction ${sigInfo.signature.substring(0, 8)}: ${txError.message}`)
        continue
      }
    }
  }

  autoSellState.marketTrades = processedTransactions
  autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
  autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
  autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

  console.log(`[ALCHEMY] 📊 FINAL RESULTS:`)
  console.log(`[ALCHEMY] - Analyzed: ${analyzedCount}`)
  console.log(`[ALCHEMY] - Filtered out: ${filteredCount}`)
  console.log(`[ALCHEMY] - Buy transactions: ${buyCount} ($${totalBuyVolumeUsd.toFixed(4)})`)
  console.log(`[ALCHEMY] - Sell transactions: ${sellCount} ($${totalSellVolumeUsd.toFixed(4)})`)
  console.log(`[ALCHEMY] - Net Flow: $${(totalBuyVolumeUsd - totalSellVolumeUsd).toFixed(4)}`)
}

function extractTransactionInfo(transactionData: any) {
  try {
    // Extract relevant information from the transaction data
    const type = transactionData.type || "unknown"
    const usdAmount = Number(transactionData.amountUSD || 0)

    return {
      type: type,
      usdAmount: usdAmount,
    }
  } catch (error) {
    console.error("[REALTIME] ❌ Error extracting transaction info:", error)
    return null
  }
}
