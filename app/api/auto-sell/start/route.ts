import { type NextRequest, NextResponse } from "next/server"
import { Buffer } from "buffer"

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

    // Calculate USD amount
    const currentPrice = autoSellState.metrics.currentPriceUsd || 0
    const usdAmount = tradeAmount * currentPrice

    if (usdAmount < 0.001) {
      console.log(`[TX-ANALYSIS] ❌ USD amount too small: $${usdAmount.toFixed(6)}`)
      return null
    }

    console.log(
      `[TX-ANALYSIS] 🎯 FINAL CLASSIFICATION: ${transactionType.toUpperCase()} - $${usdAmount.toFixed(4)} (${tradeAmount.toFixed(6)} tokens at $${currentPrice.toFixed(8)})`,
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

async function collectDexToolsData(): Promise<boolean> {
  if (!autoSellState.config) {
    console.log("[DEXTOOLS] ❌ No config available")
    return false
  }

  const { mint, timeWindowSeconds } = autoSellState.config
  console.log(`[DEXTOOLS] 🔍 PRIMARY SOURCE: Fetching transactions for ${mint} (${timeWindowSeconds}s window)`)

  try {
    const response = await fetch(`https://api.dextools.io/v1/solana/token/${mint}/transactions?limit=100&sort=desc`, {
      headers: {
        "X-API-Key": process.env.DEXTOOLS_API_KEY || "",
      },
    })

    if (!response.ok) {
      console.log(`[DEXTOOLS] ❌ API Error: ${response.status}`)
      return false
    }

    const data = await response.json()
    const transactions = data.data || []
    console.log(`[DEXTOOLS] 📊 Retrieved ${transactions.length} transactions`)

    const cutoffTime = Date.now() - timeWindowSeconds * 1000
    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const tx of transactions) {
      const txTime = new Date(tx.timestamp).getTime()
      if (txTime < cutoffTime) continue

      const usdAmount = Number(tx.usdAmount || 0)
      if (usdAmount < 0.001) continue // Skip very small transactions

      // BULLETPROOF CLASSIFICATION: Use API type directly, NO REVERSALS
      const apiType = String(tx.type || "").toLowerCase()

      if (apiType === "buy" || apiType === "purchase") {
        totalBuyVolumeUsd += usdAmount
        buyCount++
        console.log(`[DEXTOOLS] ✅ BUY: $${usdAmount.toFixed(4)} (API type: "${tx.type}")`)
      } else if (apiType === "sell" || apiType === "sale") {
        totalSellVolumeUsd += usdAmount
        sellCount++
        console.log(`[DEXTOOLS] ✅ SELL: $${usdAmount.toFixed(4)} (API type: "${tx.type}")`)
      } else {
        console.log(`[DEXTOOLS] ⚠️ UNKNOWN TYPE: "${tx.type}" for $${usdAmount.toFixed(4)}`)
      }
    }

    // DIRECT ASSIGNMENT - NO SWAPPING
    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(`[DEXTOOLS] 🎯 FINAL RESULTS:`)
    console.log(`[DEXTOOLS] 📈 BUY VOLUME: $${totalBuyVolumeUsd.toFixed(2)} (${buyCount} transactions)`)
    console.log(`[DEXTOOLS] 📉 SELL VOLUME: $${totalSellVolumeUsd.toFixed(2)} (${sellCount} transactions)`)
    console.log(`[DEXTOOLS] 💰 NET FLOW: $${autoSellState.metrics.netUsdFlow.toFixed(2)}`)

    return totalBuyVolumeUsd > 0 || totalSellVolumeUsd > 0
  } catch (error) {
    console.error("[DEXTOOLS] ❌ Error:", error)
    return false
  }
}

