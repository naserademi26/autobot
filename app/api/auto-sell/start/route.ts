import { type NextRequest, NextResponse } from "next/server"
import { Buffer } from "buffer"

// Global state for the auto-sell engine
const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  marketTrades: [] as any[],
  bitquerySubscription: null as any,
  botStartTime: 0, // Track when bot actually started
  firstAnalysisTime: 0, // Track when first analysis should happen
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
    return NextResponse.json({ error: "Failed to start auto-sell engine" }, { status: 500 })
  }
}

async function startAutoSellEngine() {
  // Clear any existing intervals
  autoSellState.intervals.forEach((interval) => clearInterval(interval))
  autoSellState.intervals = []

  autoSellState.botStartTime = Date.now()
  autoSellState.firstAnalysisTime = autoSellState.botStartTime

  console.log(`[AUTO-SELL] Bot started at ${new Date(autoSellState.botStartTime).toISOString()}`)
  console.log(`[AUTO-SELL] Starting immediate market analysis...`)

  await startConfigurableAnalysisCycle()

  const balanceInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return
    try {
      await updateAllWalletBalances()
      console.log("[AUTO-SELL] Wallet balances updated")
    } catch (error) {
      console.error("Balance update error:", error)
    }
  }, 30000)

  autoSellState.intervals.push(balanceInterval)
}

function startConfigurableAnalysisCycle() {
  updateSolPrice()

  const timeWindowSeconds = autoSellState.config.timeWindowSeconds
  const timeWindowMs = timeWindowSeconds * 1000

  console.log(`[AUTO-SELL] Starting immediate ${timeWindowSeconds}-second analysis cycles...`)

  // Run first analysis immediately
  collectMarketDataForConfigurableWindow()
  analyzeAndExecuteAutoSell()

  const analysisInterval = setInterval(async () => {
    if (!autoSellState.isRunning) {
      clearInterval(analysisInterval)
      return
    }

    try {
      console.log(`[AUTO-SELL] Running ${timeWindowSeconds}-second market analysis...`)
      await collectMarketDataForConfigurableWindow()
      await analyzeAndExecuteAutoSell()
    } catch (error) {
      console.error(`[AUTO-SELL] ${timeWindowSeconds}-second analysis error:`, error)
    }
  }, timeWindowMs)

  autoSellState.intervals.push(analysisInterval)
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

  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
      "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
    { commitment: "confirmed" },
  )

  const timeWindowMs = autoSellState.config.timeWindowSeconds * 1000
  const currentTime = Date.now()
  const windowStartTime = currentTime - timeWindowMs

  console.log(
    `[SOLANA-RPC] Monitoring RECENT transactions for token ${autoSellState.config.mint} in last ${autoSellState.config.timeWindowSeconds} seconds`,
  )

  try {
    // Get recent signatures for the token mint
    const mintPubkey = new PublicKey(autoSellState.config.mint)
    const signatures = await connection.getSignaturesForAddress(mintPubkey, {
      limit: 200, // Increased limit for better coverage
    })

    console.log(`[SOLANA-RPC] Found ${signatures.length} recent signatures`)

    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let buyCount = 0
    let sellCount = 0
    const processedTransactions = []

    // Process each transaction within the time window
    for (const sigInfo of signatures) {
      const txTime = (sigInfo.blockTime || 0) * 1000

      if (txTime < windowStartTime) {
        continue
      }

      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })

        if (!tx || !tx.meta) continue

        // Analyze transaction for buy/sell activity
        const tradeInfo = analyzeTokenSwapTransaction(tx, autoSellState.config.mint)

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
              `[SOLANA-RPC] ✅ BUY: $${tradeInfo.usdAmount.toFixed(2)} at ${new Date(txTime).toISOString()} (${sigInfo.signature.substring(0, 8)}...)`,
            )
          } else if (tradeInfo.type === "sell") {
            totalSellVolumeUsd += tradeInfo.usdAmount
            sellCount++
            console.log(
              `[SOLANA-RPC] ❌ SELL: $${tradeInfo.usdAmount.toFixed(2)} at ${new Date(txTime).toISOString()} (${sigInfo.signature.substring(0, 8)}...)`,
            )
          }
        }
      } catch (txError) {
        // Skip failed transaction parsing
        continue
      }
    }

    autoSellState.marketTrades = processedTransactions

    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(
      `[SOLANA-RPC] 📊 REAL-TIME DATA (${autoSellState.config.timeWindowSeconds}s window) - Buy: $${totalBuyVolumeUsd.toFixed(2)} (${buyCount} txs) | Sell: $${totalSellVolumeUsd.toFixed(2)} (${sellCount} txs) | Net: $${(totalBuyVolumeUsd - totalSellVolumeUsd).toFixed(2)}`,
    )

    if (buyCount === 0 && sellCount === 0) {
      console.log(`[SOLANA-RPC] No trading activity in the last ${autoSellState.config.timeWindowSeconds} seconds`)
    }
  } catch (error) {
    console.error("[SOLANA-RPC] Error collecting transaction data:", error)
    throw error
  }
}

