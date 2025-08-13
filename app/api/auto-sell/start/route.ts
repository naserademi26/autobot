import { type NextRequest, NextResponse } from "next/server"
import { Buffer } from "buffer"

// Global state for the auto-sell engine
const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  marketTrades: [] as any[], // Store real market trades from Bitquery
  bitquerySubscription: null as any, // WebSocket subscription
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

  await start2MinuteAnalysisCycle()

  const balanceInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return
    try {
      await updateAllWalletBalances()
      console.log("[AUTO-SELL] Wallet balances updated")
    } catch (error) {
      console.error("Balance update error:", error)
    }
  }, 30000) // Update every 30 seconds

  autoSellState.intervals.push(balanceInterval)
}

function start2MinuteAnalysisCycle() {
  // Get SOL price first
  updateSolPrice()

  console.log("[AUTO-SELL] Starting 2-minute analysis cycles...")

  // Run analysis every 2 minutes (120 seconds)
  const analysisInterval = setInterval(async () => {
    if (!autoSellState.isRunning) {
      clearInterval(analysisInterval)
      return
    }

    try {
      console.log("[AUTO-SELL] Starting 2-minute market analysis...")

      // Collect market data for the past 2 minutes
      await collectMarketDataFor2Minutes()

      // Analyze and execute if conditions are met
      await analyzeAndExecuteAutoSell()
    } catch (error) {
      console.error("[AUTO-SELL] 2-minute analysis error:", error)
    }
  }, 120000) // 2 minutes = 120,000ms

  autoSellState.intervals.push(analysisInterval)

  // Run first analysis immediately
  collectMarketDataFor2Minutes()
  analyzeAndExecuteAutoSell()
}