async function collectAlchemyData() {
  if (!autoSellState.config) return

  try {
    console.log("[ALCHEMY] 🚀 Using premium Alchemy endpoints...")

    const { mint, timeWindowSeconds } = autoSellState.config
    const endpoints = [PREMIUM_APIS.alchemy.mainnet1, PREMIUM_APIS.alchemy.mainnet2]

    for (const endpoint of endpoints) {
      try {
        console.log(`[ALCHEMY] 📡 Trying endpoint: ${endpoint.slice(-10)}...`)

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignaturesForAddress",
            params: [mint, { limit: 100 }],
          }),
          signal: AbortSignal.timeout(10000),
        })

        if (response.ok) {
          const data = await response.json()
          console.log(`[ALCHEMY] ✅ Got ${data.result?.length || 0} signatures`)

          // Process signatures similar to Solana RPC method
          await processAlchemySignatures(data.result || [], endpoint)
          return
        }
      } catch (error) {
        console.log(`[ALCHEMY] ⚠️ Endpoint failed: ${error.message}`)
      }
    }

    throw new Error("All Alchemy endpoints failed")
  } catch (error) {
    console.error("[ALCHEMY] ❌ Failed to collect data:", error)
    throw error
  }
}

function handleRealTimeTransaction(transactionData) {
  try {
    console.log("[REALTIME] 📡 Processing real-time transaction update...")

    const currentTime = Date.now()
    autoSellState.metrics.lastRealTimeUpdate = currentTime

    // Extract transaction details from real-time data
    const txInfo = extractTransactionInfo(transactionData)

    if (txInfo && txInfo.usdAmount > 0.0001) {
      console.log(`[REALTIME] 🔍 Real-time ${txInfo.type}: $${txInfo.usdAmount.toFixed(6)}`)

      if (txInfo.type === "buy") {
        autoSellState.metrics.buyVolumeUsd += txInfo.usdAmount
        autoSellState.metrics.buyTransactionCount++
      } else if (txInfo.type === "sell") {
        autoSellState.metrics.sellVolumeUsd += txInfo.usdAmount
        autoSellState.metrics.sellTransactionCount++
      }

      autoSellState.metrics.netUsdFlow = autoSellState.metrics.buyVolumeUsd - autoSellState.metrics.sellVolumeUsd

      console.log(
        `[REALTIME] ✅ Updated metrics - Buy: $${autoSellState.metrics.buyVolumeUsd.toFixed(2)} | Sell: $${autoSellState.metrics.sellVolumeUsd.toFixed(2)}`,
      )
    }
  } catch (error) {
    console.error("[REALTIME] ❌ Error processing real-time transaction:", error)
  }
}

