"use client"

import { useState, useCallback } from "react"

export interface PumpFunToken {
  mint: string
  name: string
  symbol: string
  description: string
  image: string
  createdTimestamp: number
  raydiumPool?: string
  complete: boolean
  virtualSolReserves: number
  virtualTokenReserves: number
  totalSupply: number
  website?: string
  telegram?: string
  twitter?: string
  bondingCurveKey: string
  associatedBondingCurveKey: string
  creatorAddress: string
  metadataUri: string
  showName: boolean
  kingOfTheHillTimestamp?: number
  marketCapSol: number
  usdMarketCap: number
  reply_count: number
  last_reply: number
  nsfw: boolean
  market_id?: string
  inverted?: boolean
}

export function usePumpFunData() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getTokenData = useCallback(async (mint: string): Promise<PumpFunToken | null> => {
    setLoading(true)
    setError(null)

    try {
      // Try multiple PumpFun API endpoints
      const endpoints = [
        `https://frontend-api.pump.fun/coins/${mint}`,
        `https://pumpportal.fun/api/data/${mint}`,
        `https://api.pump.fun/coins/${mint}`,
      ]

      let tokenData: PumpFunToken | null = null
      let lastError: Error | null = null

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json",
            },
          })

          if (response.ok) {
            tokenData = await response.json()
            break
          }
        } catch (err) {
          lastError = err as Error
          continue
        }
      }

      if (!tokenData) {
        throw new Error(`Failed to fetch token data: ${lastError?.message || "All endpoints failed"}`)
      }

      return tokenData
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch token data"
      setError(errorMessage)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const getNewTokens = useCallback(async (limit = 50): Promise<PumpFunToken[]> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `https://frontend-api.pump.fun/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
          },
        },
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      return data || []
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch new tokens"
      setError(errorMessage)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const getTrendingTokens = useCallback(async (): Promise<PumpFunToken[]> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=usd_market_cap&order=DESC&includeNsfw=false",
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
          },
        },
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      return data || []
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch trending tokens"
      setError(errorMessage)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getTokenData,
    getNewTokens,
    getTrendingTokens,
  }
}
