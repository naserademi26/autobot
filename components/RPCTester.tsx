"use client"

import { useState } from "react"
import { Connection, PublicKey } from "@solana/web3.js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TestTube, Zap, Clock, CheckCircle, XCircle } from "lucide-react"

interface TestResult {
  test: string
  status: "success" | "failed" | "pending"
  duration: number
  result?: any
  error?: string
}

export function RPCTester() {
  const [rpcUrl, setRpcUrl] = useState(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com")
  const [testAddress, setTestAddress] = useState("11111111111111111111111111111112") // System Program
  const [results, setResults] = useState<TestResult[]>([])
  const [testing, setTesting] = useState(false)

  const addResult = (test: string, status: "success" | "failed", duration: number, result?: any, error?: string) => {
    setResults((prev) => [...prev, { test, status, duration, result, error }])
  }

  const runBasicTests = async () => {
    setTesting(true)
    setResults([])

    try {
      const connection = new Connection(rpcUrl, { commitment: "confirmed" })

      // Test 1: Get Slot
      let startTime = Date.now()
      try {
        const slot = await connection.getSlot()
        addResult("Get Current Slot", "success", Date.now() - startTime, slot)
      } catch (error) {
        addResult(
          "Get Current Slot",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }

      // Test 2: Get Block Height
      startTime = Date.now()
      try {
        const blockHeight = await connection.getBlockHeight()
        addResult("Get Block Height", "success", Date.now() - startTime, blockHeight)
      } catch (error) {
        addResult(
          "Get Block Height",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }

      // Test 3: Get Account Info
      startTime = Date.now()
      try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(testAddress))
        addResult(
          "Get Account Info",
          "success",
          Date.now() - startTime,
          accountInfo ? "Account found" : "Account not found",
        )
      } catch (error) {
        addResult(
          "Get Account Info",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }

      // Test 4: Get Recent Blockhash
      startTime = Date.now()
      try {
        const { blockhash } = await connection.getLatestBlockhash()
        addResult("Get Latest Blockhash", "success", Date.now() - startTime, blockhash.slice(0, 16) + "...")
      } catch (error) {
        addResult(
          "Get Latest Blockhash",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }

      // Test 5: Get Version
      startTime = Date.now()
      try {
        const version = await connection.getVersion()
        addResult("Get Version", "success", Date.now() - startTime, version["solana-core"])
      } catch (error) {
        addResult(
          "Get Version",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }
    } catch (error) {
      addResult("Connection Test", "failed", 0, undefined, error instanceof Error ? error.message : "Unknown error")
    } finally {
      setTesting(false)
    }
  }

  const runPerformanceTests = async () => {
    setTesting(true)
    setResults([])

    try {
      const connection = new Connection(rpcUrl, { commitment: "confirmed" })
      const iterations = 10

      // Latency Test
      const latencies: number[] = []
      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now()
        try {
          await connection.getSlot()
          latencies.push(Date.now() - startTime)
        } catch (error) {
          addResult(
            `Latency Test ${i + 1}`,
            "failed",
            Date.now() - startTime,
            undefined,
            error instanceof Error ? error.message : "Unknown error",
          )
        }
      }

      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
        const minLatency = Math.min(...latencies)
        const maxLatency = Math.max(...latencies)

        addResult("Average Latency", "success", avgLatency, `${avgLatency.toFixed(2)}ms`)
        addResult("Min Latency", "success", minLatency, `${minLatency}ms`)
        addResult("Max Latency", "success", maxLatency, `${maxLatency}ms`)
      }

      // Throughput Test
      const startTime = Date.now()
      const promises = Array(20)
        .fill(null)
        .map(() => connection.getSlot())

      try {
        await Promise.all(promises)
        const duration = Date.now() - startTime
        const throughput = (20 / duration) * 1000 // requests per second
        addResult("Throughput Test", "success", duration, `${throughput.toFixed(2)} req/s`)
      } catch (error) {
        addResult(
          "Throughput Test",
          "failed",
          Date.now() - startTime,
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        )
      }
    } catch (error) {
      addResult("Performance Test", "failed", 0, undefined, error instanceof Error ? error.message : "Unknown error")
    } finally {
      setTesting(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-400" />
      case "failed":
        return <XCircle className="w-4 h-4 text-red-400" />
      default:
        return <Clock className="w-4 h-4 text-yellow-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-500/20 text-green-400 border-green-500/50"
      case "failed":
        return "bg-red-500/20 text-red-400 border-red-500/50"
      default:
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
    }
  }

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <TestTube className="w-5 h-5" />🧪 RPC Endpoint Tester
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Configuration */}
        <div className="space-y-4">
          <div>
            <Label className="text-gray-400">RPC Endpoint URL</Label>
            <Input
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              className="bg-white/10 border-gray-600 text-white font-mono"
              placeholder="https://api.mainnet-beta.solana.com"
            />
          </div>

          <div>
            <Label className="text-gray-400">Test Address (optional)</Label>
            <Input
              value={testAddress}
              onChange={(e) => setTestAddress(e.target.value)}
              className="bg-white/10 border-gray-600 text-white font-mono"
              placeholder="Enter a Solana address to test"
            />
          </div>
        </div>

        {/* Test Controls */}
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white/10">
            <TabsTrigger value="basic" className="data-[state=active]:bg-white/20">
              Basic Tests
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-white/20">
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <Button
              onClick={runBasicTests}
              disabled={testing || !rpcUrl}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {testing ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <TestTube className="w-4 h-4 mr-2" />
                  Run Basic Tests
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <Button
              onClick={runPerformanceTests}
              disabled={testing || !rpcUrl}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {testing ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Running Performance Tests...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Run Performance Tests
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-white font-medium">Test Results:</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {results.map((result, index) => (
                <div key={index} className="p-3 bg-white/5 rounded-lg border border-gray-600/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(result.status)}
                      <span className="text-white font-medium">{result.test}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm">{result.duration}ms</span>
                      <Badge variant="outline" className={getStatusColor(result.status)}>
                        {result.status.toUpperCase()}
                      </Badge>
                    </div>
                  </div>

                  {result.result && <div className="text-green-300 text-sm font-mono">Result: {result.result}</div>}

                  {result.error && <div className="text-red-300 text-sm">Error: {result.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