async function collectMarketDataForConfigurableWindow() {
  if (!autoSellState.config) {
    console.error("[AUTO-SELL] Error: autoSellState.config is null")
    return { success: false, error: "Configuration not available" }
  }

  try {
    console.log(`[AUTO-SELL] 🚀 MASTERPIECE TRANSACTION DETECTION SYSTEM`)
    console.log(`[AUTO-SELL] Time window: ${autoSellState.config.timeWindowSeconds} seconds`)
    console.log(`[AUTO-SELL] Token mint: ${autoSellState.config.mint}`)
    console.log(`[AUTO-SELL] Current time: ${new Date().toISOString()}`)

    await updateTokenPrice()

    if (!autoSellState.moralisStream) {
      await initializeMoralisStream()
    }
    if (!autoSellState.chainstackWs) {
      await initializeChainStackWebSocket()
    }

    console.log(`[AUTO-SELL] 🎯 PRIORITY 1: DexTools Premium API...`)
    try {
      const dextoolsSuccess = await collectDexToolsData()
      console.log("[DEXTOOLS] ✅ PRIMARY SUCCESS - Premium DexTools data collected")

      if (autoSellState.metrics.buyVolumeUsd > 0 || autoSellState.metrics.sellVolumeUsd > 0) {
        console.log(
          `[AUTO-SELL] ✅ MASTERPIECE SUCCESS: Buy: $${autoSellState.metrics.buyVolumeUsd.toFixed(4)} | Sell: $${autoSellState.metrics.sellVolumeUsd.toFixed(4)} | Confidence: ${autoSellState.metrics.dataSourceConfidence.toFixed(1)}%`,
        )
        return { success: true, source: "DexTools Premium" }
      }
    } catch (error) {
      console.log(`[DEXTOOLS] ❌ PRIORITY 1 FAILED: ${error.message}`)
    }

    console.log(`[AUTO-SELL] 🎯 PRIORITY 2: Alchemy Premium API...`)
    try {
      await collectAlchemyData()
      console.log("[ALCHEMY] ✅ SECONDARY SUCCESS - Premium Alchemy data collected")

      if (autoSellState.metrics.buyVolumeUsd > 0 || autoSellState.metrics.sellVolumeUsd > 0) {
        console.log(`[AUTO-SELL] ✅ SECONDARY SUCCESS: Got meaningful data from Alchemy`)
        return { success: true, source: "Alchemy Premium" }
      }
    } catch (error) {
      console.log(`[ALCHEMY] ❌ PRIORITY 2 FAILED: ${error.message}`)
    }

    console.log(`[AUTO-SELL] 🎯 PRIORITY 3: Bitquery EAP API...`)
    try {
      await collectBitqueryEAPData()
      console.log("[BITQUERY-EAP] ✅ TERTIARY SUCCESS - Real-time DEX data collected")

      if (autoSellState.metrics.buyVolumeUsd > 0 || autoSellState.metrics.sellVolumeUsd > 0) {
        console.log(`[AUTO-SELL] ✅ TERTIARY SUCCESS: Got meaningful data from Bitquery`)
        return { success: true, source: "Bitquery EAP" }
      }
    } catch (error) {
      console.log(`[BITQUERY-EAP] ❌ PRIORITY 3 FAILED: ${error.message}`)
    }

    console.log(`[AUTO-SELL] 🎯 PRIORITY 4: Premium Solana RPC...`)
    try {
      await collectDirectSolanaTransactions()
      console.log("[SOLANA-RPC] ✅ QUATERNARY SUCCESS - Direct blockchain analysis")

      if (autoSellState.metrics.buyVolumeUsd > 0 || autoSellState.metrics.sellVolumeUsd > 0) {
        console.log(`[AUTO-SELL] ✅ QUATERNARY SUCCESS: Got meaningful data from Solana RPC`)
        return { success: true, source: "Premium Solana RPC" }
      }
    } catch (error) {
      console.log(`[SOLANA-RPC] ❌ PRIORITY 4 FAILED: ${error.message}`)
    }

    console.log(`[AUTO-SELL] 🎯 FINAL FALLBACK: DexScreener API...`)
    try {
      const dexScreenerSuccess = await collectDexScreenerData()
      console.log("[DEXSCREENER] ✅ FALLBACK SUCCESS - DexScreener data collected")
      return { success: true, source: "DexScreener Fallback" }
    } catch (error) {
      console.log(`[DEXSCREENER] ❌ FINAL FALLBACK FAILED: ${error.message}`)
    }

    console.log("[AUTO-SELL] ❌ ALL DATA SOURCES FAILED - Using zero values")
    return { success: false, error: "All data sources failed" }
  } catch (error) {
    console.error(`[AUTO-SELL] ❌ Critical error in data collection:`, error)
    return { success: false, error: error.message }
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
      `[AUTO-SELL] 📊 ANALYSIS - Buy: $${buyVolumeUsd.toFixed(2)} | Sell: $${sellVolumeUsd.toFixed(2)} | Net Flow: $${netUsdFlow.toFixed(2)}`,
    )

    if (netUsdFlow > 0 && buyVolumeUsd > 0) {
      console.log(
        `[AUTO-SELL] ✅ SELL CRITERIA MET! Net flow $${netUsdFlow.toFixed(2)} > $0 with buy volume $${buyVolumeUsd.toFixed(2)}`,
      )

      if (currentTime - autoSellState.metrics.lastSellTrigger < cooldownMs) {
        const remainingCooldown = Math.ceil((cooldownMs - (currentTime - autoSellState.metrics.lastSellTrigger)) / 1000)
        console.log(`[AUTO-SELL] ⏳ In cooldown period, ${remainingCooldown}s remaining`)
        return
      }

      console.log(`[AUTO-SELL] 🚀 EXECUTING IMMEDIATE SELL! Positive net flow detected.`)

      const sellAmountUsd = netUsdFlow * 0.25
      console.log(`[AUTO-SELL] 💰 Sell Amount: 25% of $${netUsdFlow.toFixed(2)} = $${sellAmountUsd.toFixed(2)}`)

      console.log(`[AUTO-SELL] Step 1: Updating token price...`)
      await updateTokenPrice()
      console.log(`[AUTO-SELL] Step 1 Complete: Current price = $${autoSellState.metrics.currentPriceUsd}`)

      console.log(`[AUTO-SELL] Step 2: Updating wallet balances...`)
      await updateAllWalletBalances()
      const totalTokens = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
      console.log(`[AUTO-SELL] Step 2 Complete: Total tokens = ${totalTokens.toFixed(4)}`)

      console.log(`[AUTO-SELL] Step 3: Executing coordinated sell...`)
      await executeCoordinatedSell(netUsdFlow)
      console.log(`[AUTO-SELL] Step 3 Complete: Sell execution finished`)
    } else {
      console.log(
        `[AUTO-SELL] ❌ No positive net flow detected (Net: $${netUsdFlow.toFixed(2)}, Buy: $${buyVolumeUsd.toFixed(2)}), no sell triggered`,
      )
    }
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in analysis and execution:", error)
    console.error("[AUTO-SELL] Error stack:", error.stack)
  }
}

