import { type NextRequest, NextResponse } from "next/server"
import { Connection, PublicKey, Keypair } from "@solana/web3.js"
import bs58 from "bs58"

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

export const autoSellState = {
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
    dataSourceConfidence: 0,
    lastRealTimeUpdate: 0,
  },
  intervals: [] as NodeJS.Timeout[],
}

process.on("uncaughtException", (error) => {
  console.error("[CRASH-PREVENTION] Uncaught Exception:", error)
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRASH-PREVENTION] Unhandled Rejection at:", promise, "reason:", reason)
})

const bulletproofTransactionClassifier = {
  classifyTransaction: (apiType: string, tokenAmount: number, usdAmount: number, source: string) => {
    console.log(
      `[BULLETPROOF-CLASSIFIER] Input - API Type: "${apiType}", Token Amount: ${tokenAmount}, USD: $${usdAmount.toFixed(6)}, Source: ${source}`,
    )

    let finalType: string

    // BULLETPROOF LOGIC: Use token amount direction as PRIMARY classifier
    if (tokenAmount < 0) {
      finalType = "buy" // Negative = tokens leaving pool = someone bought
      console.log(`[BULLETPROOF-CLASSIFIER] Token amount ${tokenAmount} < 0 = BUY (tokens leaving pool)`)
    } else if (tokenAmount > 0) {
      finalType = "sell" // Positive = tokens entering pool = someone sold
      console.log(`[BULLETPROOF-CLASSIFIER] Token amount ${tokenAmount} > 0 = SELL (tokens entering pool)`)
    } else {
      // If token amount is zero, use API type directly (no reversals)
      finalType = apiType === "buy" ? "buy" : apiType === "sell" ? "sell" : "unknown"
      console.log(`[BULLETPROOF-CLASSIFIER] Using API type directly: "${apiType}" -> "${finalType}"`)
    }

    console.log(`[BULLETPROOF-CLASSIFIER] 🎯 FINAL RESULT: ${finalType.toUpperCase()} for $${usdAmount.toFixed(6)}`)
    return finalType
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

async function updateAllWalletBalances() {
  if (!autoSellState.config || autoSellState.wallets.length === 0) {
    console.log("[WALLET-BALANCE] No wallets to update")
    return
  }

  try {
    const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || PREMIUM_APIS.alchemy.mainnet1, {
      commitment: "confirmed",
    })

    const tokenMint = new PublicKey(autoSellState.config.mint)

    for (const wallet of autoSellState.wallets) {
      try {
        // Get SOL balance
        const solBalance = await connection.getBalance(wallet.keypair.publicKey)
        wallet.balance = solBalance / 1e9 // Convert lamports to SOL

        // Get token balance
        const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.keypair.publicKey, { mint: tokenMint })

        let tokenBalance = 0
        if (tokenAccounts.value.length > 0) {
          const accountInfo = await connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey)
          tokenBalance = Number(accountInfo.value.uiAmount || 0)
        }
        wallet.tokenBalance = tokenBalance

        console.log(
          `[WALLET-BALANCE] ${wallet.publicKey.slice(0, 8)}: ${wallet.balance.toFixed(4)} SOL, ${tokenBalance.toFixed(2)} tokens`,
        )
      } catch (error) {
        console.error(`[WALLET-BALANCE] Error updating wallet ${wallet.publicKey.slice(0, 8)}:`, error)
      }
    }
  } catch (error) {
    console.error("[WALLET-BALANCE] Error updating wallet balances:", error)
  }
}

async function updateTokenPrice() {
  if (!autoSellState.config) return

  try {
    // Try Jupiter price API first
    const jupiterResponse = await fetch(`https://price.jup.ag/v4/price?ids=${autoSellState.config.mint}`)
    if (jupiterResponse.ok) {
      const jupiterData = await jupiterResponse.json()
      if (jupiterData.data && jupiterData.data[autoSellState.config.mint]) {
        const price = Number(jupiterData.data[autoSellState.config.mint].price)
        autoSellState.metrics.currentPriceUsd = price
        console.log(`[PRICE] Updated from Jupiter: $${price.toFixed(8)}`)
        return
      }
    }

    // Fallback to DexScreener
    const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
    if (dexResponse.ok) {
      const dexData = await dexResponse.json()
      if (dexData.pairs && dexData.pairs.length > 0) {
        const price = Number(dexData.pairs[0].priceUsd || 0)
        autoSellState.metrics.currentPriceUsd = price
        console.log(`[PRICE] Updated from DexScreener: $${price.toFixed(8)}`)
        return
      }
    }

    console.log("[PRICE] Failed to update token price from all sources")
  } catch (error) {
    console.error("[PRICE] Error updating token price:", error)
  }
}

