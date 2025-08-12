"use client"

import { useState, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import type { WalletData } from "@/hooks/useWalletManager"

export interface TradeResult {
  id: string
  walletAddress: string
  type: "buy" | "sell"
  amount: string
  tokenAmount?: number
  status: "success" | "error" | "pending"
  signature?: string
  error?: string
  timestamp: number
  executionTime?: number
}

interface TradingProgress {
  current: number
  total: number
}

export function useUltraFastTrading() {
  const [results, setResults] = useState<TradeResult[]>([])
  const [isTrading, setIsTrading] = useState(false)
  const [tradingProgress, setTradingProgress] = useState<TradingProgress>({ current: 0, total: 0 })
  const { toast } = useToast()

  const playBuySuccessSound = () => {
    try {
      const audio = new Audio("https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Apple%20Pay%20sound%20effect-Y8Lva1pUiq0AXmNZMcNJvPv5OKtv5A.mp3")
      audio.volume = 0.5
      audio.play().catch(console.error)
    } catch (error) {
      console.error("Failed to play buy success sound:", error)
    }
  }

  const executeBuy = useCallback(
    async (selectedWallets: WalletData[], tokenMint: string, amount: number, slippage: number) => {
      if (selectedWallets.length === 0) {
        toast({ title: "❌ No Wallets", description: "Select wallets first", variant: "destructive" })
        return
      }

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const startTime = Date.now()
      console.log(`🔥 STARTING MAXIMUM SPEED REAL SIMULTANEOUS BUY:`)
      console.log(`   🎯 Token: ${tokenMint}`)
      console.log(`   💰 Amount: ${amount} SOL per wallet`)
      console.log(`   📊 Slippage: ${slippage}%`)
      console.log(`   🚀 Wallets: ${selectedWallets.length}`)
      console.log(`   ⚡ Mode: ALL WALLETS FIRE SIMULTANEOUSLY - NO DELAYS`)

      try {
        // Create pending results immediately
        const pendingResults: TradeResult[] = selectedWallets.map((wallet, index) => ({
          id: `${wallet.id}-${Date.now()}-${index}`,
          walletAddress: wallet.publicKey,
          type: "buy",
          amount: `${amount} SOL`,
          status: "pending",
          timestamp: Date.now(),
        }))

        // Add pending results to state
        setResults((prev) => [...pendingResults, ...prev])

        // Execute ALL trades simultaneously - NO DELAYS
        const tradePromises = selectedWallets.map(async (wallet, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(`🚀 Wallet ${index + 1}/${selectedWallets.length}: Starting REAL buy...`)

            const response = await fetch("/api/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint,
                amount,
                slippage,
              }),
            })

            const result = await response.json()
            const executionTime = Date.now() - tradeStartTime

            if (result.success) {
              console.log(`✅ Wallet ${index + 1}/${selectedWallets.length}: REAL BUY SUCCESS in ${executionTime}ms`)
              console.log(`   📡 Signature: ${result.signature}`)
              console.log(`   💰 Tokens: ${result.outputTokens}`)
              console.log(`   🔗 Solscan: ${result.solscanUrl}`)

              playBuySuccessSound()

              return {
                ...pendingResults[index],
                status: "success" as const,
                tokenAmount: Number.parseFloat(result.outputTokens),
                signature: result.signature,
                executionTime,
              }
            } else {
              console.error(`❌ Wallet ${index + 1}/${selectedWallets.length}: REAL BUY FAILED in ${executionTime}ms`)
              console.error(`   Error: ${result.error}`)

              return {
                ...pendingResults[index],
                status: "error" as const,
                error: result.error,
                executionTime,
              }
            }
          } catch (error: any) {
            const executionTime = Date.now() - tradeStartTime
            console.error(`❌ Wallet ${index + 1}/${selectedWallets.length}: REAL BUY ERROR in ${executionTime}ms`)
            console.error(`   Error: ${error.message}`)

            return {
              ...pendingResults[index],
              status: "error" as const,
              error: `Network error: ${error.message}`,
              executionTime,
            }
          }
        })

        // Wait for ALL REAL trades to complete simultaneously - NO TIMEOUTS
        const completedResults = await Promise.all(tradePromises)

        // Update results with completed trades
        setResults((prev) => {
          const updatedResults = [...prev]
          completedResults.forEach((result, index) => {
            const resultIndex = updatedResults.findIndex((r) => r.id === pendingResults[index].id)
            if (resultIndex !== -1) {
              updatedResults[resultIndex] = result
            }
          })
          return updatedResults
        })

        const endTime = Date.now()
        const totalExecutionTime = endTime - startTime
        const successCount = completedResults.filter((r) => r.status === "success").length
        const failureCount = completedResults.filter((r) => r.status === "error").length
        const avgTimePerWallet = totalExecutionTime / selectedWallets.length
        const tradesPerSecond = selectedWallets.length / (totalExecutionTime / 1000)
        const isUnder1Second = totalExecutionTime < 1000
        const isUnder2Seconds = totalExecutionTime < 2000

        console.log(`🎯 MAXIMUM SPEED REAL SIMULTANEOUS BUY COMPLETE:`)
        console.log(`   ✅ ${successCount} successful REAL trades`)
        console.log(`   ❌ ${failureCount} failed trades`)
        console.log(`   ⚡ Total execution time: ${totalExecutionTime}ms (${(totalExecutionTime / 1000).toFixed(3)}s)`)
        console.log(`   🚀 Average time per wallet: ${avgTimePerWallet.toFixed(0)}ms`)
        console.log(
          `   🔥 SPEED ACHIEVED: ${isUnder1Second ? "✅ UNDER 1 SECOND!" : isUnder2Seconds ? "✅ UNDER 2 SECONDS!" : "❌ Over 2 seconds"}`,
        )
        console.log(`   💥 MAXIMUM SPEED: ${tradesPerSecond.toFixed(1)} trades/second`)
        console.log(`   🎯 ALL ${selectedWallets.length} WALLETS PROCESSED SIMULTANEOUSLY!`)
        console.log(`   🔥 NO TIMEOUTS - MAXIMUM EXECUTION SPEED ACHIEVED!`)

        toast({
          title: `🔥 ${isUnder1Second ? "LIGHTNING SPEED!" : isUnder2Seconds ? "ULTRA SPEED!" : "SPEED COMPLETE!"}`,
          description: `✅ ${successCount} successful, ❌ ${failureCount} failed in ${(totalExecutionTime / 1000).toFixed(3)}s ${isUnder1Second ? "⚡ <1s!" : isUnder2Seconds ? "⚡ <2s!" : ""}`,
        })
      } catch (error: any) {
        console.error("❌ Real simultaneous buy failed:", error)
        toast({
          title: "❌ Real Buy Failed",
          description: "An error occurred during real simultaneous buy execution",
          variant: "destructive",
        })
      } finally {
        setIsTrading(false)
        setTradingProgress({ current: 0, total: 0 })
      }
    },
    [toast],
  )

  const executeRandomPercentageBuy = useCallback(
    async (
      selectedWallets: WalletData[],
      tokenMint: string,
      slippage: number,
      minPercent: number,
      maxPercent: number,
    ) => {
      if (selectedWallets.length === 0) {
        toast({ title: "❌ No Wallets", description: "Select wallets first", variant: "destructive" })
        return
      }

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const isExactPercentage = minPercent === maxPercent
      const startTime = Date.now()

      console.log(`🔥 STARTING MAXIMUM SPEED REAL ${isExactPercentage ? "EXACT" : "RANDOM"} PERCENTAGE BUY:`)
      console.log(`   🎯 Token: ${tokenMint}`)
      console.log(`   📊 Slippage: ${slippage}%`)
      console.log(`   🚀 Wallets: ${selectedWallets.length}`)
      if (isExactPercentage) {
        console.log(`   🎯 Exact percentage: ${minPercent}%`)
      } else {
        console.log(`   📊 Percentage range: ${minPercent}% - ${maxPercent}%`)
      }
      console.log(`   ⚡ Mode: ALL WALLETS FIRE SIMULTANEOUSLY - NO DELAYS`)

      try {
        // Generate wallet data with percentages and amounts
        const walletData = selectedWallets.map((wallet) => {
          const percentage = isExactPercentage
            ? minPercent
            : Math.floor(Math.random() * (maxPercent - minPercent + 1)) + minPercent
          const buyAmount = (wallet.balance * percentage) / 100
          return { wallet, percentage, buyAmount }
        })

        // Create pending results immediately
        const pendingResults: TradeResult[] = walletData.map(({ wallet, percentage, buyAmount }, index) => ({
          id: `${wallet.id}-${Date.now()}-${index}`,
          walletAddress: wallet.publicKey,
          type: "buy",
          amount: `${buyAmount.toFixed(4)} SOL (${percentage}% of balance)`,
          status: "pending",
          timestamp: Date.now(),
        }))

        // Add pending results to state
        setResults((prev) => [...pendingResults, ...prev])

        // Execute ALL trades simultaneously - NO DELAYS
        const tradePromises = walletData.map(async ({ wallet, percentage, buyAmount }, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(
              `🚀 Wallet ${index + 1}/${selectedWallets.length}: Starting REAL ${isExactPercentage ? "EXACT" : "RANDOM"} buy (${percentage}%, ${buyAmount.toFixed(4)} SOL)...`,
            )

            const response = await fetch("/api/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint,
                amount: buyAmount,
                slippage,
              }),
            })

            const result = await response.json()
            const executionTime = Date.now() - tradeStartTime

            if (result.success) {
              console.log(
                `✅ Wallet ${index + 1}/${selectedWallets.length}: REAL ${isExactPercentage ? "EXACT" : "RANDOM"} BUY SUCCESS in ${executionTime}ms`,
              )
              console.log(`   🎯 Percentage: ${percentage}%`)
              console.log(`   💰 Amount: ${buyAmount.toFixed(4)} SOL`)
              console.log(`   📡 Signature: ${result.signature}`)
              console.log(`   🪙 Tokens: ${result.outputTokens}`)
              console.log(`   🔗 Solscan: ${result.solscanUrl}`)

              playBuySuccessSound()

              return {
                ...pendingResults[index],
                status: "success" as const,
                tokenAmount: Number.parseFloat(result.outputTokens),
                signature: result.signature,
                executionTime,
              }
            } else {
              console.error(
                `❌ Wallet ${index + 1}/${selectedWallets.length}: REAL ${isExactPercentage ? "EXACT" : "RANDOM"} BUY FAILED in ${executionTime}ms`,
              )
              console.error(`   🎯 Percentage: ${percentage}%`)
              console.error(`   💰 Amount: ${buyAmount.toFixed(4)} SOL`)
              console.error(`   Error: ${result.error}`)

              return {
                ...pendingResults[index],
                status: "error" as const,
                error: result.error,
                executionTime,
              }
            }
          } catch (error: any) {
            const executionTime = Date.now() - tradeStartTime
            console.error(
              `❌ Wallet ${index + 1}/${selectedWallets.length}: REAL ${isExactPercentage ? "EXACT" : "RANDOM"} BUY ERROR in ${executionTime}ms`,
            )
            console.error(`   🎯 Percentage: ${percentage}%`)
            console.error(`   💰 Amount: ${buyAmount.toFixed(4)} SOL`)
            console.error(`   Error: ${error.message}`)

            return {
              ...pendingResults[index],
              status: "error" as const,
              error: `Network error: ${error.message}`,
              executionTime,
            }
          }
        })

        // Wait for ALL REAL trades to complete simultaneously - NO TIMEOUTS
        const completedResults = await Promise.all(tradePromises)

        // Update results with completed trades
        setResults((prev) => {
          const updatedResults = [...prev]
          completedResults.forEach((result, index) => {
            const resultIndex = updatedResults.findIndex((r) => r.id === pendingResults[index].id)
            if (resultIndex !== -1) {
              updatedResults[resultIndex] = result
            }
          })
          return updatedResults
        })

        const endTime = Date.now()
        const totalExecutionTime = endTime - startTime
        const successCount = completedResults.filter((r) => r.status === "success").length
        const failureCount = completedResults.filter((r) => r.status === "error").length
        const totalSpent = walletData.reduce((sum, { buyAmount }) => sum + buyAmount, 0)
        const avgTimePerWallet = totalExecutionTime / selectedWallets.length
        const tradesPerSecond = selectedWallets.length / (totalExecutionTime / 1000)
        const isUnder1Second = totalExecutionTime < 1000
        const isUnder2Seconds = totalExecutionTime < 2000

        console.log(`🎯 MAXIMUM SPEED REAL ${isExactPercentage ? "EXACT" : "RANDOM"} PERCENTAGE BUY COMPLETE:`)
        console.log(`   ✅ ${successCount} successful REAL ${isExactPercentage ? "exact" : "random"} trades`)
        console.log(`   ❌ ${failureCount} failed trades`)
        console.log(`   💰 Total spent: ${totalSpent.toFixed(4)} SOL`)
        if (isExactPercentage) {
          console.log(`   🎯 Exact percentage: ${minPercent}%`)
        } else {
          console.log(`   📊 Percentage range: ${minPercent}% - ${maxPercent}%`)
        }
        console.log(`   ⚡ Total execution time: ${totalExecutionTime}ms (${(totalExecutionTime / 1000).toFixed(3)}s)`)
        console.log(`   🚀 Average time per wallet: ${avgTimePerWallet.toFixed(0)}ms`)
        console.log(
          `   🔥 SPEED ACHIEVED: ${isUnder1Second ? "✅ UNDER 1 SECOND!" : isUnder2Seconds ? "✅ UNDER 2 SECONDS!" : "❌ Over 2 seconds"}`,
        )
        console.log(`   💥 MAXIMUM SPEED: ${tradesPerSecond.toFixed(1)} trades/second`)
        console.log(
          `   🎯 ALL ${selectedWallets.length} WALLETS PROCESSED WITH ${isExactPercentage ? "EXACT" : "RANDOM"} PERCENTAGES!`,
        )
        console.log(`   🔥 NO TIMEOUTS - MAXIMUM EXECUTION SPEED ACHIEVED!`)

        toast({
          title: `🔥 ${isExactPercentage ? "Exact" : "Random"} ${isUnder1Second ? "LIGHTNING SPEED!" : isUnder2Seconds ? "ULTRA SPEED!" : "Percentage Buy Complete!"}`,
          description: `✅ ${successCount} successful, ❌ ${failureCount} failed. ${isExactPercentage ? `Exact: ${minPercent}%` : `Range: ${minPercent}%-${maxPercent}%`} ${isUnder1Second ? "⚡ <1s!" : isUnder2Seconds ? "⚡ <2s!" : ""}`,
        })
      } catch (error: any) {
        console.error(`❌ Real ${isExactPercentage ? "exact" : "random"} percentage buy failed:`, error)
        toast({
          title: `❌ ${isExactPercentage ? "Exact" : "Random"} Buy Failed`,
          description: `An error occurred during ${isExactPercentage ? "exact" : "random"} percentage buy execution`,
          variant: "destructive",
        })
      } finally {
        setIsTrading(false)
        setTradingProgress({ current: 0, total: 0 })
      }
    },
    [toast],
  )

  const executeSell = useCallback(
    async (selectedWallets: WalletData[], tokenMint: string, percentage: number, slippage: number) => {
      if (selectedWallets.length === 0) {
        toast({ title: "❌ No Wallets", description: "Select wallets first", variant: "destructive" })
        return
      }

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const startTime = Date.now()
      console.log(`🔥 STARTING MAXIMUM SPEED REAL SIMULTANEOUS SELL:`)
      console.log(`   🎯 Token: ${tokenMint}`)
      console.log(`   📊 Percentage: ${percentage}%`)
      console.log(`   📊 Slippage: ${slippage}%`)
      console.log(`   🚀 Wallets: ${selectedWallets.length}`)
      console.log(`   ⚡ Mode: ALL WALLETS FIRE SIMULTANEOUSLY - NO DELAYS`)

      try {
        // Create pending results immediately
        const pendingResults: TradeResult[] = selectedWallets.map((wallet, index) => ({
          id: `${wallet.id}-${Date.now()}-${index}`,
          walletAddress: wallet.publicKey,
          type: "sell",
          amount: `${percentage}% of tokens`,
          status: "pending",
          timestamp: Date.now(),
        }))

        // Add pending results to state
        setResults((prev) => [...pendingResults, ...prev])

        // Execute ALL trades simultaneously - NO DELAYS
        const tradePromises = selectedWallets.map(async (wallet, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(`🚀 Wallet ${index + 1}/${selectedWallets.length}: Starting REAL sell...`)

            const response = await fetch("/api/sell", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                mint: tokenMint,
                percentage,
                slippage,
              }),
            })

            const result = await response.json()
            const executionTime = Date.now() - tradeStartTime

            if (result.success) {
              console.log(`✅ Wallet ${index + 1}/${selectedWallets.length}: REAL SELL SUCCESS in ${executionTime}ms`)
              console.log(`   📡 Signature: ${result.signature}`)
              console.log(`   💰 SOL received: ${result.solReceived}`)
              console.log(`   🔗 Solscan: ${result.solscanUrl}`)

              return {
                ...pendingResults[index],
                status: "success" as const,
                tokenAmount: Number.parseFloat(result.solReceived || "0"),
                signature: result.signature,
                executionTime,
              }
            } else {
              console.error(`❌ Wallet ${index + 1}/${selectedWallets.length}: REAL SELL FAILED in ${executionTime}ms`)
              console.error(`   Error: ${result.error}`)

              return {
                ...pendingResults[index],
                status: "error" as const,
                error: result.error,
                executionTime,
              }
            }
          } catch (error: any) {
            const executionTime = Date.now() - tradeStartTime
            console.error(`❌ Wallet ${index + 1}/${selectedWallets.length}: REAL SELL ERROR in ${executionTime}ms`)
            console.error(`   Error: ${error.message}`)

            return {
              ...pendingResults[index],
              status: "error" as const,
              error: `Network error: ${error.message}`,
              executionTime,
            }
          }
        })

        // Wait for ALL REAL trades to complete simultaneously - NO TIMEOUTS
        const completedResults = await Promise.all(tradePromises)

        // Update results with completed trades
        setResults((prev) => {
          const updatedResults = [...prev]
          completedResults.forEach((result, index) => {
            const resultIndex = updatedResults.findIndex((r) => r.id === pendingResults[index].id)
            if (resultIndex !== -1) {
              updatedResults[resultIndex] = result
            }
          })
          return updatedResults
        })

        const endTime = Date.now()
        const totalExecutionTime = endTime - startTime
        const successCount = completedResults.filter((r) => r.status === "success").length
        const failureCount = completedResults.filter((r) => r.status === "error").length
        const avgTimePerWallet = totalExecutionTime / selectedWallets.length
        const tradesPerSecond = selectedWallets.length / (totalExecutionTime / 1000)
        const isUnder1Second = totalExecutionTime < 1000
        const isUnder2Seconds = totalExecutionTime < 2000

        console.log(`🎯 MAXIMUM SPEED REAL SIMULTANEOUS SELL COMPLETE:`)
        console.log(`   ✅ ${successCount} successful REAL trades`)
        console.log(`   ❌ ${failureCount} failed trades`)
        console.log(`   ⚡ Total execution time: ${totalExecutionTime}ms (${(totalExecutionTime / 1000).toFixed(3)}s)`)
        console.log(`   🚀 Average time per wallet: ${avgTimePerWallet.toFixed(0)}ms`)
        console.log(
          `   🔥 SPEED ACHIEVED: ${isUnder1Second ? "✅ UNDER 1 SECOND!" : isUnder2Seconds ? "✅ UNDER 2 SECONDS!" : "❌ Over 2 seconds"}`,
        )
        console.log(`   💥 MAXIMUM SPEED: ${tradesPerSecond.toFixed(1)} trades/second`)
        console.log(`   🎯 ALL ${selectedWallets.length} WALLETS PROCESSED SIMULTANEOUSLY!`)
        console.log(`   🔥 NO TIMEOUTS - MAXIMUM EXECUTION SPEED ACHIEVED!`)

        toast({
          title: `🔥 ${isUnder1Second ? "LIGHTNING SPEED!" : isUnder2Seconds ? "ULTRA SPEED!" : "SELL COMPLETE!"}`,
          description: `✅ ${successCount} successful, ❌ ${failureCount} failed in ${(totalExecutionTime / 1000).toFixed(3)}s ${isUnder1Second ? "⚡ <1s!" : isUnder2Seconds ? "⚡ <2s!" : ""}`,
        })
      } catch (error: any) {
        console.error("❌ Real simultaneous sell failed:", error)
        toast({
          title: "❌ Real Sell Failed",
          description: "An error occurred during real simultaneous sell execution",
          variant: "destructive",
        })
      } finally {
        setIsTrading(false)
        setTradingProgress({ current: 0, total: 0 })
      }
    },
    [toast],
  )

  const clearResults = useCallback(() => {
    setResults([])
  }, [])

  return {
    results,
    isTrading,
    tradingProgress,
    executeBuy,
    executeRandomPercentageBuy,
    executeSell,
    clearResults,
  }
}
