"use client"

import { useState, useEffect } from "react"
import { Connection } from "@solana/web3.js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Activity, Wifi, WifiOff, RefreshCw } from "lucide-react"

interface RPCEndpoint {
  name: string
  url: string
  status: "checking" | "online" | "offline"
  latency?: number
}

export function ConnectionDiagnostics() {
  const [endpoints, setEndpoints] = useState<RPCEndpoint[]>([
    {
      name: "Primary RPC",
      url: process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
      status: "checking",
    },
    { name: "Helius", url: "https://rpc.helius.xyz/?api-key=demo", status: "checking" },
    { name: "QuickNode", url: "https://solana-mainnet.g.alchemy.com/v2/demo", status: "checking" },
    { name: "Ankr", url: "https://rpc.ankr.com/solana", status: "checking" },
  ])

  const testEndpoint = async (endpoint: RPCEndpoint): Promise<RPCEndpoint> => {
    const startTime = Date.now()
    try {
      const connection = new Connection(endpoint.url, { commitment: "confirmed" })
      await connection.getSlot()
      const latency = Date.now() - startTime
      return { ...endpoint, status: "online", latency }
    } catch (error) {
      return { ...endpoint, status: "offline", latency: undefined }
    }
  }

  const testAllEndpoints = async () => {
    setEndpoints((prev) => prev.map((ep) => ({ ...ep, status: "checking" })))

    const results = await Promise.all(endpoints.map(testEndpoint))
    setEndpoints(results)
  }

  useEffect(() => {
    testAllEndpoints()
  }, [])

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

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Activity className="w-5 h-5" />
          RPC Connection Status
        </CardTitle>
      </CardHeader>
      <CardContent>
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
                  <div className="text-gray-400 text-sm font-mono">{endpoint.url.slice(0, 40)}...</div>
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
        <Button onClick={testAllEndpoints} className="w-full mt-4 bg-blue-600 hover:bg-blue-700">
          <RefreshCw className="w-4 h-4 mr-2" />
          Test All Endpoints
        </Button>
      </CardContent>
    </Card>
  )
}