async function collectMarketDataFor2Minutes() {
  try {
    console.log("[AUTO-SELL] Collecting 2-minute market data...")

    const apiKey = "ory_at_hF4Y8YRKZtHeQ7xb91dd4Js7AZtma2CW91KrLwq1bOc.T4cX0fgDAEQGIkrntsJoYqlV2cnsuzICfhuT9Y0ZAyk"

    if (apiKey) {
      try {
        await collectBitqueryPrimaryData(apiKey)
        console.log("[BITQUERY] Successfully collected real trade data as primary source")
        return
      } catch (error) {
        console.log("[BITQUERY] Primary failed, falling back to DexScreener:", error.message)
      }
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

async function collectBitqueryPrimaryData(apiKey: string) {
  const query = {
    query: `{
      Solana(dataset: realtime) {
        DEXTradeByTokens(
          where: {Block: {Time: {since_relative: {minutes_ago: 2}}}, Trade: {Currency: {MintAddress: {is: "${autoSellState.config.mint}"}}}, Transaction: {Result: {Success: true}}}
        ) {
          Trade {
            Currency {
              Name
              Symbol
              MintAddress
            }
            Side {
              Currency {
                Name
                Symbol
                MintAddress
              }
            }
          }
          buyVolumeUSD: sum(
            of: Trade_Side_AmountInUSD
            if: {Trade: {Side: {Type: {is: buy}}}}
          )
          sellVolumeUSD: sum(
            of: Trade_Side_AmountInUSD
            if: {Trade: {Side: {Type: {is: sell}}}}
          )
          buyVolumeToken: sum(of: Trade_Amount, if: {Trade: {Side: {Type: {is: buy}}}})
          sellVolumeToken: sum(of: Trade_Amount, if: {Trade: {Side: {Type: {is: sell}}}})
          totalVolumeUSD: sum(of: Trade_Side_AmountInUSD)
          totalVolumeToken: sum(of: Trade_Amount)
          totalBuys: count(if: {Trade: {Side: {Type: {is: buy}}}})
          totalSells: count(if: {Trade: {Side: {Type: {is: sell}}}})
          totalTrades: count
          uniqueBuyers: uniq(
            of: Transaction_Signer
            if: {Trade: {Side: {Type: {is: buy}}}}
          )
          uniqueSellers: uniq(
            of: Transaction_Signer
            if: {Trade: {Side: {Type: {is: sell}}}}
          )
        }
      }
    }`,
    variables: "{}",
  }

  const response = await fetch("https://streaming.bitquery.io/eap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(query),
    timeout: 30000,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`)
  }

  const data = await response.json()

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`)
  }

  if (data.data?.Solana?.DEXTradeByTokens) {
    processBitqueryRealTimeData(data.data.Solana.DEXTradeByTokens)
  } else {
    throw new Error("No DEXTradeByTokens data returned")
  }
}

function processBitqueryRealTimeData(tradeData: any[]) {
  try {
    if (!tradeData || tradeData.length === 0) {
      console.log("[BITQUERY] No trade data for 2-minute window")
      autoSellState.metrics.buyVolumeUsd = 0
      autoSellState.metrics.sellVolumeUsd = 0
      autoSellState.metrics.netUsdFlow = 0
      return
    }

    // Aggregate data from all trade entries
    let totalBuyVolumeUsd = 0
    let totalSellVolumeUsd = 0
    let totalBuys = 0
    let totalSells = 0
    let uniqueBuyers = 0
    let uniqueSellers = 0

    tradeData.forEach((trade) => {
      totalBuyVolumeUsd += Number(trade.buyVolumeUSD || 0)
      totalSellVolumeUsd += Number(trade.sellVolumeUSD || 0)
      totalBuys += Number(trade.totalBuys || 0)
      totalSells += Number(trade.totalSells || 0)
      uniqueBuyers += Number(trade.uniqueBuyers || 0)
      uniqueSellers += Number(trade.uniqueSellers || 0)
    })

    autoSellState.metrics.buyVolumeUsd = totalBuyVolumeUsd
    autoSellState.metrics.sellVolumeUsd = totalSellVolumeUsd
    autoSellState.metrics.netUsdFlow = totalBuyVolumeUsd - totalSellVolumeUsd

    console.log(
      `[BITQUERY] 2-min real-time data - Buy: $${totalBuyVolumeUsd.toFixed(2)} (${totalBuys} trades, ${uniqueBuyers} buyers) | Sell: $${totalSellVolumeUsd.toFixed(2)} (${totalSells} trades, ${uniqueSellers} sellers) | Net: $${(totalBuyVolumeUsd - totalSellVolumeUsd).toFixed(2)}`,
    )
  } catch (error) {
    console.error("[BITQUERY] Error processing real-time data:", error)
    throw error
  }
}

async function collectDexScreenerData() {
  try {
    console.log("[DEXSCREENER] Collecting reliable market data for 2-minute analysis")

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${autoSellState.config.mint}`)
    const data = await response.json()

    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0]
      const priceUsd = Number(pair.priceUsd || 0)
      const volume5m = Number(pair.volume?.m5 || 0)
      const priceChange5m = Number(pair.priceChange?.m5 || 0)

      if (priceUsd > 0) {
        const buyRatio =
          priceChange5m >= 0
            ? Math.min(0.75, 0.5 + priceChange5m / 50) // Positive price change = more buying
            : Math.max(0.25, 0.5 + priceChange5m / 50) // Negative price change = more selling

        // Scale 5-minute volume to 2-minute estimate
        const scaleFactor = 0.4 // 2 minutes / 5 minutes
        const estimatedBuyVolume = volume5m * buyRatio * scaleFactor
        const estimatedSellVolume = volume5m * (1 - buyRatio) * scaleFactor

        autoSellState.metrics.currentPriceUsd = priceUsd
        autoSellState.metrics.currentPrice = priceUsd / autoSellState.metrics.solPriceUsd
        autoSellState.metrics.buyVolumeUsd = estimatedBuyVolume
        autoSellState.metrics.sellVolumeUsd = estimatedSellVolume
        autoSellState.metrics.netUsdFlow = estimatedBuyVolume - estimatedSellVolume

        console.log(
          `[DEXSCREENER] 2-min analysis - Price: $${priceUsd.toFixed(8)} | Buy: $${estimatedBuyVolume.toFixed(2)} | Sell: $${estimatedSellVolume.toFixed(2)} | Net: $${(estimatedBuyVolume - estimatedSellVolume).toFixed(2)} | Price Change 5m: ${priceChange5m.toFixed(2)}%`,
        )
      } else {
        console.log("[DEXSCREENER] No valid price data available")
      }
    } else {
      console.log("[DEXSCREENER] No trading pairs found for token")
    }
  } catch (error) {
    console.error("[DEXSCREENER] Data collection failed:", error)
    throw error
  }
}

async function analyzeAndExecuteAutoSell() {
  try {
    const netUsdFlow = autoSellState.metrics.netUsdFlow
    const minNetFlowUsd = autoSellState.config.minNetFlowUsd
    const cooldownMs = autoSellState.config.cooldownSeconds * 1000
    const currentTime = Date.now()

    console.log(`[AUTO-SELL] Analysis - Net Flow: $${netUsdFlow.toFixed(2)}, Threshold: $${minNetFlowUsd}`)

    // Check if we're in cooldown period
    if (currentTime - autoSellState.metrics.lastSellTrigger < cooldownMs) {
      const remainingCooldown = Math.ceil((cooldownMs - (currentTime - autoSellState.metrics.lastSellTrigger)) / 1000)
      console.log(`[AUTO-SELL] In cooldown period, ${remainingCooldown}s remaining`)
      return
    }

    // Check if net flow is positive and above threshold
    if (netUsdFlow <= minNetFlowUsd) {
      console.log(`[AUTO-SELL] Net flow $${netUsdFlow.toFixed(2)} <= threshold $${minNetFlowUsd}, no sell triggered`)
      return
    }

    console.log(
      `[AUTO-SELL] 🚀 SELL TRIGGER ACTIVATED! Net flow $${netUsdFlow.toFixed(2)} > threshold $${minNetFlowUsd}`,
    )

    // Execute the coordinated sell
    await executeCoordinatedSell(netUsdFlow)
  } catch (error) {
    console.error("[AUTO-SELL] Analysis and execution error:", error)
  }
}

async function executeCoordinatedSell(netUsdFlow: number) {
  try {
    const sellPercentage = autoSellState.config.sellPercentageOfNetFlow
    const usdAmountToSell = (netUsdFlow * sellPercentage) / 100
    const currentPriceUsd = autoSellState.metrics.currentPriceUsd

    if (currentPriceUsd <= 0) {
      console.log("[AUTO-SELL] Invalid current price, skipping sell")
      return
    }

    const tokensToSell = usdAmountToSell / currentPriceUsd

    console.log(
      `[AUTO-SELL] Executing coordinated sell: ${sellPercentage}% of $${netUsdFlow.toFixed(2)} = $${usdAmountToSell.toFixed(2)} (${tokensToSell.toFixed(4)} tokens)`,
    )

    // Get wallets with tokens
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

    // Execute sells across all wallets simultaneously
    const sellPromises = walletsWithTokens.map(async (wallet) => {
      if (Date.now() < wallet.cooldownUntil) return null

      const walletProportion = wallet.tokenBalance / totalTokensHeld
      const walletSellAmount = tokensToSell * walletProportion

      if (walletSellAmount < 0.000001) return null // Minimum sell amount

      try {
        const signature = await executeSell(wallet, walletSellAmount)
        wallet.cooldownUntil = Date.now() + 30000 // 30 second wallet cooldown

        const estimatedSolReceived = walletSellAmount * autoSellState.metrics.currentPrice
        const estimatedUsdValue = walletSellAmount * currentPriceUsd

        console.log(
          `[AUTO-SELL] ✅ ${wallet.name} sold ${walletSellAmount.toFixed(4)} tokens for ~${estimatedSolReceived.toFixed(4)} SOL (~$${estimatedUsdValue.toFixed(2)} USD), sig: ${signature}`,
        )

        return { wallet: wallet.name, amount: walletSellAmount, usdValue: estimatedUsdValue, signature }
      } catch (error) {
        console.error(`[AUTO-SELL] ❌ ${wallet.name} sell failed:`, error)
        return null
      }
    })

    // Wait for all sells to complete
    const results = await Promise.all(sellPromises)
    const successfulSells = results.filter((result) => result !== null)

    if (successfulSells.length > 0) {
      const totalSold = successfulSells.reduce((sum, result) => sum + result.amount, 0)
      const totalUsdValue = successfulSells.reduce((sum, result) => sum + result.usdValue, 0)

      autoSellState.metrics.lastSellTrigger = Date.now()
      autoSellState.metrics.totalSold += totalSold

      console.log(
        `[AUTO-SELL] 🎯 COORDINATED SELL COMPLETE! Total: ${totalSold.toFixed(4)} tokens worth $${totalUsdValue.toFixed(2)} USD across ${successfulSells.length} wallets`,
      )
    } else {
      console.log("[AUTO-SELL] No successful sells executed")
    }
  } catch (error) {
    console.error("[AUTO-SELL] Coordinated sell execution error:", error)
  }
}

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

    // Get token balance with better error handling
    try {
      const mintPubkey = new PublicKey(autoSellState.config.mint)
      const ata = await getAssociatedTokenAddress(mintPubkey, wallet.keypair.publicKey)

      // Check if token account exists first
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

// Export the state for status endpoint
export { autoSellState }
