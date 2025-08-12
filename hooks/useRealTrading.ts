"use client"

import { useState, useCallback } from "react"

interface TradeResult {
  id: string
  walletAddress: string
  type: "buy" | "sell"
  tokenMint: string
  amount: string
  signature?: string
  explorerUrl?: string
  status: "pending" | "success" | "error"
  error?: string
  timestamp: number
}

export function useRealTrading() {
  const [results, setResults] = useState<TradeResult[]>([])
  const [isTrading, setIsTrading] = useState(false)

  const executeBuy = useCallback(
    async (
      wallets: Array<{ id: string; privateKey: string; address: string }>,
      tokenMint: string,
      solAmount: number,
      slippage = 50,
    ) => {
      if (wallets.length === 0) {
        throw new Error("No wallets available for trading")
      }

      setIsTrading(true)

      try {
        // Create pending results for all wallets
        const pendingResults: TradeResult[] = wallets.map((wallet, index) => ({
          id: `buy-${Date.now()}-${index}`,
          walletAddress: wallet.address,
          type: "buy",
          tokenMint,
          amount: `${solAmount} SOL`,
          status: "pending",
          timestamp: Date.now(),
        }))

        setResults((prev) => [...pendingResults, ...prev])

        // Execute trades for all wallets simultaneously
        const tradePromises = wallets.map(async (wallet, index) => {
          const resultId = pendingResults[index].id

          try {
            console.log(`🚀 Starting buy for wallet ${index + 1}: ${wallet.address.slice(0, 8)}...`)

            const response = await fetch("/api/snipe", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint,
                solAmount,
                slippage,
                walletIndex: index,
              }),
            })

            const data = await response.json()

            if (data.success) {
              console.log(`✅ Buy successful for wallet ${index + 1}: ${data.signature}`)
              setResults((prev) =>
                prev.map((r) =>
                  r.id === resultId
                    ? {
                        ...r,
                        status: "success",
                        signature: data.signature,
                        explorerUrl: data.explorerUrl,
                      }
                    : r,
                ),
              )
            } else {
              console.log(`❌ Buy failed for wallet ${index + 1}: ${data.error}`)
              setResults((prev) =>
                prev.map((r) =>
                  r.id === resultId
                    ? {
                        ...r,
                        status: "error",
                        error: data.error,
                      }
                    : r,
                ),
              )
            }
          } catch (error) {
            console.log(`❌ Buy error for wallet ${index + 1}:`, error)
            setResults((prev) =>
              prev.map((r) =>
                r.id === resultId
                  ? {
                      ...r,
                      status: "error",
                      error: error instanceof Error ? error.message : "Unknown error",
                    }
                  : r,
              ),
            )
          }
        })

        await Promise.allSettled(tradePromises)
        console.log("🎯 All buy trades completed")
      } finally {
        setIsTrading(false)
      }
    },
    [],
  )

  const executeSell = useCallback(
    async (
      wallets: Array<{ id: string; privateKey: string; address: string }>,
      tokenMint: string,
      percentage: number,
      slippage = 50,
    ) => {
      if (wallets.length === 0) {
        throw new Error("No wallets available for trading")
      }

      setIsTrading(true)

      try {
        // Create pending results for all wallets
        const pendingResults: TradeResult[] = wallets.map((wallet, index) => ({
          id: `sell-${Date.now()}-${index}`,
          walletAddress: wallet.address,
          type: "sell",
          tokenMint,
          amount: `${percentage}%`,
          status: "pending",
          timestamp: Date.now(),
        }))

        setResults((prev) => [...pendingResults, ...prev])

        // Execute trades for all wallets simultaneously
        const tradePromises = wallets.map(async (wallet, index) => {
          const resultId = pendingResults[index].id

          try {
            console.log(`🔥 Starting sell for wallet ${index + 1}: ${wallet.address.slice(0, 8)}...`)

            const response = await fetch("/api/sell", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                privateKey: wallet.privateKey,
                tokenMint,
                percentage,
                slippage,
                walletIndex: index,
              }),
            })

            const data = await response.json()

            if (data.success) {
              console.log(`✅ Sell successful for wallet ${index + 1}: ${data.signature}`)
              setResults((prev) =>
                prev.map((r) =>
                  r.id === resultId
                    ? {
                        ...r,
                        status: "success",
                        signature: data.signature,
                        explorerUrl: data.explorerUrl,
                      }
                    : r,
                ),
              )
            } else {
              console.log(`❌ Sell failed for wallet ${index + 1}: ${data.error}`)
              setResults((prev) =>
                prev.map((r) =>
                  r.id === resultId
                    ? {
                        ...r,
                        status: "error",
                        error: data.error,
                      }
                    : r,
                ),
              )
            }
          } catch (error) {
            console.log(`❌ Sell error for wallet ${index + 1}:`, error)
            setResults((prev) =>
              prev.map((r) =>
                r.id === resultId
                  ? {
                      ...r,
                      status: "error",
                      error: error instanceof Error ? error.message : "Unknown error",
                    }
                  : r,
              ),
            )
          }
        })

        await Promise.allSettled(tradePromises)
        console.log("🎯 All sell trades completed")
      } finally {
        setIsTrading(false)
      }
    },
    [],
  )

  const clearResults = useCallback(() => {
    setResults([])
    console.log("🗑️ Results cleared")
  }, [])

  return {
    results,
    isTrading,
    executeBuy,
    executeSell,
    clearResults,
  }
}