async function collectMarketDataForConfigurableWindow() {
  if (!autoSellState.config) {
    console.error("[DATA-COLLECTION] Error: autoSellState.config is null")
    return
  }

  console.log(`[DATA-COLLECTION] 🚀 Starting ${autoSellState.config.timeWindowSeconds}s market data collection...`)

  // Reset metrics
  autoSellState.metrics.buyVolumeUsd = 0
  autoSellState.metrics.sellVolumeUsd = 0
  autoSellState.metrics.netUsdFlow = 0
  autoSellState.metrics.buyTransactionCount = 0
  autoSellState.metrics.sellTransactionCount = 0

  // Try data sources in priority order
  const dataSources = [
    { name: "DexTools Premium", fn: collectDexToolsData },
    { name: "Bitquery EAP", fn: collectBitqueryEAPData },
    { name: "Alchemy Premium", fn: collectAlchemyData },
    { name: "DexScreener Fallback", fn: collectDexScreenerData },
  ]

  for (const source of dataSources) {
    try {
      console.log(`[DATA-COLLECTION] Trying ${source.name}...`)
      const success = await source.fn()
      if (success) {
        console.log(`[DATA-COLLECTION] ✅ ${source.name} successful`)
        break
      }
    } catch (error) {
      console.error(`[DATA-COLLECTION] ❌ ${source.name} failed:`, error)
      continue
    }
  }

  console.log(`[DATA-COLLECTION] 📊 Final Results:`)
  console.log(`[DATA-COLLECTION] - Buy Volume: $${autoSellState.metrics.buyVolumeUsd.toFixed(4)}`)
  console.log(`[DATA-COLLECTION] - Sell Volume: $${autoSellState.metrics.sellVolumeUsd.toFixed(4)}`)
  console.log(`[DATA-COLLECTION] - Net Flow: $${autoSellState.metrics.netUsdFlow.toFixed(4)}`)
}

async function collectDexToolsData() {
  if (!autoSellState.config) return false

  try {
    console.log(`[DEXTOOLS] 🚀 PREMIUM API - Starting transaction collection...`)

    const timeWindowSeconds = autoSellState.config.timeWindowSeconds || 30
    const dextoolsApiKey = process.env.DEXTOOLS_API_KEY

    if (!dextoolsApiKey) {
      throw new Error("DEXTOOLS_API_KEY not configured")
    }

    const url = `https://public-api.dextools.io/standard/v2/token/solana/${autoSellState.config.mint}/transactions?limit=100&sort=desc`

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

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid DexTools API response format")
    }

    console.log(`[DEXTOOLS] Found ${data.data.length} total transactions`)

    const endTime = Math.floor(Date.now() / 1000)
    const startTime = endTime - timeWindowSeconds

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const tx of data.data) {
      try {
        const txTime = new Date(tx.timeStamp).getTime() / 1000

        // Only process transactions within our time window
        if (txTime < startTime) continue

        const usdAmount = Number.parseFloat(tx.amountUSD || tx.amount_usd || "0")
        const tokenAmount = Number.parseFloat(tx.tokenAmount || tx.token_amount || "0")

        if (usdAmount < 0.0001) continue // Skip tiny transactions

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
          console.log(`[DEXTOOLS] ❌ SELL: $${usdAmount.toFixed(4)} (${tokenAmount.toFixed(2)} tokens)`)
        }
      } catch (txError) {
        console.error(`[DEXTOOLS] Error processing transaction:`, txError)
        continue
      }
    }

    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd
    autoSellState.metrics.buyTransactionCount = buyCount
    autoSellState.metrics.sellTransactionCount = sellCount
    autoSellState.metrics.dataSourceConfidence = 95

    console.log(`[DEXTOOLS] 🎯 BULLETPROOF RESULTS:`)
    console.log(`[DEXTOOLS] 📈 BUY VOLUME: $${totalBuyVolumeUsd.toFixed(4)} (${buyCount} transactions)`)
    console.log(`[DEXTOOLS] 📉 SELL VOLUME: $${totalSellVolumeUsd.toFixed(4)} (${sellCount} transactions)`)
    console.log(`[DEXTOOLS] 💰 NET FLOW: $${autoSellState.metrics.netUsdFlow.toFixed(4)}`)

    return totalBuyVolumeUsd > 0 || totalSellVolumeUsd > 0
  } catch (error) {
    console.error("[DEXTOOLS] ❌ Error:", error)
    return false
  }
}