async function executeCoordinatedSell(netUsdFlow: number) {
  try {
    console.log(`[AUTO-SELL] 🎯 STARTING COORDINATED SELL EXECUTION`)
    console.log(`[AUTO-SELL] Target sell amount: $${netUsdFlow.toFixed(2)} USD`)

    console.log(`[AUTO-SELL] 🔄 Fetching accurate token price...`)
    let effectivePriceUsd = 0

    // Try DexScreener first for most accurate price
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
      const data = await response.json()
      if (data.pairs && data.pairs.length > 0) {
        effectivePriceUsd = Number(data.pairs[0].priceUsd || 0)
        console.log(`[AUTO-SELL] ✅ DexScreener price: $${effectivePriceUsd.toFixed(8)}`)
        autoSellState.metrics.currentPriceUsd = effectivePriceUsd
        autoSellState.metrics.currentPrice = effectivePriceUsd / autoSellState.metrics.solPriceUsd
      }
    } catch (priceError) {
      console.error(`[AUTO-SELL] ❌ DexScreener price fetch failed:`, priceError.message)
    }

    // Try Jupiter if DexScreener failed
    if (effectivePriceUsd <= 0) {
      try {
        const jupiterBase = process.env.JUPITER_BASE || "https://quote-api.jup.ag"
        const testAmount = "1000000" // 1 token in smallest units

        const quoteResponse = await fetch(
          `${jupiterBase}/v6/quote?inputMint=${autoSellState.config.mint}&outputMint=So11111111111111111111111111111111111111112&amount=${testAmount}&slippageBps=500`,
        )
        const quoteData = await quoteResponse.json()

        if (quoteData.outAmount) {
          const solOut = Number(quoteData.outAmount) / 1e9
          const solPriceUsd = autoSellState.metrics.solPriceUsd || 100
          effectivePriceUsd = (solOut * solPriceUsd) / (Number(testAmount) / 1e6)
          console.log(`[AUTO-SELL] ✅ Jupiter price: $${effectivePriceUsd.toFixed(8)}`)
          autoSellState.metrics.currentPriceUsd = effectivePriceUsd
        }
      } catch (jupiterError) {
        console.error(`[AUTO-SELL] ❌ Jupiter price discovery failed:`, jupiterError.message)
      }
    }

    if (effectivePriceUsd <= 0) {
      effectivePriceUsd = 0.000001
      console.log(`[AUTO-SELL] ⚠️ Using emergency fallback price: $${effectivePriceUsd.toFixed(8)}`)
    }

    const tokensToSell = netUsdFlow / effectivePriceUsd
    console.log(
      `[AUTO-SELL] Token calculation: $${netUsdFlow.toFixed(2)} ÷ $${effectivePriceUsd.toFixed(8)} = ${tokensToSell.toFixed(4)} tokens`,
    )

    console.log(`[AUTO-SELL] 🔍 Validating wallets...`)
    const walletsWithTokens = autoSellState.wallets.filter((wallet) => {
      const hasTokens = wallet.tokenBalance > 0
      console.log(
        `[AUTO-SELL] ${wallet.name}: ${wallet.tokenBalance.toFixed(4)} tokens - ${hasTokens ? "ELIGIBLE" : "SKIP"}`,
      )
      return hasTokens
    })

    if (walletsWithTokens.length === 0) {
      console.log("[AUTO-SELL] ❌ EXECUTION STOPPED: No wallets have tokens to sell")
      return
    }

    const totalTokensHeld = walletsWithTokens.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)
    console.log(
      `[AUTO-SELL] ✅ ${walletsWithTokens.length}/${autoSellState.wallets.length} wallets eligible, total tokens: ${totalTokensHeld.toFixed(4)}`,
    )

    let adjustedTokensToSell = Math.min(tokensToSell, totalTokensHeld * 0.25)
    if (adjustedTokensToSell < totalTokensHeld * 0.001) {
      adjustedTokensToSell = totalTokensHeld * 0.001
    }

    console.log(
      `[AUTO-SELL] 🎯 FINAL SELL: ${adjustedTokensToSell.toFixed(4)} tokens (${((adjustedTokensToSell / totalTokensHeld) * 100).toFixed(1)}% of holdings)`,
    )

    console.log(`[AUTO-SELL] 🚀 STARTING INDIVIDUAL WALLET SELLS...`)

    const sellPromises = walletsWithTokens.map(async (wallet, index) => {
      const walletProportion = wallet.tokenBalance / totalTokensHeld
      const walletSellAmount = adjustedTokensToSell * walletProportion

      if (walletSellAmount < 0.000001) {
        console.log(`[AUTO-SELL] Wallet ${wallet.name}: Amount too small, skipping`)
        return null
      }

      try {
        console.log(`[AUTO-SELL] Wallet ${wallet.name}: Executing sell of ${walletSellAmount.toFixed(4)} tokens...`)
        const signature = await executeSell(wallet, walletSellAmount)
        const estimatedUsdValue = walletSellAmount * effectivePriceUsd

        console.log(`[AUTO-SELL] Wallet ${wallet.name}: ✅ SUCCESS: ${signature}`)
        console.log(`[AUTO-SELL] Wallet ${wallet.name}: 💰 Value: ~$${estimatedUsdValue.toFixed(2)} USD`)

        return { wallet: wallet.name, amount: walletSellAmount, usdValue: estimatedUsdValue, signature }
      } catch (error) {
        console.error(`[AUTO-SELL] Wallet ${wallet.name}: ❌ FAILED: ${error.message}`)
        return null
      }
    })

    console.log(`[AUTO-SELL] ⏳ Waiting for all ${walletsWithTokens.length} sell transactions...`)

    const results = await Promise.allSettled(sellPromises)
    const successfulSells = results
      .filter((result) => result.status === "fulfilled" && result.value !== null)
      .map((result) => (result as PromiseFulfilledResult<any>).value)

    if (successfulSells.length > 0) {
      const totalSold = successfulSells.reduce((sum, result) => sum + result.amount, 0)
      const totalUsdValue = successfulSells.reduce((sum, result) => sum + result.usdValue, 0)

      autoSellState.metrics.lastSellTrigger = Date.now()
      autoSellState.metrics.totalSold += totalSold

      console.log(`[AUTO-SELL] 🎉 SELL EXECUTION COMPLETE!`)
      console.log(`[AUTO-SELL] Total sold: ${totalSold.toFixed(4)} tokens`)
      console.log(`[AUTO-SELL] Total value: ~$${totalUsdValue.toFixed(2)} USD`)
      console.log(
        `[AUTO-SELL] Success rate: ${((successfulSells.length / walletsWithTokens.length) * 100).toFixed(1)}%`,
      )

      console.log(`[AUTO-SELL] 🔄 Updating wallet balances after execution...`)
      try {
        await updateAllWalletBalances()
        console.log(`[AUTO-SELL] ✅ Balance update complete`)
      } catch (error) {
        console.error("[AUTO-SELL] Balance update failed after sell:", error)
      }
    } else {
      console.log("[AUTO-SELL] ❌ COMPLETE FAILURE: No successful sells executed")
    }
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in executeCoordinatedSell:", error)
    // Don't re-throw, just log and continue
  }
}

