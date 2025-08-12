"use client"

import { useState, useEffect, useCallback } from "react"

export function useSolanaPrice() {
  const [price, setPrice] = useState(150) // Default fallback price
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrice = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      console.log("🔍 Fetching SOL price...")
      const response = await fetch("/api/price", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.price && typeof data.price === "number" && data.price > 0) {
        setPrice(data.price)
        console.log(`✅ SOL price updated: $${data.price} (${data.source})`)
      } else {
        throw new Error("Invalid price data received")
      }
    } catch (error) {
      console.error("💥 Price fetch error:", error)
      setError(error instanceof Error ? error.message : "Failed to fetch price")
      // Keep the current price on error, don't reset to fallback
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshPrice = useCallback(() => {
    fetchPrice()
  }, [fetchPrice])

  // Initial fetch and periodic updates
  useEffect(() => {
    fetchPrice()

    // Update price every 30 seconds
    const interval = setInterval(fetchPrice, 30000)

    return () => clearInterval(interval)
  }, [fetchPrice])

  return {
    price,
    isLoading,
    error,
    refreshPrice,
  }
}
