"use client"

import { useState, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"

export interface TradeResult {
  id: string
  walletId: string
  type: "buy" | "sell"
  tokenMint: string
  amount: number
  status: "success" | "failed" | "pending"
  signature?: string
  error?: string
  timestamp: number
}

interface TradingState {
  isTrading: boolean
  results: TradeResult[]
  error: string | null
}

export function useTrading(walletManager: any) {
  const [state, setState] = useState<TradingState>({
    isTrading: false,
    results: [],
    error: null,
  })

  const { toast } = useToast()

  const executeBuy = useCallback(
    async (params: {
      tokenMint: string
      amount: number
      slippage: number
      selectedWallets: string[]
    }) => {
      if (!params.tokenMint.trim() || params.selectedWallets.length === 0) {
        toast({ title: "❌ Missing Data", description: "Enter token and select wallets", variant: "destructive" })
        return
      }

      setState((prev) => ({ ...prev, isTrading: true, error: null }))

      try {
        const results: TradeResult[] = []

        for (const walletId of params.selectedWallets) {
          try {
            const response = await fetch("/api/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                walletId,
                tokenMint: params.tokenMint,
                amount: params.amount,
                slippage: params.slippage,
              }),
            })

            const data = await response.json()

            results.push({
              id: `${walletId}-${Date.now()}`,
              walletId,
              type: "buy",
              tokenMint: params.tokenMint,
              amount: params.amount,
              status: data.success ? "success" : "failed",
              signature: data.signature,
              error: data.error,
              timestamp: Date.now(),
            })

            // Add delay between trades
            await new Promise((resolve) => setTimeout(resolve, 1000))
          } catch (error) {
            results.push({
              id: `${walletId}-${Date.now()}`,
              walletId,
              type: "buy",
              tokenMint: params.tokenMint,
              amount: params.amount,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
              timestamp: Date.now(),
            })
          }
        }

        setState((prev) => ({ ...prev, results: [...prev.results, ...results], isTrading: false }))

        const successCount = results.filter((r) => r.status === "success").length
        const failCount = results.filter((r) => r.status === "failed").length

        toast({
          title: "🚀 Buy Complete",
          description: `✅ ${successCount} success, ❌ ${failCount} failed`,
        })
      } catch (error) {
        console.error("Buy execution failed:", error)
        toast({ title: "❌ Buy Failed", description: "Execution error", variant: "destructive" })
      } finally {
        setState((prev) => ({ ...prev, isTrading: false }))
      }
    },
    [toast],
  )

  const executeSell = useCallback(
    async (params: {
      tokenMint: string
      amount: number
      slippage: number
      selectedWallets: string[]
    }) => {
      if (!params.tokenMint.trim() || params.selectedWallets.length === 0) {
        toast({ title: "❌ Missing Data", description: "Enter token and select wallets", variant: "destructive" })
        return
      }

      setState((prev) => ({ ...prev, isTrading: true, error: null }))

      try {
        const results: TradeResult[] = []

        for (const walletId of params.selectedWallets) {
          try {
            const response = await fetch("/api/sell", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                walletId,
                tokenMint: params.tokenMint,
                percentage: params.amount,
                slippage: params.slippage,
              }),
            })

            const data = await response.json()

            results.push({
              id: `${walletId}-${Date.now()}`,
              walletId,
              type: "sell",
              tokenMint: params.tokenMint,
              amount: params.amount,
              status: data.success ? "success" : "failed",
              signature: data.signature,
              error: data.error,
              timestamp: Date.now(),
            })

            // Add delay between trades
            await new Promise((resolve) => setTimeout(resolve, 1000))
          } catch (error) {
            results.push({
              id: `${walletId}-${Date.now()}`,
              walletId,
              type: "sell",
              tokenMint: params.tokenMint,
              amount: params.amount,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
              timestamp: Date.now(),
            })
          }
        }

        setState((prev) => ({ ...prev, results: [...prev.results, ...results], isTrading: false }))

        const successCount = results.filter((r) => r.status === "success").length
        const failCount = results.filter((r) => r.status === "failed").length

        toast({
          title: "🔥 Sell Complete",
          description: `✅ ${successCount} success, ❌ ${failCount} failed`,
        })
      } catch (error) {
        console.error("Sell execution failed:", error)
        toast({ title: "❌ Sell Failed", description: "Execution error", variant: "destructive" })
      } finally {
        setState((prev) => ({ ...prev, isTrading: false }))
      }
    },
    [toast],
  )

  const executeRandomBuy = useCallback(
    async (params: {
      tokenMint: string
      minAmount: number
      maxAmount: number
      slippage: number
      selectedWallets: string[]
    }) => {
      // Implementation for random buy amounts
      const randomizedParams = {
        ...params,
        amount: Math.random() * (params.maxAmount - params.minAmount) + params.minAmount,
      }
      return executeBuy(randomizedParams)
    },
    [executeBuy],
  )

  const executeRandomSell = useCallback(
    async (params: {
      tokenMint: string
      slippage: number
      selectedWallets: string[]
    }) => {
      // Implementation for random sell percentages
      const randomizedParams = {
        ...params,
        amount: Math.floor(Math.random() * 75) + 25, // Random between 25-100%
      }
      return executeSell(randomizedParams)
    },
    [executeSell],
  )

  const clearResults = useCallback(() => {
    setState((prev) => ({ ...prev, results: [] }))
  }, [])

  return {
    ...state,
    executeBuy,
    executeSell,
    executeRandomBuy,
    executeRandomSell,
    clearResults,
  }
}
