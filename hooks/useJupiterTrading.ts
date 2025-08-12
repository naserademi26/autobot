"use client"

import { useState, useCallback } from "react"
import { Connection, type Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { useToast } from "@/hooks/use-toast"
import { Buffer } from "buffer"

interface TradeResult {
  success: boolean
  signature?: string
  error?: string
  profit?: number
  errorCode?: string
  detailedError?: string
}

interface JupiterTransaction {
  id: string
  type: "buy" | "sell"
  walletId: string
  amount: number
  tokenMint: string
  signature?: string
  timestamp: Date
  status: "pending" | "success" | "failed"
  error?: string
  errorCode?: string
  detailedError?: string
}

interface WalletInfo {
  id: string
  name: string
  publicKey: PublicKey | null
  keypair: Keypair
  balance: number
  connected: boolean
}

interface JupiterQuote {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  platformFee?: any
  priceImpactPct: string
  routePlan: any[]
}

// Premium RPC endpoints with updated API keys
const PREMIUM_RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://api.mainnet-beta.solana.com",
]

// Jupiter API configuration
const JUPITER_API_BASE = "https://quote-api.jup.ag/v6"
const JUPITER_API_KEY = "da460be6-fe88-454d-a927-f4f89fb51a6d"

// Enhanced sound notification functions
const playSuccessSound = () => {
  try {
    // Use Web Audio API instead of accessing cross-origin frames
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.setValueAtTime(523, audioContext.currentTime)
    oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1)
    oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2)

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4)

    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.4)

    console.log("🎵 Success sound played")
  } catch (error) {
    console.log("Success sound failed:", error)
  }
}

const playErrorSound = () => {
  try {
    // Use Web Audio API instead of accessing cross-origin frames
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.setValueAtTime(400, audioContext.currentTime)
    oscillator.frequency.setValueAtTime(300, audioContext.currentTime + 0.2)
    oscillator.frequency.setValueAtTime(200, audioContext.currentTime + 0.4)

    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6)

    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.6)

    console.log("🔊 Error sound played")
  } catch (error) {
    console.log("Error sound failed:", error)
  }
}

