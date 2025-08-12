import { type NextRequest, NextResponse } from "next/server"

// Global state for the auto-sell engine
const autoSellState = {
  isRunning: false,
  config: null as any,
  wallets: [] as any[],
  buyTransactions: [] as any[], // Store actual buy transactions from wallets
  metrics: { totalBought: 0, totalSold: 0, avgBuyPrice: 0, currentPrice: 0, unrealizedPnL: 0 },
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
          buyHistory: [], // Store buy transactions for this wallet
          avgBuyPrice: 0,
          totalBought: 0,
          totalSold: 0,
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
    autoSellState.config = config
    autoSellState.wallets = wallets
    autoSellState.buyTransactions = []
    autoSellState.isRunning = true

    // Start monitoring and execution intervals
    startAutoSellEngine()

    return NextResponse.json({
      success: true,
      message: `Auto-sell engine started with ${wallets.length} wallets`,
      config: config,
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

  const transactionMonitorInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await monitorWalletTransactions()
    } catch (error) {
      console.error("Transaction monitoring error:", error)
    }
  }, 10000) // Check every 10 seconds

  // Auto-sell execution interval (every 15 seconds)
  const executionInterval = setInterval(async () => {
    if (!autoSellState.isRunning) return

    try {
      await executeAutoSell()
    } catch (error) {
      console.error("Auto-sell execution error:", error)
    }
  }, 15000)

  autoSellState.intervals.push(transactionMonitorInterval, executionInterval)
}

async function monitorWalletTransactions() {
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js")

    const connection = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ||
        process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
        "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
      { commitment: "confirmed" },
    )

    for (const wallet of autoSellState.wallets) {
      try {
        // Get recent transactions for this wallet
        const signatures = await connection.getSignaturesForAddress(
          wallet.keypair.publicKey,
          { limit: 10 },
          "confirmed",
        )

        // Check for new transactions since last check
        for (const sigInfo of signatures) {
          if (sigInfo.signature === wallet.lastTransactionSignature) break

          // Get transaction details
          const tx = await connection.getParsedTransaction(sigInfo.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })

          if (!tx || tx.meta?.err) continue

          const tokenPurchase = analyzeTransactionForTokenPurchase(tx, autoSellState.config.mint, wallet.publicKey)

          if (tokenPurchase) {
            // Record the buy transaction
            const buyRecord = {
              signature: sigInfo.signature,
              timestamp: sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now(),
              walletAddress: wallet.publicKey,
              solSpent: tokenPurchase.solSpent,
              tokensReceived: tokenPurchase.tokensReceived,
              pricePerToken: tokenPurchase.solSpent / tokenPurchase.tokensReceived,
            }

            wallet.buyHistory.push(buyRecord)
            autoSellState.buyTransactions.push(buyRecord)

            // Update wallet metrics
            wallet.totalBought += tokenPurchase.tokensReceived
            wallet.avgBuyPrice =
              wallet.buyHistory.reduce((sum, buy) => sum + buy.pricePerToken, 0) / wallet.buyHistory.length

            console.log(
              `[BUY DETECTED] ${wallet.name}: ${tokenPurchase.tokensReceived.toFixed(4)} tokens for ${tokenPurchase.solSpent.toFixed(4)} SOL`,
            )
          }
        }

        // Update last transaction signature
        if (signatures.length > 0) {
          wallet.lastTransactionSignature = signatures[0].signature
        }
      } catch (error) {
        console.error(`Error monitoring wallet ${wallet.name}:`, error)
      }
    }

    // Update global metrics
    updateGlobalMetrics()
  } catch (error) {
    console.error("Wallet transaction monitoring error:", error)
  }
}

function analyzeTransactionForTokenPurchase(tx: any, targetMint: string, walletAddress: string) {
  try {
    if (!tx.meta || !tx.transaction) return null

    const preBalances = tx.meta.preBalances
    const postBalances = tx.meta.postBalances
    const accountKeys = tx.transaction.message.accountKeys

    // Find wallet's SOL balance change (should decrease for a buy)
    let walletIndex = -1
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys[i].pubkey === walletAddress) {
        walletIndex = i
        break
      }
    }

    if (walletIndex === -1) return null

    const solChange = (postBalances[walletIndex] - preBalances[walletIndex]) / 1e9

    // If SOL increased or stayed same, this wasn't a buy
    if (solChange >= -0.001) return null // Allow for small fees

    // Look for token account changes
    const tokenChanges =
      tx.meta.postTokenBalances?.filter(
        (balance: any) => balance.mint === targetMint && balance.owner === walletAddress,
      ) || []

    const preTokenBalances =
      tx.meta.preTokenBalances?.filter(
        (balance: any) => balance.mint === targetMint && balance.owner === walletAddress,
      ) || []

    if (tokenChanges.length === 0) return null

    const postTokenAmount = tokenChanges[0]?.uiTokenAmount?.uiAmount || 0
    const preTokenAmount = preTokenBalances[0]?.uiTokenAmount?.uiAmount || 0
    const tokensReceived = postTokenAmount - preTokenAmount

    if (tokensReceived <= 0) return null

    return {
      solSpent: Math.abs(solChange),
      tokensReceived,
    }
  } catch (error) {
    console.error("Error analyzing transaction:", error)
    return null
  }
}

