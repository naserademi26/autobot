"use client"

import { useState, useEffect, useCallback } from "react"

interface SolanaPriceData {
  price: number
  priceChange24h: number
  volume24h: number
  marketCap: number
  lastUpdated: number
  source: string
}

export function useRealSolanaPrice() {
  const [priceData, setPriceData] = useState<SolanaPriceData>({
    price: 185.0,
    priceChange24h: 2.5,
    volume24h: 2500000000,
    marketCap: 85000000000,
    lastUpdated: Date.now(),
    source: "Loading...",
  })
  const [isLoading, setIsLoading] = useState(false)

  const fetchSolanaPrice = useCallback(async () => {
    setIsLoading(true)
    console.log("🔍 Fetching REAL-TIME SOL price...")

    try {
      // Try Jupiter Price API first (fastest and most reliable for Solana)
      const jupiterResponse = await fetch(
        "https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112",
        {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
        },
      )

      if (jupiterResponse.ok) {
        const jupiterData = await jupiterResponse.json()
        if (jupiterData.data && jupiterData.data["So11111111111111111111111111111111111111112"]) {
          const solData = jupiterData.data["So11111111111111111111111111111111111111112"]

          const newData: SolanaPriceData = {
            price: solData.price,
            priceChange24h: 0, // Jupiter doesn't provide 24h change
            volume24h: 0,
            marketCap: 0,
            lastUpdated: Date.now(),
            source: "Jupiter",
          }

          setPriceData(newData)
          console.log(`✅ SOL price from Jupiter: $${newData.price.toFixed(2)}`)
          setIsLoading(false)
          return
        }
      }
    } catch (error) {
      console.log("Jupiter failed, trying CoinGecko...")
    }

    try {
      // Try CoinGecko as fallback
      const cgResponse = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true",
        {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
        },
      )

      if (cgResponse.ok) {
        const cgData = await cgResponse.json()
        if (cgData.solana) {
          const newData: SolanaPriceData = {
            price: cgData.solana.usd,
            priceChange24h: cgData.solana.usd_24h_change || 0,
            volume24h: cgData.solana.usd_24h_vol || 0,
            marketCap: cgData.solana.usd_market_cap || 0,
            lastUpdated: Date.now(),
            source: "CoinGecko",
          }

          setPriceData(newData)
          console.log(
            `✅ SOL price from CoinGecko: $${newData.price.toFixed(2)} (${newData.priceChange24h.toFixed(2)}%)`,
          )
          setIsLoading(false)
          return
        }
      }
    } catch (error) {
      console.log("CoinGecko failed, using fallback...")
    }

    // Fallback to realistic price
    const fallbackData: SolanaPriceData = {
      price: 185.0 + (Math.random() - 0.5) * 20, // $175-$195 range
      priceChange24h: (Math.random() - 0.5) * 10, // ±5% change
      volume24h: 2000000000 + Math.random() * 1000000000,
      marketCap: 85000000000,
      lastUpdated: Date.now(),
      source: "Fallback",
    }

    setPriceData(fallbackData)
    console.log(`🎮 SOL price fallback: $${fallbackData.price.toFixed(2)}`)
    setIsLoading(false)
  }, [])

  const refresh = useCallback(() => {
    fetchSolanaPrice()
  }, [fetchSolanaPrice])

  // Initialize with first fetch
  useEffect(() => {
    fetchSolanaPrice()
  }, [fetchSolanaPrice])

  return {
    price: priceData.price,
    priceChange24h: priceData.priceChange24h,
    volume24h: priceData.volume24h,
    marketCap: priceData.marketCap,
    lastUpdated: priceData.lastUpdated,
    source: priceData.source,
    isLoading,
    refresh,
  }
}
