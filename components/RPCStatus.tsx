"use client"

import { useState, useEffect } from "react"
import { Connection } from "@solana/web3.js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Wifi, WifiOff, RefreshCw, Activity } from "lucide-react"

interface RPCEndpoint {
  name: string
  url: string
  status: "checking" | "online" | "offline"
  latency?: number
  lastChecked?: Date
}

export function RPCStatus() {
  const [endpoints, setEndpoints] = useState<RPCEndpoint[]>([
    {
      name: "Primary RPC",
      url: process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
      status: "checking",
    },
    { name: "Helius", url: "https://rpc.helius.xyz/?api-key=demo", status: "checking" },
    { name: "Alchemy", url: "https://solana-mainnet.g.alchemy.com/v2/demo", status: "checking" },
    { name: "Ankr", url: "https://rpc.ankr.com/solana", status: "checking" },
  ])

  const [autoRefresh, setAutoRefresh] = useState(true)

  const testEndpoint = async (endpoint: RPCEndpoint): Promise<RPCEndpoint> => {
    const startTime = Date.now()
    try {
      const connection = new Connection(endpoint.url, { commitment: "confirmed" })
      await connection.getSlot()
      const latency = Date.now() - startTime
      return {
        ...endpoint,
        status: "online",
        latency,
        lastChecked: new Date(),
      }
    } catch (error) {
      return {
        ...endpoint,
        status: "offline",
        latency: undefined,
        lastChecked: new Date(),
      }
    }
  }

  const testAllEndpoints = async () => {
    setEndpoints((prev) => prev.map((ep) => ({ ...ep, status: "checking" })))

    const results = await Promise.all(endpoints.map(testEndpoint))
    setEndpoints(results)
  }

  useEffect(() => {
    testAllEndpoints()

    if (autoRefresh) {
      const interval = setInterval(testAllEndpoints, 30000) // Test every 30 seconds
      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online":
        return <Wifi className="w-4 h-4 text-green-400" />
      case "offline":
        return <WifiOff className="w-4 h-4 text-red-400" />
      default:
        return <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-green-500/20 text-green-400 border-green-500/50"
      case "offline":
        return "bg-red-500/20 text-red-400 border-red-500/50"
      default:
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
    }
  }

  const onlineCount = endpoints.filter((ep) => ep.status === "online").length
  const avgLatency =
    endpoints.filter((ep) => ep.latency).reduce((sum, ep) => sum + (ep.latency || 0), 0) /
    endpoints.filter((ep) => ep.latency).length

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" />🌐 RPC Status
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                onlineCount > 0
                  ? "bg-green-500/20 text-green-400 border-green-500/50"
                  : "bg-red-500/20 text-red-400 border-red-500/50"
              }
            >
              {onlineCount}/{endpoints.length} Online
            </Badge>
            {avgLatency > 0 && (
              <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/50">
                {Math.round(avgLatency)}ms avg
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-3">
          {endpoints.map((endpoint, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-gray-600/50"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(endpoint.status)}
                <div>
                  <div className="text-white font-medium">{endpoint.name}</div>
                  <div className="text-gray-400 text-sm font-mono">
                    {endpoint.url.length > 50 ? `${endpoint.url.slice(0, 50)}...` : endpoint.url}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {endpoint.latency && <span className="text-gray-300 text-sm">{endpoint.latency}ms</span>}
                <Badge variant="outline" className={getStatusColor(endpoint.status)}>
                  {endpoint.status.toUpperCase()}
                </Badge>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button onClick={testAllEndpoints} className="flex-1 bg-blue-600 hover:bg-blue-700">
            <RefreshCw className="w-4 h-4 mr-2" />
            Test All
          </Button>
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant="outline"
            className={
              autoRefresh
                ? "bg-green-600/20 border-green-500/50 text-green-300"
                : "bg-gray-600/20 border-gray-500/50 text-gray-300"
            }
          >
            Auto: {autoRefresh ? "ON" : "OFF"}
          </Button>
        </div>

        {endpoints.some((ep) => ep.lastChecked) && (
          <div className="text-center text-gray-400 text-xs">
            Last checked: {endpoints.find((ep) => ep.lastChecked)?.lastChecked?.toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