export function useJupiterTrading() {
  const { toast } = useToast()
  const [isTrading, setIsTrading] = useState(false)
  const [transactions, setTransactions] = useState<JupiterTransaction[]>([])
  const [autoSlippage, setAutoSlippage] = useState(80)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get premium connection
  const getConnection = useCallback(() => {
    return new Connection(PREMIUM_RPC_ENDPOINTS[0], {
      commitment: "processed",
      confirmTransactionInitialTimeout: 30000,
      wsEndpoint: undefined,
      disableRetryOnRateLimit: false,
      httpHeaders: {
        "Content-Type": "application/json",
        "User-Agent": "UltraFastTradingBot/3.0",
        "Cache-Control": "no-cache",
      },
    })
  }, [])

  // Add transaction to history
  const addTransaction = useCallback((transaction: Omit<JupiterTransaction, "id" | "timestamp">) => {
    const newTransaction: JupiterTransaction = {
      ...transaction,
      id: Date.now().toString(),
      timestamp: new Date(),
    }
    setTransactions((prev) => [newTransaction, ...prev.slice(0, 99)])
    return newTransaction.id
  }, [])

  // Update transaction status
  const updateTransaction = useCallback((id: string, updates: Partial<JupiterTransaction>) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)))
  }, [])

  // ULTRA-FAST Jupiter buy function with FIXED fee configuration
  const buyToken = useCallback(
    async (
      walletInfo: WalletInfo,
      tokenMint: string,
      amount: number,
      useMaxSlippage = true,
      updateSingleWallet?: (walletId: string, publicKey: any) => Promise<void>,
    ): Promise<TradeResult> => {
      console.log(`🚀 ULTRA-FAST BUY: ${amount} SOL for token ${tokenMint}`)
      console.log(`💰 Wallet: ${walletInfo.name} (${walletInfo.publicKey?.toString()})`)
      console.log(`💰 Balance: ${walletInfo.balance} SOL`)

      // Enhanced validation
      if (!walletInfo.connected || !walletInfo.publicKey || !walletInfo.keypair) {
        const error = `Wallet ${walletInfo.name} not properly connected`
        console.error(`❌ ${error}`)
        playErrorSound()
        return { success: false, error, errorCode: "WALLET_NOT_CONNECTED", detailedError: error }
      }

      if (amount <= 0 || amount > 10) {
        const error = `Invalid buy amount: ${amount} SOL`
        console.error(`❌ ${error}`)
        playErrorSound()
        return { success: false, error, errorCode: "INVALID_AMOUNT", detailedError: error }
      }

      if (walletInfo.balance < amount + 0.01) {
        const error = `Insufficient balance: ${walletInfo.balance.toFixed(4)} SOL available, need ${(amount + 0.01).toFixed(4)} SOL`
        console.error(`❌ ${error}`)
        playErrorSound()
        return { success: false, error, errorCode: "INSUFFICIENT_BALANCE", detailedError: error }
      }

      const transactionId = addTransaction({
        type: "buy",
        walletId: walletInfo.id,
        amount,
        tokenMint,
        status: "pending",
      })

      try {
        const connection = getConnection()
        const slippageBps = Math.max(autoSlippage * 100, 5000) // Minimum 50% slippage for speed
        const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL)

        console.log(`⚡ Step 1: Getting Jupiter quote with ULTRA-HIGH slippage...`)
        console.log(`📊 Input: ${amountLamports} lamports (${amount} SOL)`)
        console.log(`📊 Output mint: ${tokenMint}`)
        console.log(`📊 Slippage: ${slippageBps / 100}% (ULTRA-HIGH for speed)`)

        // Step 1: Get Jupiter quote with ultra-fast settings and API key
        const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenMint}&amount=${amountLamports}&slippageBps=${slippageBps}&onlyDirectRoutes=true&maxAccounts=20`
        console.log(`🔗 Quote URL: ${quoteUrl}`)

        const quoteResponse = await Promise.race([
          fetch(quoteUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "UltraFastBot/2.0",
              "Cache-Control": "no-cache",
              "X-API-Key": JUPITER_API_KEY,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Quote timeout - Jupiter API too slow")), 10000),
          ),
        ])

        console.log(`📡 Quote response status: ${quoteResponse.status}`)

        if (!quoteResponse.ok) {
          const errorText = await quoteResponse.text()
          console.error(`❌ Quote failed: ${errorText}`)
          throw new Error(`Quote failed: ${quoteResponse.status} - ${errorText}`)
        }

        const quoteData = await quoteResponse.json()
        console.log(`📊 Quote received:`, quoteData)

        if (!quoteData || quoteData.error || !quoteData.outAmount || quoteData.outAmount === "0") {
          throw new Error(`No liquidity or invalid quote: ${quoteData?.error || "No output amount"}`)
        }

        const outputTokens = Number.parseInt(quoteData.outAmount) / Math.pow(10, 6)
        console.log(`✅ Quote OK: Will receive ~${outputTokens.toFixed(2)} tokens`)

        console.log(`⚡ Step 2: Getting swap transaction with ULTRA-HIGH priority...`)

        // Step 2: Get swap transaction with FIXED fee configuration (only prioritizationFeeLamports)
        const swapPayload = {
          quoteResponse: quoteData,
          userPublicKey: walletInfo.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: "auto",
          skipUserAccountsRpcCalls: true,
          asLegacyTransaction: false,
          useTokenLedger: false,
          destinationTokenAccount: undefined,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: { maxBps: slippageBps },
        }

        console.log(`📤 Swap payload with FIXED fees:`, swapPayload)

        const swapResponse = await Promise.race([
          fetch(`${JUPITER_API_BASE}/swap`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "UltraFastBot/2.0",
              "Cache-Control": "no-cache",
              "X-API-Key": JUPITER_API_KEY,
            },
            body: JSON.stringify(swapPayload),
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Swap timeout - Jupiter API too slow")), 15000),
          ),
        ])

        console.log(`📡 Swap response status: ${swapResponse.status}`)

        if (!swapResponse.ok) {
          const errorText = await swapResponse.text()
          console.error(`❌ Swap failed: ${errorText}`)
          throw new Error(`Swap failed: ${swapResponse.status} - ${errorText}`)
        }

        const swapData = await swapResponse.json()
        console.log(`📊 Swap data received`)

        if (!swapData.swapTransaction) {
          throw new Error("No swap transaction received from Jupiter")
        }

        console.log(`⚡ Step 3: Signing and sending with PREMIUM RPC...`)

        // Step 3: Sign and send with premium RPC for maximum speed
        const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64")
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

        console.log(`✍️ Signing transaction...`)
        transaction.sign([walletInfo.keypair])

        console.log(`📤 Sending to PREMIUM RPC...`)

        // Send with ultra-fast settings
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true, // Skip all checks for maximum speed
          preflightCommitment: "processed",
          maxRetries: 0, // No retries for speed
        })

        console.log(`📡 Transaction sent: ${signature}`)
        console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`)

        console.log(`⏳ Confirming with premium RPC...`)

        // Step 4: Fast confirmation with premium RPC
        const confirmation = await Promise.race([
          connection.confirmTransaction(signature, "processed"), // Use processed for speed
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Confirmation timeout")), 30000)),
        ])

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
        }

        console.log(`🎉 ULTRA-FAST BUY SUCCESS!`)
        console.log(`✅ Confirmed: ${signature}`)
        console.log(`💰 Bought ~${outputTokens.toFixed(2)} tokens for ${amount} SOL`)

        updateTransaction(transactionId, {
          status: "success",
          signature,
          detailedError: `SUCCESS: Bought ~${outputTokens.toFixed(2)} tokens`,
        })

        playSuccessSound()
        toast({
          title: "🎉 ULTRA-FAST BUY SUCCESS!",
          description: `${walletInfo.name}: Bought ~${outputTokens.toFixed(2)} tokens for ${amount} SOL`,
        })

        // Update wallet balance
        if (updateSingleWallet) {
          setTimeout(() => updateSingleWallet(walletInfo.id, walletInfo.publicKey), 2000)
        }

        return {
          success: true,
          signature,
          detailedError: `SUCCESS: Bought ~${outputTokens.toFixed(2)} tokens for ${amount} SOL`,
        }
      } catch (error: any) {
        const detailedError = `BUY FAILED for ${walletInfo.name}: ${error.message}`
        console.error(`❌ ${detailedError}`)

        let errorCode = "UNKNOWN_ERROR"
        if (error.message.includes("timeout")) errorCode = "TIMEOUT"
        else if (error.message.includes("slippage")) errorCode = "SLIPPAGE_EXCEEDED"
        else if (error.message.includes("liquidity")) errorCode = "NO_LIQUIDITY"
        else if (error.message.includes("balance")) errorCode = "INSUFFICIENT_BALANCE"
        else if (error.message.includes("Quote")) errorCode = "QUOTE_FAILED"
        else if (error.message.includes("Swap")) errorCode = "SWAP_FAILED"

        updateTransaction(transactionId, {
          status: "failed",
          error: error.message,
          errorCode,
          detailedError,
        })

        playErrorSound()
        toast({
          title: "❌ BUY FAILED",
          description: detailedError,
          variant: "destructive",
        })

        return {
          success: false,
          error: error.message,
          errorCode,
          detailedError,
        }
      }
    },
    [getConnection, addTransaction, updateTransaction, toast, autoSlippage],
  )

  // ULTRA-FAST Jupiter sell function with FIXED fee configuration
  const sellToken = useCallback(
    async (
      walletInfo: WalletInfo,
      tokenMint: string,
      percentage: number,
      useMaxSlippage = true,
      updateSingleWallet?: (walletId: string, publicKey: any) => Promise<void>,
    ): Promise<TradeResult> => {
      console.log(`🚀 ULTRA-FAST SELL: ${percentage}% of token ${tokenMint}`)
      console.log(`💰 Wallet: ${walletInfo.name}`)

      if (!walletInfo.connected || !walletInfo.publicKey || !walletInfo.keypair) {
        const error = `Wallet ${walletInfo.name} not connected`
        console.error(`❌ ${error}`)
        playErrorSound()
        return { success: false, error, errorCode: "WALLET_NOT_CONNECTED", detailedError: error }
      }

      if (percentage <= 0 || percentage > 100) {
        const error = `Invalid sell percentage: ${percentage}%`
        console.error(`❌ ${error}`)
        playErrorSound()
        return { success: false, error, errorCode: "INVALID_PERCENTAGE", detailedError: error }
      }

      const transactionId = addTransaction({
        type: "sell",
        walletId: walletInfo.id,
        amount: percentage,
        tokenMint,
        status: "pending",
      })

      try {
        const connection = getConnection()

        console.log(`⚡ Step 1: Getting token balance with premium RPC...`)

        // Step 1: Get token balance with premium RPC
        const tokenAccounts = await Promise.race([
          connection.getParsedTokenAccountsByOwner(walletInfo.publicKey, {
            mint: new PublicKey(tokenMint),
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Token balance timeout")), 10000)),
        ])

        console.log(`📊 Token accounts found: ${tokenAccounts.value.length}`)

        if (tokenAccounts.value.length === 0) {
          throw new Error(`No token accounts found for ${tokenMint}`)
        }

        const tokenAccount = tokenAccounts.value[0]
        const tokenBalance = tokenAccount.account.data.parsed.info.tokenAmount
        const rawBalance = tokenBalance.amount
        const decimals = tokenBalance.decimals
        const uiBalance = tokenBalance.uiAmount

        console.log(`💰 Token balance: ${uiBalance} tokens`)

        const sellAmountRaw = Math.floor((Number.parseInt(rawBalance) * percentage) / 100)
        const sellAmountUI = (uiBalance * percentage) / 100

        console.log(`📊 Selling: ${sellAmountUI.toFixed(6)} tokens`)

        if (sellAmountRaw <= 0) {
          throw new Error(`No tokens to sell. Balance: ${uiBalance}`)
        }

        console.log(`⚡ Step 2: Getting sell quote with ULTRA-HIGH slippage...`)

        // Step 2: Get sell quote with ultra-high slippage and API key
        const slippageBps = Math.max(autoSlippage * 100, 5000) // Minimum 50% slippage
        const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=${tokenMint}&outputMint=So11111111111111111111111111111111111111112&amount=${sellAmountRaw}&slippageBps=${slippageBps}&onlyDirectRoutes=true&maxAccounts=20`

        console.log(`🔗 Sell quote URL: ${quoteUrl}`)

        const quoteResponse = await Promise.race([
          fetch(quoteUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "UltraFastBot/2.0",
              "Cache-Control": "no-cache",
              "X-API-Key": JUPITER_API_KEY,
            },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sell quote timeout")), 10000)),
        ])

        console.log(`📡 Sell quote status: ${quoteResponse.status}`)

        if (!quoteResponse.ok) {
          const errorText = await quoteResponse.text()
          console.error(`❌ Sell quote failed: ${errorText}`)
          throw new Error(`Sell quote failed: ${quoteResponse.status}`)
        }

        const quoteData = await quoteResponse.json()
        console.log(`📊 Sell quote received`)

        if (!quoteData || quoteData.error || !quoteData.outAmount) {
          throw new Error(`Sell quote error: ${quoteData?.error || "No output"}`)
        }

        const outputSOL = Number.parseInt(quoteData.outAmount) / LAMPORTS_PER_SOL
        console.log(`✅ Will receive ${outputSOL.toFixed(6)} SOL`)

        console.log(`⚡ Step 3: Getting sell swap with ULTRA-HIGH priority...`)

        // Step 3: Get sell swap transaction with FIXED fee configuration
        const swapPayload = {
          quoteResponse: quoteData,
          userPublicKey: walletInfo.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: "auto",
          skipUserAccountsRpcCalls: true,
          asLegacyTransaction: false,
          useTokenLedger: false,
          destinationTokenAccount: undefined,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: { maxBps: slippageBps },
        }

        const swapResponse = await Promise.race([
          fetch(`${JUPITER_API_BASE}/swap`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "UltraFastBot/2.0",
              "Cache-Control": "no-cache",
              "X-API-Key": JUPITER_API_KEY,
            },
            body: JSON.stringify(swapPayload),
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sell swap timeout")), 15000)),
        ])

        if (!swapResponse.ok) {
          const errorText = await swapResponse.text()
          console.error(`❌ Sell swap failed: ${errorText}`)
          throw new Error(`Sell swap failed: ${swapResponse.status}`)
        }

        const swapData = await swapResponse.json()
        if (!swapData.swapTransaction) {
          throw new Error("No sell swap transaction received")
        }

        console.log(`⚡ Step 4: Signing and sending sell with premium RPC...`)

        // Step 4: Sign and send sell transaction
        const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64")
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf)
        transaction.sign([walletInfo.keypair])

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true,
          preflightCommitment: "processed",
          maxRetries: 0,
        })

        console.log(`📡 Sell transaction sent: ${signature}`)
        console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`)

        // Confirm transaction
        const confirmation = await Promise.race([
          connection.confirmTransaction(signature, "processed"),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sell confirmation timeout")), 30000)),
        ])

        if (confirmation.value.err) {
          throw new Error(`Sell transaction failed: ${JSON.stringify(confirmation.value.err)}`)
        }

        console.log(`🎉 ULTRA-FAST SELL SUCCESS!`)
        console.log(`✅ Sold ${sellAmountUI.toFixed(6)} tokens for ${outputSOL.toFixed(6)} SOL`)

        updateTransaction(transactionId, {
          status: "success",
          signature,
          profit: outputSOL,
          detailedError: `SUCCESS: Sold ${sellAmountUI.toFixed(6)} tokens for ${outputSOL.toFixed(6)} SOL`,
        })

        playSuccessSound()
        toast({
          title: "🎉 ULTRA-FAST SELL SUCCESS!",
          description: `${walletInfo.name}: Sold ${sellAmountUI.toFixed(6)} tokens for ${outputSOL.toFixed(6)} SOL`,
        })

        // Update wallet balance
        if (updateSingleWallet) {
          setTimeout(() => updateSingleWallet(walletInfo.id, walletInfo.publicKey), 2000)
        }

        return {
          success: true,
          signature,
          profit: outputSOL,
          detailedError: `SUCCESS: Sold ${sellAmountUI.toFixed(6)} tokens for ${outputSOL.toFixed(6)} SOL`,
        }
      } catch (error: any) {
        const detailedError = `SELL FAILED for ${walletInfo.name}: ${error.message}`
        console.error(`❌ ${detailedError}`)

        let errorCode = "UNKNOWN_ERROR"
        if (error.message.includes("timeout")) errorCode = "TIMEOUT"
        else if (error.message.includes("No token accounts")) errorCode = "NO_TOKENS"
        else if (error.message.includes("No tokens to sell")) errorCode = "INSUFFICIENT_TOKENS"
        else if (error.message.includes("quote")) errorCode = "QUOTE_FAILED"

        updateTransaction(transactionId, {
          status: "failed",
          error: error.message,
          errorCode,
          detailedError,
        })

        playErrorSound()
        toast({
          title: "❌ SELL FAILED",
          description: detailedError,
          variant: "destructive",
        })

        return {
          success: false,
          error: error.message,
          errorCode,
          detailedError,
        }
      }
    },
    [getConnection, addTransaction, updateTransaction, toast, autoSlippage],
  )

  // Execute bulk trades with ultra-fast settings
  const executeBulkTrade = useCallback(
    async ({
      wallets,
      walletInfos,
      tokenMint,
      amount,
      type,
      onSuccess,
      updateSingleWallet,
    }: {
      wallets: string[]
      walletInfos: WalletInfo[]
      tokenMint: string
      amount: number
      type: "buy" | "sell"
      onSuccess?: (walletId: string, profit: number) => void
      updateSingleWallet?: (walletId: string, publicKey: any) => Promise<void>
    }) => {
      setIsTrading(true)
      console.log(`🔥 ULTRA-FAST BULK ${type.toUpperCase()}: ${walletInfos.length} wallets`)

      try {
        const results = []
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < walletInfos.length; i++) {
          const walletInfo = walletInfos[i]

          try {
            console.log(`⚡ Processing ${i + 1}/${walletInfos.length}: ${walletInfo.name}`)

            const result =
              type === "buy"
                ? await buyToken(walletInfo, tokenMint, amount, true, updateSingleWallet)
                : await sellToken(walletInfo, tokenMint, amount, true, updateSingleWallet)

            if (result.success) {
              successCount++
              if (result.profit && onSuccess) {
                onSuccess(walletInfo.id, result.profit)
              }
            } else {
              failCount++
            }

            results.push({ walletId: walletInfo.id, success: result.success, ...result })

            // Minimal delay for ultra-fast execution
            if (i < walletInfos.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
          } catch (error: any) {
            console.error(`❌ ${type} failed for ${walletInfo.name}:`, error)
            failCount++
            results.push({ walletId: walletInfo.id, success: false, error: error.message })
          }
        }

        console.log(`✅ ULTRA-FAST BULK ${type.toUpperCase()} COMPLETE: ${successCount}/${walletInfos.length}`)

        if (successCount > 0) {
          playSuccessSound()
        } else {
          playErrorSound()
        }

        toast({
          title: `🎯 Ultra-Fast Bulk ${type.toUpperCase()} Complete`,
          description: `${successCount} successful, ${failCount} failed out of ${walletInfos.length} transactions`,
          variant: successCount > 0 ? "default" : "destructive",
        })

        return results
      } catch (error: any) {
        console.error(`❌ Bulk ${type} failed:`, error)
        playErrorSound()
        toast({
          title: `❌ Bulk ${type.toUpperCase()} Failed`,
          description: error.message,
          variant: "destructive",
        })
        throw error
      } finally {
        setIsTrading(false)
      }
    },
    [buyToken, sellToken, toast],
  )

  // Execute random trades with ultra-fast settings
  const executeRandomTrade = useCallback(
    async ({
      wallets,
      walletInfos,
      tokenMint,
      type,
      minAmount,
      maxAmount,
      onSuccess,
      updateSingleWallet,
    }: {
      wallets: string[]
      walletInfos: WalletInfo[]
      tokenMint: string
      type: "buy" | "sell"
      minAmount: number
      maxAmount: number
      onSuccess?: (walletId: string, profit: number) => void
      updateSingleWallet?: (walletId: string, publicKey: any) => Promise<void>
    }) => {
      setIsTrading(true)
      console.log(`🎲 ULTRA-FAST RANDOM ${type.toUpperCase()}: ${walletInfos.length} wallets`)

      try {
        const results = []
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < walletInfos.length; i++) {
          const walletInfo = walletInfos[i]
          const randomAmount = Math.random() * (maxAmount - minAmount) + minAmount

          try {
            const result =
              type === "buy"
                ? await buyToken(walletInfo, tokenMint, randomAmount, true, updateSingleWallet)
                : await sellToken(walletInfo, tokenMint, randomAmount, true, updateSingleWallet)

            if (result.success) {
              successCount++
              if (result.profit && onSuccess) {
                onSuccess(walletInfo.id, result.profit)
              }
            } else {
              failCount++
            }

            results.push({ walletId: walletInfo.id, success: result.success, amount: randomAmount, ...result })

            // Minimal delay for ultra-fast execution
            if (i < walletInfos.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 750))
            }
          } catch (error: any) {
            failCount++
            results.push({ walletId: walletInfo.id, success: false, error: error.message })
          }
        }

        if (successCount > 0) {
          playSuccessSound()
        } else {
          playErrorSound()
        }

        toast({
          title: `🎲 Ultra-Fast Random ${type.toUpperCase()} Complete`,
          description: `${successCount} successful, ${failCount} failed out of ${walletInfos.length} transactions`,
          variant: successCount > 0 ? "default" : "destructive",
        })

        return results
      } catch (error: any) {
        console.error(`❌ Random ${type} failed:`, error)
        playErrorSound()
        toast({
          title: `❌ Random ${type.toUpperCase()} Failed`,
          description: error.message,
          variant: "destructive",
        })
        throw error
      } finally {
        setIsTrading(false)
      }
    },
    [buyToken, sellToken, toast],
  )

  const clearTransactions = useCallback(() => {
    setTransactions([])
  }, [])

  const getQuote = useCallback(
    async (inputMint: string, outputMint: string, amount: number, slippageBps = 500): Promise<JupiterQuote | null> => {
      try {
        setError(null)

        const response = await fetch(
          `${JUPITER_API_BASE}/quote?` +
            `inputMint=${inputMint}&` +
            `outputMint=${outputMint}&` +
            `amount=${amount}&` +
            `slippageBps=${slippageBps}`,
          {
            headers: {
              "X-API-Key": JUPITER_API_KEY,
            },
          },
        )

        if (!response.ok) {
          throw new Error(`Quote API error: ${response.status}`)
        }

        const quote = await response.json()
        return quote
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to get quote"
        setError(errorMessage)
        return null
      }
    },
    [],
  )

  const getSwapTransaction = useCallback(async (quote: JupiterQuote, userPublicKey: string): Promise<string | null> => {
    try {
      setError(null)

      const response = await fetch(`${JUPITER_API_BASE}/swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": JUPITER_API_KEY,
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
          useTokenLedger: false,
          destinationTokenAccount: undefined,
        }),
      })

      if (!response.ok) {
        throw new Error(`Swap API error: ${response.status}`)
      }

      const { swapTransaction } = await response.json()
      return swapTransaction
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to get swap transaction"
      setError(errorMessage)
      return null
    }
  }, [])

  const executeSwap = useCallback(
    async (
      inputMint: string,
      outputMint: string,
      amount: number,
      userPublicKey: string,
      signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>,
      slippageBps = 500,
    ) => {
      setLoading(true)
      setError(null)

      try {
        // Get quote
        const quote = await getQuote(inputMint, outputMint, amount, slippageBps)
        if (!quote) {
          throw new Error("Failed to get quote")
        }

        // Get swap transaction
        const swapTransactionBase64 = await getSwapTransaction(quote, userPublicKey)
        if (!swapTransactionBase64) {
          throw new Error("Failed to get swap transaction")
        }

        // Deserialize transaction
        const swapTransactionBuf = Buffer.from(swapTransactionBase64, "base64")
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

        // Create connection with fallback RPC endpoints
        const rpcEndpoints = [
          process.env.NEXT_PUBLIC_RPC_URL ||
            "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
          "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
          "https://api.mainnet-beta.solana.com",
          "https://rpc.ankr.com/solana",
        ]

        let connection: Connection | null = null
        for (const endpoint of rpcEndpoints) {
          try {
            connection = new Connection(endpoint, { commitment: "confirmed" })
            await connection.getSlot() // Test connection
            break
          } catch (error) {
            continue
          }
        }

        if (!connection) {
          throw new Error("All RPC endpoints failed")
        }

        // Sign transaction
        const signedTransaction = await signTransaction(transaction)

        // Send transaction
        const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        })

        // Confirm transaction
        await connection.confirmTransaction(signature, "confirmed")

        return {
          success: true,
          signature,
          quote,
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Swap failed"
        setError(errorMessage)
        return {
          success: false,
          error: errorMessage,
        }
      } finally {
        setLoading(false)
      }
    },
    [getQuote, getSwapTransaction],
  )

  return {
    buyToken,
    sellToken,
    isTrading,
    executeBulkTrade,
    executeRandomTrade,
    transactions,
    clearTransactions,
    autoSlippage,
    setAutoSlippage,
    executeSwap,
    loading,
    error,
  }
}
