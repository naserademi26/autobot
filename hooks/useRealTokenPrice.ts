"use client"

import { useState, useCallback } from "react"

interface TokenPrice {
  price: number
  timestamp: number
  tokenMint: string
}

export function useRealTokenPrice() {
  const [tokenPrice, setTokenPrice] = useState<TokenPrice | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrice = useCallback(async (tokenMint: string) => {
    if (!tokenMint || tokenMint.length < 32) {
      setError("Invalid token mint address")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log(`💰 Fetching price for token: ${tokenMint.slice(0, 8)}...`)

      // Try Jupiter price API first
      try {
        const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMint}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        })

        if (response.ok) {
          const data = await response.json()
          if (data.data && data.data[tokenMint] && data.data[tokenMint].price) {
            const price = data.data[tokenMint].price
            const priceData: TokenPrice = {
              price,
              timestamp: Date.now(),
              tokenMint,
            }
            setTokenPrice(priceData)
            console.log(`✅ Jupiter price: $${price.toFixed(8)}`)
            return
          }
        }
      } catch (jupiterError) {
        console.log("❌ Jupiter price API failed, trying quote method...")
      }

      // Fallback: Use quote API to estimate price
      try {
        const solAmount = 1000000000 // 1 SOL in lamports
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenMint}&amount=${solAmount}&slippageBps=100`

        const quoteResponse = await fetch(quoteUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        })

        if (quoteResponse.ok) {
          const quoteData = await quoteResponse.json()
          if (quoteData.outAmount) {
            // Calculate price: 1 SOL / tokens received
            const tokensPerSol = Number(quoteData.outAmount)
            const pricePerToken = 1 / tokensPerSol

            // Get current SOL price (approximate)
            const solPriceResponse = await fetch(
              "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
            )
            let solPrice = 100 // fallback SOL price

            if (solPriceResponse.ok) {
              const solPriceData = await solPriceResponse.json()
              solPrice = solPriceData.solana?.usd || 100
            }

            const estimatedPrice = pricePerToken * solPrice

            const priceData: TokenPrice = {
              price: estimatedPrice,
              timestamp: Date.now(),
              tokenMint,
            }
            setTokenPrice(priceData)
            console.log(`✅ Estimated price: $${estimatedPrice.toFixed(8)}`)
            return
          }
        }
      } catch (quoteError) {
        console.log("❌ Quote price estimation failed")
      }

      throw new Error("Unable to fetch token price from any source")
    } catch (error) {
      console.error("❌ Price fetch failed:", error)
      setError(error instanceof Error ? error.message : "Failed to fetch price")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearPrice = useCallback(() => {
    setTokenPrice(null)
    setError(null)
    console.log("🗑️ Token price cleared")
  }, [])

  return {
    tokenPrice,
    isLoading,
    error,
    fetchPrice,
    clearPrice,
  }
}