function analyzeTokenSwapTransaction(tx: any, tokenMint: string) {
  try {
    if (!tx.meta || !tx.meta.preTokenBalances || !tx.meta.postTokenBalances) {
      return null
    }

    const preTokenBalances = tx.meta.preTokenBalances || []
    const postTokenBalances = tx.meta.postTokenBalances || []

    // Calculate net token flow across ALL accounts in the transaction
    let netTokenFlow = 0
    let netSolFlow = 0
    let hasTokenActivity = false

    // Track all token balance changes for our mint
    const tokenBalanceChanges = new Map()

    // Process existing token accounts
    for (const preBalance of preTokenBalances) {
      if (preBalance.mint === tokenMint) {
        const postBalance = postTokenBalances.find(
          (post: any) => post.accountIndex === preBalance.accountIndex && post.mint === tokenMint,
        )
        if (postBalance) {
          const preAmount = Number(preBalance.uiTokenAmount?.uiAmount || 0)
          const postAmount = Number(postBalance.uiTokenAmount?.uiAmount || 0)
          const change = postAmount - preAmount

          tokenBalanceChanges.set(preBalance.accountIndex, change)
          netTokenFlow += change
          hasTokenActivity = true

          console.log(
            `[TX-ANALYSIS] Account ${preBalance.accountIndex}: ${change > 0 ? "+" : ""}${change.toFixed(4)} tokens`,
          )
        }
      }
    }

    // Process new token accounts (first-time buyers)
    for (const postBalance of postTokenBalances) {
      if (postBalance.mint === tokenMint) {
        const preBalance = preTokenBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex && pre.mint === tokenMint,
        )
        if (!preBalance) {
          const newAmount = Number(postBalance.uiTokenAmount?.uiAmount || 0)
          tokenBalanceChanges.set(postBalance.accountIndex, newAmount)
          netTokenFlow += newAmount
          hasTokenActivity = true

          console.log(
            `[TX-ANALYSIS] New Account ${postBalance.accountIndex}: +${newAmount.toFixed(4)} tokens (first buy)`,
          )
        }
      }
    }

    // Calculate net SOL flow for cross-validation
    if (tx.meta.preBalances && tx.meta.postBalances) {
      const solBalanceChanges = tx.meta.postBalances.map(
        (post: number, index: number) => post - tx.meta.preBalances[index],
      )

      // Find the largest SOL movement (excluding fees)
      let maxSolChange = 0
      solBalanceChanges.forEach((change: number, index: number) => {
        if (Math.abs(change) > Math.abs(maxSolChange) && Math.abs(change) > 10000) {
          // > 0.00001 SOL
          maxSolChange = change
        }
      })

      netSolFlow = maxSolChange / 1e9
    }

    if (!hasTokenActivity || Math.abs(netTokenFlow) < 0.001) {
      return null
    }

    // Determine transaction type based on net token flow
    let type = ""
    let usdAmount = 0

    if (netTokenFlow > 0.001) {
      // Net positive token flow = someone received tokens = BUY
      type = "buy"
      console.log(`[TX-ANALYSIS] ✅ CLASSIFIED AS BUY: Net token flow +${netTokenFlow.toFixed(4)} tokens`)
    } else if (netTokenFlow < -0.001) {
      // Net negative token flow = someone sent tokens away = SELL
      type = "sell"
      console.log(`[TX-ANALYSIS] ❌ CLASSIFIED AS SELL: Net token flow ${netTokenFlow.toFixed(4)} tokens`)
    } else {
      return null
    }

    // Cross-validate with SOL flow direction
    if (Math.abs(netSolFlow) > 0.00001) {
      const expectedSolFlow = type === "buy" ? "negative" : "positive"
      const actualSolFlow = netSolFlow < 0 ? "negative" : "positive"

      if (expectedSolFlow !== actualSolFlow) {
        console.log(
          `[TX-ANALYSIS] ⚠️ SOL flow mismatch: Expected ${expectedSolFlow}, got ${actualSolFlow} (${netSolFlow.toFixed(6)} SOL)`,
        )
      } else {
        console.log(`[TX-ANALYSIS] ✅ SOL flow confirms ${type}: ${netSolFlow.toFixed(6)} SOL`)
      }
    }

    // Calculate USD value
    const solPriceUsd = autoSellState.metrics.solPriceUsd || 100
    const tokenPriceUsd = autoSellState.metrics.currentPriceUsd || 0.000001

    if (Math.abs(netSolFlow) > 0.00001) {
      // Use SOL flow for USD calculation (more reliable)
      usdAmount = Math.abs(netSolFlow) * solPriceUsd
    } else {
      // Fall back to token amount estimation
      usdAmount = Math.abs(netTokenFlow) * tokenPriceUsd
    }

    // Only process transactions with meaningful USD value
    if (usdAmount < 0.1) {
      console.log(`[TX-ANALYSIS] ⚠️ Transaction too small: $${usdAmount.toFixed(4)}, skipping`)
      return null
    }

    console.log(`[TX-ANALYSIS] 💰 Final: ${type.toUpperCase()} $${usdAmount.toFixed(2)} USD`)

    return {
      type,
      solAmount: Math.abs(netSolFlow),
      tokenAmount: Math.abs(netTokenFlow),
      usdAmount,
      signature: tx.transaction.signatures[0],
      isJupiterTx: true,
    }
  } catch (error) {
    console.error("[TX-ANALYSIS] Error analyzing transaction:", error)
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
      const estimatedVolume = (volume24h / (24 * 60)) * timeWindowMinutes // Volume for time window

      if (priceChange5m > 0.5) {
        // Positive price movement suggests buying pressure
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.6
        autoSellState.metrics.sellVolumeUsd = estimatedVolume * 0.4
      } else if (priceChange5m < -0.5) {
        // Negative price movement suggests selling pressure
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.4
        autoSellState.metrics.sellVolumeUsd = estimatedVolume * 0.6
      } else {
        // Neutral movement
        autoSellState.metrics.buyVolumeUsd = estimatedVolume * 0.5
        autoSellState.metrics.sellVolumeUsd = estimatedVolume * 0.5
      }

      autoSellState.metrics.netUsdFlow = autoSellState.metrics.buyVolumeUsd - autoSellState.metrics.sellVolumeUsd

      console.log(
        `[DEXSCREENER] Price: $${priceUsd.toFixed(8)} | 5m Change: ${priceChange5m.toFixed(2)}% | Est Buy: $${autoSellState.metrics.buyVolumeUsd.toFixed(2)} | Est Sell: $${autoSellState.metrics.sellVolumeUsd.toFixed(2)} | Net: $${autoSellState.metrics.netUsdFlow.toFixed(2)}`,
      )
    } else {
      console.log("[DEXSCREENER] No trading pairs found")
      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0
      autoSellState.metrics.netUsdFlow = 0
    }
  } catch (error) {
    console.error("[DEXSCREENER] Data collection failed:", error)
    autoSellState.metrics.buyVolumeUsd = 0
    autoSellState.metrics.sellVolumeUsd = 0
    autoSellState.metrics.netUsdFlow = 0
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
      await executeCoordinatedSell(sellAmountUsd)
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

async function executeCoordinatedSell(sellAmountUsd: number) {
  try {
    console.log(`[AUTO-SELL] 🎯 STARTING COORDINATED SELL EXECUTION`)
    console.log(`[AUTO-SELL] Target sell amount: $${sellAmountUsd.toFixed(2)} USD`)

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

    const tokensToSell = sellAmountUsd / effectivePriceUsd
    console.log(
      `[AUTO-SELL] Token calculation: $${sellAmountUsd.toFixed(2)} ÷ $${effectivePriceUsd.toFixed(8)} = ${tokensToSell.toFixed(4)} tokens`,
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
    const results = await Promise.all(sellPromises)
    const successfulSells = results.filter((result) => result !== null)

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
      await updateAllWalletBalances()
      console.log(`[AUTO-SELL] ✅ Balance update complete`)
    } else {
      console.log("[AUTO-SELL] ❌ COMPLETE FAILURE: No successful sells executed")
    }
  } catch (error) {
    console.error("[AUTO-SELL] ❌ CRITICAL ERROR in executeCoordinatedSell:", error)
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

async function executeSell(wallet: any, amount: number) {
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
            Authorization: auth,
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
        data: error.response?.data,
        url: error.config?.url,
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
    await connection.confirmTransaction(signature, "confirmed")
    return signature
  } catch (error) {
    console.error("RPC submission also failed:", error)
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