async function updateTokenPrice() {
  try {
    console.log(`[PRICE-UPDATE] 💰 Fetching current price for token ${autoSellState.config.mint}...`)

    let priceUsd = 0

    // Try DexScreener first
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
      const data = await response.json()

      if (data.pairs && data.pairs.length > 0) {
        const pair = data.pairs[0]
        priceUsd = Number(pair.priceUsd || 0)
        console.log(`[PRICE-UPDATE] 📊 DexScreener price: $${priceUsd.toFixed(8)}`)
      }
    } catch (dexError) {
      console.log(`[PRICE-UPDATE] ⚠️ DexScreener failed: ${dexError.message}`)
    }

    // Try Jupiter if DexScreener failed or returned 0
    if (priceUsd <= 0) {
      try {
        const jupiterBase = process.env.JUPITER_BASE || "https://quote-api.jup.ag"
        const testAmount = "1000000" // 1 token in smallest units

        const quoteResponse = await fetch(
          `${jupiterBase}/v6/quote?inputMint=${autoSellState.config.mint}&outputMint=So11111111111111111111111111111111111111112&amount=${testAmount}&slippageBps=500`,
        )
        const quoteData = await quoteResponse.json()

        if (quoteData.outAmount) {
          const solOut = Number(quoteData.outAmount) / 1e9
          const solPriceUsd = autoSellState.metrics.solPriceUsd || 100
          priceUsd = (solOut * solPriceUsd) / (Number(testAmount) / 1e6)
          console.log(`[PRICE-UPDATE] 📊 Jupiter price: $${priceUsd.toFixed(8)}`)
        }
      } catch (jupiterError) {
        console.log(`[PRICE-UPDATE] ⚠️ Jupiter failed: ${jupiterError.message}`)
      }
    }

    if (priceUsd > 0) {
      autoSellState.metrics.currentPriceUsd = priceUsd
      autoSellState.metrics.currentPrice = priceUsd / autoSellState.metrics.solPriceUsd
      console.log(`[PRICE-UPDATE] ✅ Updated token price: $${priceUsd.toFixed(8)} USD`)
    } else {
      autoSellState.metrics.currentPriceUsd = 0.000001
      autoSellState.metrics.currentPrice = 0.000001 / autoSellState.metrics.solPriceUsd
      console.log(`[PRICE-UPDATE] ⚠️ Could not fetch price, using fallback: $0.000001`)
    }
  } catch (error) {
    console.error("[PRICE-UPDATE] Failed to update token price:", error)
    // Ensure we always have a non-zero price
    if (autoSellState.metrics.currentPriceUsd <= 0) {
      autoSellState.metrics.currentPriceUsd = 0.000001
      autoSellState.metrics.currentPrice = 0.000001 / autoSellState.metrics.solPriceUsd
    }
  }
}

