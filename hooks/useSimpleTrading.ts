"use client"

import { useState, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"

export interface SimpleTradeResult {
  id: string
  walletId: string
  walletName: string
  type: "buy" | "sell"
  amount: number
  percentage?: number
  status: "success" | "failed" | "pending"
  signature?: string
  error?: string
  timestamp: number
}

export function useSimpleTrading() {
  const [isTrading, setIsTrading] = useState(false)
  const [results, setResults] = useState<SimpleTradeResult[]>([])
  const { toast } = useToast()

  const executeBuy = useCallback(
    async (wallets: any[], tokenMint: string, amount: number) => {
      if (!tokenMint.trim()) {
        toast({ title: "❌ Error", description: "Enter token mint address", variant: "destructive" })
        return
      }

      if (wallets.length === 0) {
        toast({ title: "❌ Error", description: "Select wallets first", variant: "destructive" })
        return
      }

      setIsTrading(true)
      console.log(`🚀 BUYING ${amount} SOL from ${wallets.length} wallets`)

      try {
        const newResults: SimpleTradeResult[] = []

        for (let i = 0; i < wallets.length; i++) {
          const wallet = wallets[i]
          console.log(`💰 Buying from ${wallet.name}...`)

          try {
            // Simulate API call
            const response = await fetch("/api/simple-buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                walletId: wallet.id,
                walletName: wallet.name,
                privateKey: wallet.privateKey,
                tokenMint,
                amount,
              }),
            })

            const data = await response.json()

            const result: SimpleTradeResult = {
              id: `${wallet.id}-${Date.now()}`,
              walletId: wallet.id,
              walletName: wallet.name,
              type: "buy",
              amount,
              status: data.success ? "success" : "failed",
              signature: data.signature,
              error: data.error,
              timestamp: Date.now(),
            }

            newResults.push(result)
            console.log(`${data.success ? "✅" : "❌"} ${wallet.name}: ${data.success ? "Success" : data.error}`)

            // Small delay between trades
            if (i < wallets.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          } catch (error) {
            const result: SimpleTradeResult = {
              id: `${wallet.id}-${Date.now()}`,
              walletId: wallet.id,
              walletName: wallet.name,
              type: "buy",
              amount,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
              timestamp: Date.now(),
            }
            newResults.push(result)
            console.log(`❌ ${wallet.name}: ${error}`)
          }
        }

        setResults((prev) => [...newResults, ...prev])

        const successCount = newResults.filter((r) => r.status === "success").length
        const failCount = newResults.filter((r) => r.status === "failed").length

        toast({
          title: "🚀 Buy Complete",
          description: `✅ ${successCount} success, ❌ ${failCount} failed`,
        })
      } catch (error) {
        console.error("Buy failed:", error)
        toast({ title: "❌ Buy Failed", description: "Something went wrong", variant: "destructive" })
      } finally {
        setIsTrading(false)
      }
    },
    [toast],
  )

  const executeSell = useCallback(
    async (wallet: any, tokenMint: string, percentage: number) => {
      if (!tokenMint.trim()) {
        toast({ title: "❌ Error", description: "Enter token mint address", variant: "destructive" })
        return
      }

      setIsTrading(true)
      console.log(`🔥 SELLING ${percentage}% from ${wallet.name}`)

      try {
        const response = await fetch("/api/simple-sell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: wallet.id,
            walletName: wallet.name,
            privateKey: wallet.privateKey,
            tokenMint,
            percentage,
          }),
        })

        const data = await response.json()

        const result: SimpleTradeResult = {
          id: `${wallet.id}-${Date.now()}`,
          walletId: wallet.id,
          walletName: wallet.name,
          type: "sell",
          amount: percentage,
          percentage,
          status: data.success ? "success" : "failed",
          signature: data.signature,
          error: data.error,
          timestamp: Date.now(),
        }

        setResults((prev) => [result, ...prev])

        if (data.success) {
          toast({
            title: "🔥 Sell Success",
            description: `${wallet.name}: Sold ${percentage}%`,
          })
          console.log(`✅ ${wallet.name}: Sold ${percentage}% - ${data.signature}`)
        } else {
          toast({
            title: "❌ Sell Failed",
            description: `${wallet.name}: ${data.error}`,
            variant: "destructive",
          })
          console.log(`❌ ${wallet.name}: ${data.error}`)
        }
      } catch (error) {
        const result: SimpleTradeResult = {
          id: `${wallet.id}-${Date.now()}`,
          walletId: wallet.id,
          walletName: wallet.name,
          type: "sell",
          amount: percentage,
          percentage,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now(),
        }

        setResults((prev) => [result, ...prev])
        toast({
          title: "❌ Sell Failed",
          description: `${wallet.name}: Error occurred`,
          variant: "destructive",
        })
        console.log(`❌ ${wallet.name}: ${error}`)
      } finally {
        setIsTrading(false)
      }
    },
    [toast],
  )

  const clearResults = useCallback(() => {
    setResults([])
  }, [])

  return {
    isTrading,
    results,
    executeBuy,
    executeSell,
    clearResults,
  }
}
