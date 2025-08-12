"use client"

import { useState, useEffect, useCallback } from "react"

interface ConnectionStatus {
  isConnected: boolean
  latency: number
  lastCheck: number
  endpoint: string
}

const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://api.mainnet-beta.solana.com",
]

export function useBloxrouteConnection() {
  const [status, setStatus] = useState<ConnectionStatus>({
    isConnected: false,
    latency: 0,
    lastCheck: 0,
    endpoint: RPC_ENDPOINTS[0],
  })

  const checkConnection = useCallback(async (endpoint: string): Promise<{ connected: boolean; latency: number }> => {
    try {
      const startTime = Date.now()

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_BLOXROUTE_API_KEY}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSlot",
          params: [],
        }),
      })

      const endTime = Date.now()
      const latency = endTime - startTime

      if (response.ok) {
        const data = await response.json()
        if (data.result !== undefined) {
          return { connected: true, latency }
        }
      }

      return { connected: false, latency: 0 }
    } catch (error) {
      console.error(`❌ Connection check failed for ${endpoint}:`, error)
      return { connected: false, latency: 0 }
    }
  }, [])

  const testConnection = useCallback(async () => {
    console.log("🔄 Testing RPC connection...")

    // Try primary endpoint first
    let result = await checkConnection(RPC_ENDPOINTS[0])

    if (result.connected) {
      setStatus({
        isConnected: true,
        latency: result.latency,
        lastCheck: Date.now(),
        endpoint: RPC_ENDPOINTS[0],
      })
      console.log(`✅ Connected to primary RPC (${result.latency}ms)`)
      return
    }

    // Try fallback endpoint
    result = await checkConnection(RPC_ENDPOINTS[1])

    if (result.connected) {
      setStatus({
        isConnected: true,
        latency: result.latency,
        lastCheck: Date.now(),
        endpoint: RPC_ENDPOINTS[1],
      })
      console.log(`✅ Connected to fallback RPC (${result.latency}ms)`)
      return
    }

    // Try public endpoint
    result = await checkConnection(RPC_ENDPOINTS[2])

    if (result.connected) {
      setStatus({
        isConnected: true,
        latency: result.latency,
        lastCheck: Date.now(),
        endpoint: RPC_ENDPOINTS[2],
      })
      console.log(`✅ Connected to public RPC (${result.latency}ms)`)
      return
    }

    // All failed
    setStatus({
      isConnected: false,
      latency: 0,
      lastCheck: Date.now(),
      endpoint: RPC_ENDPOINTS[0],
    })
    console.log("❌ All RPC endpoints failed")
  }, [checkConnection])

  // Test connection on mount and periodically
  useEffect(() => {
    testConnection()

    const interval = setInterval(() => {
      testConnection()
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [testConnection])

  return {
    status,
    testConnection,
  }
}