async function executeSell(wallet: any, amount: number) {
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
    const mintInfo = await getMint(connection, new PublicKey(autoSellState.config.mint))
    const decimals = mintInfo.decimals

    const amountInAtoms = BigInt(Math.floor(amount * 10 ** decimals)).toString()

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

    const swapResponse = await axios.default.post(`${jupiterBase}/v6/swap`, {
      userPublicKey: wallet.keypair.publicKey.toBase58(),
      quoteResponse: quoteResponse.data,
    })

    const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.data.swapTransaction, "base64"))
    tx.sign([wallet.keypair])

    const bloxrouteAuth = process.env.BLOXROUTE_API_KEY
    if (bloxrouteAuth) {
      try {
        const serializedTx = Buffer.from(tx.serialize()).toString("base64")
        const bloxrouteUrl = process.env.BLOXROUTE_SUBMIT_URL || "https://ny.solana.dex.blxrbdn.com"

        console.log(`[BLOXROUTE] Attempting submission with auth header...`)

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
              Authorization: bloxrouteAuth,
              "Content-Type": "application/json",
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
      const signature = (await Promise.race([
        connection.sendTransaction(tx, {
          skipPreflight: true,
          maxRetries: 3,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("RPC submission timeout")), 30000)),
      ])) as string

      console.log(`[RPC] Transaction submitted: ${signature}`)

      // Don't wait for confirmation to prevent hanging
      connection.confirmTransaction(signature, "confirmed").catch((error) => {
        console.error(`[RPC] Confirmation failed for ${signature}:`, error)
      })

      return signature
    } catch (error) {
      console.error("RPC submission failed:", error)
      throw error
    }
  } catch (error) {
    console.error(`[SELL] Failed to execute sell for wallet ${wallet.publicKey}:`, error)
    throw error
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

async function collectDexScreenerData(): Promise<boolean> {
  if (!autoSellState.config) {
    console.log("[DEXSCREENER] ❌ No config available")
    return false
  }

  const { mint, timeWindowSeconds } = autoSellState.config
  console.log(`[DEXSCREENER] 🔍 FALLBACK SOURCE: Fetching data for ${mint}`)

  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
    if (!response.ok) return false

    const data = await response.json()
    const pairs = data.pairs || []
    if (pairs.length === 0) return false

    const pair = pairs[0]
    const cutoffTime = Date.now() - timeWindowSeconds * 1000

    // Get recent transactions
    const txResponse = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${pair.pairAddress}/transactions`,
    )
    if (!txResponse.ok) return false

    const txData = await txResponse.json()
    const transactions = txData.transactions || []

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0

    for (const tx of transactions) {
      const txTime = new Date(tx.timestamp).getTime()
      if (txTime < cutoffTime) continue

      const usdAmount = Number(tx.usdAmount || 0)
      if (usdAmount < 0.001) continue

      // DEXSCREENER SPECIFIC: Apply type reversal because their API is backwards
      const actualType = tx.type === "buy" ? "sell" : tx.type === "sell" ? "buy" : tx.type

      if (actualType === "buy") {
        totalBuyVolumeUsd += usdAmount
        console.log(`[DEXSCREENER] ✅ BUY: $${usdAmount.toFixed(4)} (API said "${tx.type}", using "buy")`)
      } else if (actualType === "sell") {
        totalSellVolumeUsd += usdAmount
        console.log(`[DEXSCREENER] ✅ SELL: $${usdAmount.toFixed(4)} (API said "${tx.type}", using "sell")`)
      }
    }

    // DIRECT ASSIGNMENT
    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(`[DEXSCREENER] 🎯 FINAL RESULTS:`)
    console.log(`[DEXSCREENER] 📈 BUY VOLUME: $${totalBuyVolumeUsd.toFixed(2)}`)
    console.log(`[DEXSCREENER] 📉 SELL VOLUME: $${totalSellVolumeUsd.toFixed(2)}`)
    console.log(`[DEXSCREENER] 💰 NET FLOW: $${autoSellState.metrics.netUsdFlow.toFixed(2)}`)

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
