"use client"

import { useState, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import type { WalletData } from "@/hooks/useWalletManager"

export interface TradeResult {
  id: string
  walletId: string
  walletAddress: string
  type: "buy" | "sell"
  status: "pending" | "success" | "error"
  amount: string
  tokenAmount?: number
  signature?: string
  error?: string
  timestamp: number
  executionTime?: number
}

export function useUltraFastTrading() {
  const [results, setResults] = useState<TradeResult[]>([])
  const [isTrading, setIsTrading] = useState(false)
  const [tradingProgress, setTradingProgress] = useState({ current: 0, total: 0 })
  const { toast } = useToast()

  const executeBuy = useCallback(
    async (wallets: WalletData[], tokenMint: string, buyAmount: number, slippage: number) => {
      const selectedWallets = wallets.filter((w) => w.connected && w.balance > buyAmount + 0.01)

      if (selectedWallets.length === 0) {
        toast({
          title: "❌ No Valid Wallets",
          description: "No wallets with sufficient balance selected",
          variant: "destructive",
        })
        return
      }

      console.log(`🚀 MAXIMUM SPEED SIMULTANEOUS BUY: Starting ${selectedWallets.length} wallets`)
      console.log(`⚡ Token: ${tokenMint}`)
      console.log(`💰 Amount: ${buyAmount} SOL per wallet`)
      console.log(`📊 Slippage: ${slippage}%`)
      console.log(`🔥 ULTRA-FAST MODE: ALL ${selectedWallets.length} WALLETS EXECUTE SIMULTANEOUSLY - NO DELAYS!`)
      console.log(`🎯 TARGET: Complete ALL orders in 1-2 seconds!`)

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const startTime = Date.now()

      // Create initial pending results
      const pendingResults: TradeResult[] = selectedWallets.map((wallet) => ({
        id: `${wallet.id}-${Date.now()}-${Math.random()}`,
        walletId: wallet.id,
        walletAddress: wallet.publicKey,
        type: "buy",
        status: "pending",
        amount: `${buyAmount} SOL`,
        timestamp: Date.now(),
      }))

      setResults((prev) => [...prev, ...pendingResults])

      try {
        console.log(`⚡ EXECUTING ${selectedWallets.length} REAL SIMULTANEOUS BUYS WITH Promise.all()...`)
        console.log(`🔥 MAXIMUM SPEED: ALL ${selectedWallets.length} WALLETS FIRE AT ONCE - NO TIMEOUTS!`)

        // Execute ALL REAL trades simultaneously with MAXIMUM SPEED - NO TIMEOUTS
        const tradePromises = selectedWallets.map(async (wallet, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(`🚀 Wallet ${index + 1}/${selectedWallets.length}: FIRING REAL BUY IMMEDIATELY...`)

            // Make REAL API call with NO TIMEOUT - Maximum speed execution
            const response = await fetch("/api/buy", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
              },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint: tokenMint,
                amount: buyAmount,
                slippage: slippage,
              }),
              // NO TIMEOUT - Let all trades complete naturally for maximum speed
            })

            const result = await response.json()
            const executionTime = Date.now() - tradeStartTime

            if (result.success) {
              console.log(`✅ Wallet ${index + 1}/${selectedWallets.length}: REAL BUY SUCCESS in ${executionTime}ms`)
              console.log(`   📡 Signature: ${result.signature}`)
              console.log(`   💰 Tokens: ${result.outputTokens}`)
              console.log(`   🔗 Solscan: ${result.solscanUrl}`)

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
    async (wallets: WalletData[], tokenMint: string, slippage: number, minPercent: number, maxPercent: number) => {
      const selectedWallets = wallets.filter((w) => w.connected && w.balance > 0.01)

      if (selectedWallets.length === 0) {
        toast({
          title: "❌ No Valid Wallets",
          description: "No wallets with sufficient balance selected",
          variant: "destructive",
        })
        return
      }

      const isExactPercentage = minPercent === maxPercent

      console.log(
        `🔥 MAXIMUM SPEED ${isExactPercentage ? "EXACT" : "RANDOM"} PERCENTAGE BUY: Starting ${selectedWallets.length} wallets`,
      )
      console.log(`⚡ Token: ${tokenMint}`)
      if (isExactPercentage) {
        console.log(`📊 Exact Percentage: ${minPercent}% of wallet balance`)
      } else {
        console.log(`📊 Random Percentage Range: ${minPercent}% - ${maxPercent}% of wallet balance`)
      }
      console.log(`📊 Slippage: ${slippage}%`)
      console.log(`🔥 ULTRA-FAST MODE: ALL ${selectedWallets.length} WALLETS EXECUTE SIMULTANEOUSLY - NO DELAYS!`)
      console.log(`🎯 TARGET: Complete ALL orders in 1-2 seconds!`)

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const startTime = Date.now()

      // Generate percentages - exact for preset mode, random for custom mode
      const walletData = selectedWallets.map((wallet) => {
        const percentage = isExactPercentage ? minPercent : minPercent + Math.random() * (maxPercent - minPercent)
        const roundedPercentage = Math.round(percentage)
        const availableBalance = wallet.balance - 0.01 // Keep 0.01 SOL for fees
        const buyAmount = (availableBalance * roundedPercentage) / 100
        return {
          wallet,
          percentage: roundedPercentage,
          buyAmount: Math.max(0.001, buyAmount), // Minimum 0.001 SOL
        }
      })

      // Create initial pending results with percentages
      const pendingResults: TradeResult[] = walletData.map(({ wallet, percentage, buyAmount }) => ({
        id: `${wallet.id}-${Date.now()}-${Math.random()}`,
        walletId: wallet.id,
        walletAddress: wallet.publicKey,
        type: "buy",
        status: "pending",
        amount: `${buyAmount.toFixed(4)} SOL (${percentage}% of balance)`,
        timestamp: Date.now(),
      }))

      setResults((prev) => [...prev, ...pendingResults])

      try {
        console.log(
          `⚡ EXECUTING ${selectedWallets.length} REAL ${isExactPercentage ? "EXACT" : "RANDOM"} PERCENTAGE BUYS WITH Promise.all()...`,
        )
        console.log(`🔥 MAXIMUM SPEED: ALL ${selectedWallets.length} WALLETS FIRE AT ONCE - NO TIMEOUTS!`)

        // Execute ALL REAL trades simultaneously with MAXIMUM SPEED - NO TIMEOUTS
        const tradePromises = walletData.map(async ({ wallet, percentage, buyAmount }, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(
              `🔥 Wallet ${index + 1}/${selectedWallets.length}: FIRING REAL ${isExactPercentage ? "exact" : "random"} buy (${percentage}% = ${buyAmount.toFixed(4)} SOL)...`,
            )

            // Make REAL API call with NO TIMEOUT - Maximum speed execution
            const response = await fetch("/api/buy", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
              },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint: tokenMint,
                amount: buyAmount,
                slippage: slippage,
              }),
              // NO TIMEOUT - Let all trades complete naturally for maximum speed
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
    async (wallets: WalletData[], tokenMint: string, percentage: number, slippage: number) => {
      const selectedWallets = wallets.filter((w) => w.connected)

      if (selectedWallets.length === 0) {
        toast({
          title: "❌ No Valid Wallets",
          description: "No connected wallets selected",
          variant: "destructive",
        })
        return
      }

      console.log(`🚀 MAXIMUM SPEED SIMULTANEOUS SELL: Starting ${selectedWallets.length} wallets`)
      console.log(`⚡ Token: ${tokenMint}`)
      console.log(`📊 Percentage: ${percentage}%`)
      console.log(`📊 Slippage: ${slippage}%`)
      console.log(`🔥 ULTRA-FAST MODE: ALL ${selectedWallets.length} WALLETS EXECUTE SIMULTANEOUSLY - NO DELAYS!`)
      console.log(`🎯 TARGET: Complete ALL orders in 1-2 seconds!`)

      setIsTrading(true)
      setTradingProgress({ current: 0, total: selectedWallets.length })

      const startTime = Date.now()

      // Create initial pending results
      const pendingResults: TradeResult[] = selectedWallets.map((wallet) => ({
        id: `${wallet.id}-${Date.now()}-${Math.random()}`,
        walletId: wallet.id,
        walletAddress: wallet.publicKey,
        type: "sell",
        status: "pending",
        amount: `${percentage}% of tokens`,
        timestamp: Date.now(),
      }))

      setResults((prev) => [...prev, ...pendingResults])

      try {
        console.log(`⚡ EXECUTING ${selectedWallets.length} REAL SIMULTANEOUS SELLS WITH Promise.all()...`)
        console.log(`🔥 MAXIMUM SPEED: ALL ${selectedWallets.length} WALLETS FIRE AT ONCE - NO TIMEOUTS!`)

        // Execute ALL REAL sells simultaneously with MAXIMUM SPEED - NO TIMEOUTS
        const tradePromises = selectedWallets.map(async (wallet, index) => {
          const tradeStartTime = Date.now()

          try {
            console.log(`🚀 Wallet ${index + 1}/${selectedWallets.length}: FIRING REAL SELL IMMEDIATELY...`)

            // Make REAL API call with NO TIMEOUT - Maximum speed execution
            const response = await fetch("/api/sell", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
              },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint: tokenMint,
                percentage: percentage,
                slippage: slippage,
              }),
              // NO TIMEOUT - Let all trades complete naturally for maximum speed
            })

            const result = await response.json()
            const executionTime = Date.now() - tradeStartTime

            if (result.success) {
              console.log(`✅ Wallet ${index + 1}/${selectedWallets.length}: REAL SELL SUCCESS in ${executionTime}ms`)
              console.log(`   📡 Signature: ${result.signature}`)
              console.log(`   💰 SOL Received: ${result.receivedSOL}`)
              console.log(`   🔗 Solscan: ${result.solscanUrl}`)

              return {
                ...pendingResults[index],
                status: "success" as const,
                tokenAmount: Number.parseFloat(result.receivedSOL),
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

        // Wait for ALL REAL sells to complete simultaneously - NO TIMEOUTS
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
          title: `🔥 ${isUnder1Second ? "LIGHTNING SPEED!" : isUnder2Seconds ? "ULTRA SPEED!" : "Real Simultaneous Sell Complete!"}`,
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