async function collectBitqueryEAPData() {
  if (!autoSellState.config) return false

  try {
    const timeWindowSeconds = autoSellState.config.timeWindowSeconds
    const mint = autoSellState.config.mint

    console.log(`[BITQUERY-EAP] 🔍 Fetching real-time DEX data for ${mint}`)

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

    if (data && typeof data === "object") {
      const buyVolumeUsd = Number(data.buyers_usd || 0)
      const sellVolumeUsd = Number(data.sellers_usd || 0)
      const buyCount = Number(data.buyers_count || 0)
      const sellCount = Number(data.sellers_count || 0)

      autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
      autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
      autoSellState.metrics.netUsdFlow = buyVolumeUsd - sellVolumeUsd
      autoSellState.metrics.buyTransactionCount = buyCount
      autoSellState.metrics.sellTransactionCount = sellCount

      console.log(`[BITQUERY-EAP] ✅ Buy: $${buyVolumeUsd.toFixed(4)}, Sell: $${sellVolumeUsd.toFixed(4)}`)
      return buyVolumeUsd > 0 || sellVolumeUsd > 0
    }

    return false
  } catch (error) {
    console.error(`[BITQUERY-EAP] ❌ Error:`, error)
    return false
  }
}

async function collectAlchemyData() {
  if (!autoSellState.config) return false

  try {
    console.log(`[ALCHEMY] 🚀 PREMIUM API - Starting transaction collection...`)

    const connection = new Connection(PREMIUM_APIS.alchemy.mainnet1, { commitment: "confirmed" })
    const tokenMintPubkey = new PublicKey(autoSellState.config.mint)

    const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
    const currentTime = Date.now()
    const windowStartTime = currentTime - timeWindowMs

    const signatures = await connection.getSignaturesForAddress(tokenMintPubkey, { limit: 100 })

    const recentSignatures = signatures.filter((sig) => {
      const txTime = (sig.blockTime || 0) * 1000
      return txTime >= windowStartTime
    })

    console.log(`[ALCHEMY] Found ${recentSignatures.length} recent signatures`)

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0

    for (const sigInfo of recentSignatures) {
      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })

        if (!tx || !tx.meta) continue

        const tradeInfo = analyzeTokenMintTransaction(tx, autoSellState.config.mint)

        if (tradeInfo) {
          if (tradeInfo.type === "buy") {
            totalBuyVolumeUsd += tradeInfo.usdAmount
            buyCount++
          } else if (tradeInfo.type === "sell") {
            totalSellVolumeUsd += tradeInfo.usdAmount
            sellCount++
          }
        }
      } catch (txError) {
        continue
      }
    }

    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd
    autoSellState.metrics.buyTransactionCount = buyCount
    autoSellState.metrics.sellTransactionCount = sellCount

    console.log(`[ALCHEMY] ✅ Buy: $${totalBuyVolumeUsd.toFixed(4)}, Sell: $${totalSellVolumeUsd.toFixed(4)}`)
    return totalBuyVolumeUsd > 0 || totalSellVolumeUsd > 0
  } catch (error) {
    console.error("[ALCHEMY] ❌ Error:", error)
    return false
  }
}