function updateGlobalMetrics() {
  const totalBought = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.totalBought, 0)
  const totalSold = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.totalSold, 0)

  // Calculate weighted average buy price
  let totalValue = 0
  let totalTokens = 0

  for (const wallet of autoSellState.wallets) {
    for (const buy of wallet.buyHistory) {
      totalValue += buy.solSpent
      totalTokens += buy.tokensReceived
    }
  }

  const avgBuyPrice = totalTokens > 0 ? totalValue / totalTokens : 0

  autoSellState.metrics = {
    totalBought,
    totalSold,
    avgBuyPrice,
    currentPrice: autoSellState.metrics.currentPrice, // Keep current price from price updates
    unrealizedPnL: 0, // Will be calculated when we get current price
  }
}

async function executeAutoSell() {
  try {
    // Update current token price
    await updateCurrentPrice()

    const totalTokensHeld = autoSellState.wallets.reduce((sum, wallet) => sum + wallet.tokenBalance, 0)

    if (totalTokensHeld <= 0) {
      console.log("[AUTO-SELL] No tokens held, skipping sell check")
      return
    }

    // Calculate profit potential
    const avgBuyPrice = autoSellState.metrics.avgBuyPrice
    const currentPrice = autoSellState.metrics.currentPrice

    if (avgBuyPrice <= 0 || currentPrice <= 0) {
      console.log("[AUTO-SELL] Invalid prices, skipping sell check")
      return
    }

    const profitPercentage = ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100

    const minProfitThreshold = autoSellState.config.minProfitPercent || 5 // 5% minimum profit

    if (profitPercentage < minProfitThreshold) {
      console.log(`[AUTO-SELL] Not profitable enough: ${profitPercentage.toFixed(2)}% < ${minProfitThreshold}%`)
      return
    }

    console.log(`[AUTO-SELL] Profitable opportunity: ${profitPercentage.toFixed(2)}% profit`)

    // Execute sells for eligible wallets that have tokens
    for (const wallet of autoSellState.wallets) {
      if (Date.now() < wallet.cooldownUntil) continue
      if (wallet.tokenBalance <= 0) continue

      // Update wallet balances first
      await updateWalletBalances(wallet)

      if (wallet.tokenBalance <= 0) continue

      const sellPercentage = autoSellState.config.sellPercentage || 25 // Default 25%
      const tokensToSell = (wallet.tokenBalance * sellPercentage) / 100

      if (tokensToSell < 0.000001) continue // Minimum sell amount

      try {
        const signature = await executeSell(wallet, tokensToSell)
        wallet.lastTransactionSignature = signature
        wallet.cooldownUntil = Date.now() + autoSellState.config.cooldownSeconds * 1000
        wallet.totalSold += tokensToSell

        console.log(
          `[AUTO-SELL] ${wallet.name} sold ${tokensToSell.toFixed(4)} tokens for ${profitPercentage.toFixed(2)}% profit, sig: ${signature}`,
        )
      } catch (error) {
        console.error(`[AUTO-SELL ERROR] ${wallet.name}:`, error)
      }
    }
  } catch (error) {
    console.error("Auto-sell execution error:", error)
  }
}

async function updateCurrentPrice() {
  try {
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${autoSellState.config.mint}`)
    const data = await response.json()

    if (Array.isArray(data) && data.length > 0) {
      const pairs = data.sort((a: any, b: any) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))
      const pair = pairs[0]
      const priceUsd = Number(pair?.priceUsd || 0)

      if (priceUsd > 0) {
        // Convert USD price to SOL price (approximate)
        const solPriceUsd = 100 // Approximate SOL price, could fetch this too
        autoSellState.metrics.currentPrice = priceUsd / solPriceUsd
      }
    }
  } catch (error) {
    console.error("Error updating current price:", error)
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
      slippageBps: autoSellState.config.slippageBps,
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

  // Try bloXroute first, fallback to RPC
  const auth = process.env.BLOXROUTE_API_KEY
  if (auth) {
    try {
      const content = Buffer.from(tx.serialize()).toString("base64")
      const region = process.env.BLOXROUTE_REGION || "ny"
      const url = `http://${region}.solana.dex.blxrbdn.com/api/v2/submit`

      const response = await axios.default.post(
        url,
        {
          transaction: { content },
          skipPreFlight: true,
        },
        {
          headers: { Authorization: auth },
        },
      )

      return response.data?.signature || "unknown"
    } catch (error) {
      console.error("bloXroute submission failed, falling back to RPC:", error)
    }
  }

  // Fallback to RPC
  const signature = await connection.sendTransaction(tx, { skipPreflight: true })
  await connection.confirmTransaction(signature, "confirmed")
  return signature
}

// Export the state for status endpoint
export { autoSellState }