async function collectDexScreenerData() {
  if (!autoSellState.config) return false

  try {
    console.log(`[DEXSCREENER] 🔄 FALLBACK API - Starting transaction collection...`)

    const url = `https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "AutoSellBot/3.0",
      },
    })

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.pairs || data.pairs.length === 0) {
      throw new Error("No trading pairs found")
    }

    // Use volume data from the most liquid pair
    const pair = data.pairs.reduce((best: any, current: any) =>
      (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best,
    )

    const volume24h = Number(pair.volume?.h24 || 0)
    const priceChange24h = Number(pair.priceChange?.h24 || 0)

    // Estimate buy/sell volumes based on price movement and volume
    let buyVolumeUsd = 0
    let sellVolumeUsd = 0

    if (volume24h > 0) {
      const timeWindowRatio = autoSellState.config.timeWindowSeconds / (24 * 60 * 60) // Convert to 24h ratio
      const estimatedVolume = volume24h * timeWindowRatio

      if (priceChange24h > 0.5) {
        // Positive price movement suggests buying pressure
        buyVolumeUsd = estimatedVolume * 0.6
        sellVolumeUsd = estimatedVolume * 0.4
      } else if (priceChange24h < -0.5) {
        // Negative price movement suggests selling pressure
        buyVolumeUsd = estimatedVolume * 0.4
        sellVolumeUsd = estimatedVolume * 0.6
      } else {
        // Neutral movement
        buyVolumeUsd = estimatedVolume * 0.5
        sellVolumeUsd = estimatedVolume * 0.5
      }
    }

    autoSellState.metrics.buyVolumeUsd = buyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = sellVolumeUsd
    autoSellState.metrics.netUsdFlow = buyVolumeUsd - sellVolumeUsd
    autoSellState.metrics.dataSourceConfidence = 60 // Lower confidence for estimated data

    console.log(`[DEXSCREENER] ✅ Estimated Buy: $${buyVolumeUsd.toFixed(4)}, Sell: $${sellVolumeUsd.toFixed(4)}`)
    return buyVolumeUsd > 0 || sellVolumeUsd > 0
  } catch (error) {
    console.error("[DEXSCREENER] ❌ Error:", error)
    return false
  }
}

function analyzeTokenMintTransaction(transaction: any, tokenMint: string) {
  try {
    const { meta, transaction: txData } = transaction

    if (!meta || !txData) return null

    const preTokenBalances = meta.preTokenBalances || []
    const postTokenBalances = meta.postTokenBalances || []

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
          }
        }
      }
    }

    if (tokenBalanceChanges.length === 0) return null

    // Find the trader (not the pool)
    const sortedChanges = tokenBalanceChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

    let traderChange = null
    let transactionType = "unknown"
    let tradeAmount = 0

    for (const change of sortedChanges) {
      const absChange = Math.abs(change.change)

      // Skip extremely large changes that are likely pool operations
      if (absChange > 10000000) continue

      // Look for significant trader-sized changes
      if (absChange > 0.001) {
        traderChange = change
        transactionType = change.change > 0 ? "buy" : "sell"
        tradeAmount = absChange
        break
      }
    }

    if (!traderChange && sortedChanges.length > 0) {
      const nonPoolChanges = sortedChanges.filter((change) => Math.abs(change.change) < 50000000)

      if (nonPoolChanges.length > 0) {
        traderChange = nonPoolChanges[0]
        transactionType = traderChange.change > 0 ? "buy" : "sell"
        tradeAmount = Math.abs(traderChange.change)
      }
    }

    if (!traderChange) return null

    // Calculate USD amount
    let currentPrice = autoSellState.metrics.currentPriceUsd || 0

    if (currentPrice === 0) {
      currentPrice = 0.00001 // Use minimal price to avoid filtering
    }

    const usdAmount = tradeAmount * currentPrice

    if (usdAmount < 0.0001) return null

    return {
      signature: txData.signatures?.[0] || "unknown",
      type: transactionType,
      tokenAmount: tradeAmount,
      usdAmount,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error(`[TX-ANALYSIS] ❌ Error:`, error)
    return null
  }
}

async function analyzeAndExecuteAutoSell() {
  if (!autoSellState.config || autoSellState.wallets.length === 0) {
    console.log("[AUTO-SELL] No configuration or wallets available")
    return
  }

  const { netUsdFlow, buyVolumeUsd, sellVolumeUsd } = autoSellState.metrics
  const minNetFlowUsd = autoSellState.config.minNetFlowUsd || 10
  const cooldownSeconds = autoSellState.config.cooldownSeconds || 15

  console.log(`[AUTO-SELL] 📊 Analysis Results:`)
  console.log(`[AUTO-SELL] - Buy Volume: $${buyVolumeUsd.toFixed(4)}`)
  console.log(`[AUTO-SELL] - Sell Volume: $${sellVolumeUsd.toFixed(4)}`)
  console.log(`[AUTO-SELL] - Net Flow: $${netUsdFlow.toFixed(4)}`)
  console.log(`[AUTO-SELL] - Min Required: $${minNetFlowUsd}`)

  // Check cooldown
  const timeSinceLastSell = (Date.now() - autoSellState.metrics.lastSellTrigger) / 1000
  if (timeSinceLastSell < cooldownSeconds) {
    console.log(`[AUTO-SELL] ⏳ Cooldown active: ${(cooldownSeconds - timeSinceLastSell).toFixed(1)}s remaining`)
    return
  }

  const shouldSell =
    netUsdFlow > 0 && // Positive net flow (more buying than selling)
    netUsdFlow >= minNetFlowUsd && // Meets minimum threshold
    buyVolumeUsd > sellVolumeUsd && // More buy volume than sell volume
    buyVolumeUsd > 0.01 && // Significant buy activity
    sellTriggerManager.canExecuteSell(netUsdFlow, Date.now()) // One-time trigger check

  if (shouldSell) {
    console.log(`[AUTO-SELL] 🚀 SELL TRIGGER ACTIVATED!`)
    console.log(`[AUTO-SELL] - Net buying pressure detected: $${netUsdFlow.toFixed(4)}`)
    console.log(`[AUTO-SELL] - Will sell ${autoSellState.config.sellPercentageOfNetFlow}% of net flow`)

    try {
      await executeSellOrder()
      autoSellState.metrics.lastSellTrigger = Date.now()

      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0
      autoSellState.metrics.netUsdFlow = 0

      console.log(`[AUTO-SELL] ✅ Sell order executed successfully`)
    } catch (error) {
      console.error(`[AUTO-SELL] ❌ Sell execution failed:`, error)
    }
  } else {
    console.log(`[AUTO-SELL] ⏸️ No sell trigger - conditions not met`)
    if (netUsdFlow <= 0) console.log(`[AUTO-SELL] - Net flow not positive: $${netUsdFlow.toFixed(4)}`)
    if (netUsdFlow < minNetFlowUsd)
      console.log(`[AUTO-SELL] - Below minimum threshold: $${netUsdFlow.toFixed(4)} < $${minNetFlowUsd}`)
    if (buyVolumeUsd <= sellVolumeUsd)
      console.log(`[AUTO-SELL] - Not enough buy pressure: $${buyVolumeUsd.toFixed(4)} vs $${sellVolumeUsd.toFixed(4)}`)
  }
}

async function executeSellOrder() {
  console.log("[SELL-EXECUTION] 🚀 Executing sell order...")

  const sellPercentage = autoSellState.config.sellPercentageOfNetFlow || 25
  const netFlow = autoSellState.metrics.netUsdFlow
  const sellAmountUsd = (netFlow * sellPercentage) / 100

  console.log(`[SELL-EXECUTION] - Net Flow: $${netFlow.toFixed(4)}`)
  console.log(`[SELL-EXECUTION] - Sell Percentage: ${sellPercentage}%`)
  console.log(`[SELL-EXECUTION] - Sell Amount: $${sellAmountUsd.toFixed(4)}`)

  // Calculate token amount to sell based on current price
  const currentPrice = autoSellState.metrics.currentPriceUsd
  if (currentPrice <= 0) {
    throw new Error("Invalid token price for sell calculation")
  }

  const tokenAmountToSell = sellAmountUsd / currentPrice

  console.log(`[SELL-EXECUTION] - Token Price: $${currentPrice.toFixed(8)}`)
  console.log(`[SELL-EXECUTION] - Tokens to Sell: ${tokenAmountToSell.toFixed(2)}`)

  // Execute sell for each wallet that has sufficient balance
  for (const wallet of autoSellState.wallets) {
    if (wallet.tokenBalance >= tokenAmountToSell) {
      try {
        console.log(`[SELL-EXECUTION] 💰 Selling from wallet ${wallet.publicKey.slice(0, 8)}...`)

        // Call the sell API
        const sellResponse = await fetch("/api/sell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            privateKey: bs58.encode(wallet.keypair.secretKey),
            mint: autoSellState.config.mint,
            amount: tokenAmountToSell,
            slippageBps: autoSellState.config.slippageBps || 300,
          }),
        })

        if (sellResponse.ok) {
          const sellResult = await sellResponse.json()
          console.log(`[SELL-EXECUTION] ✅ Sell successful: ${sellResult.signature}`)

          // Update wallet balance
          wallet.tokenBalance -= tokenAmountToSell
          break // Only sell from one wallet per trigger
        } else {
          const error = await sellResponse.text()
          console.error(`[SELL-EXECUTION] ❌ Sell failed: ${error}`)
        }
      } catch (error) {
        console.error(`[SELL-EXECUTION] ❌ Error selling from wallet ${wallet.publicKey.slice(0, 8)}:`, error)
      }
    } else {
      console.log(
        `[SELL-EXECUTION] ⚠️ Wallet ${wallet.publicKey.slice(0, 8)} insufficient balance: ${wallet.tokenBalance.toFixed(2)} < ${tokenAmountToSell.toFixed(2)}`,
      )
    }
  }
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
    const wallets = privateKeys
      .map((key: string) => {
        try {
          const keypair = Keypair.fromSecretKey(bs58.decode(key))
          return {
            keypair,
            publicKey: keypair.publicKey.toString(),
            balance: 0,
            tokenBalance: 0,
          }
        } catch (error) {
          console.error("Invalid private key:", error)
          return null
        }
      })
      .filter(Boolean)

    if (wallets.length === 0) {
      return NextResponse.json({ error: "No valid wallets could be parsed" }, { status: 400 })
    }

    // Update global state
    autoSellState.config = {
      ...config,
      timeWindowSeconds: config.timeWindowSeconds || 30,
      sellPercentageOfNetFlow: config.sellPercentageOfNetFlow || 25,
      minNetFlowUsd: config.minNetFlowUsd || 10,
      cooldownSeconds: config.cooldownSeconds || 15,
      slippageBps: config.slippageBps || 300,
    }
    autoSellState.wallets = wallets
    autoSellState.marketTrades = []
    autoSellState.isRunning = true

    console.log("[AUTO-SELL] 🚀 Starting auto-sell engine...")
    await startAutoSellEngine()

    return NextResponse.json({
      message: "Auto-sell engine started successfully",
      status: "running",
      config: autoSellState.config,
      wallets: autoSellState.wallets.length,
    })
  } catch (error) {
    console.error("Error starting auto-sell engine:", error)
    autoSellState.isRunning = false
    return NextResponse.json(
      {
        error: "Failed to start auto-sell engine",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function startAutoSellEngine() {
  try {
    // Clear any existing intervals
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []

    autoSellState.botStartTime = Date.now()
    console.log(`[AUTO-SELL] 🚀 Engine started at ${new Date().toISOString()}`)

    // Update token price immediately
    await updateTokenPrice()

    // Update wallet balances immediately
    await updateAllWalletBalances()

    // Start the analysis cycle
    await startConfigurableAnalysisCycle()

    // Set up periodic wallet balance updates
    const balanceInterval = setInterval(async () => {
      if (!autoSellState.isRunning) return
      try {
        await updateAllWalletBalances()
      } catch (error) {
        console.error("Balance update error:", error)
      }
    }, 30000)

    autoSellState.intervals.push(balanceInterval)
  } catch (error) {
    console.error("[AUTO-SELL] ❌ Critical error in startAutoSellEngine:", error)
    autoSellState.isRunning = false
    throw error
  }
}

async function startConfigurableAnalysisCycle() {
  const timeWindowSeconds = autoSellState.config?.timeWindowSeconds || 30
  const scanIntervalSeconds = 10

  console.log(`[AUTO-SELL] 📊 Starting ${timeWindowSeconds}s analysis cycle (scan every ${scanIntervalSeconds}s)`)

  // Run initial analysis
  try {
    await collectMarketDataForConfigurableWindow()
    await analyzeAndExecuteAutoSell()
  } catch (error) {
    console.error("[AUTO-SELL] Initial analysis failed:", error)
  }

  // Set up periodic analysis
  const analysisInterval = setInterval(async () => {
    if (!autoSellState.isRunning) {
      clearInterval(analysisInterval)
      return
    }

    try {
      await collectMarketDataForConfigurableWindow()
      await analyzeAndExecuteAutoSell()
    } catch (error) {
      console.error(`[AUTO-SELL] Analysis error:`, error)
    }
  }, scanIntervalSeconds * 1000)

  autoSellState.intervals.push(analysisInterval)
}

export async function GET() {
  return NextResponse.json({
    isRunning: autoSellState.isRunning,
    config: autoSellState.config,
    metrics: autoSellState.metrics,
    wallets: autoSellState.wallets.map((w) => ({
      publicKey: w.publicKey,
      balance: w.balance,
      tokenBalance: w.tokenBalance,
    })),
    uptime: autoSellState.botStartTime ? Date.now() - autoSellState.botStartTime : 0,
  })
}
