"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRealTokenPrice } from "@/hooks/useRealTokenPrice"
import { toast } from "react-toastify"
import {
  TrendingUp,
  TrendingDown,
  Zap,
  DollarSign,
  RefreshCw,
  Loader2,
  Target,
  CheckCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  Trash2,
  Settings,
} from "lucide-react"

interface TradeResult {
  id: string
  type: "buy" | "sell"
  status: "pending" | "success" | "error"
  walletAddress: string
  amount: string
  tokenAmount?: number
  executionTime?: number
  error?: string
  signature?: string
}

export default function UltraFastTradingPanel() {
  const [tokenMint, setTokenMint] = useState("")
  const [buyAmount, setBuyAmount] = useState("0.01")
  const [slippage, setSlippage] = useState("50")
  const [randomMode, setRandomMode] = useState<"preset" | "custom">("preset")
  const [minPercentage, setMinPercentage] = useState("10")
  const [maxPercentage, setMaxPercentage] = useState("90")
  const [selectedPercentages, setSelectedPercentages] = useState<number[]>([25, 50, 75, 100])
  const [isTrading, setIsTrading] = useState(false)
  const [results, setResults] = useState<TradeResult[]>([])
  const [tradingProgress, setTradingProgress] = useState({ current: 0, total: 0 })
  const [autoSellActive, setAutoSellActive] = useState(false)
  const [autoSellDelay, setAutoSellDelay] = useState("0")
  const { tokenPrice } = useRealTokenPrice(tokenMint)

  const selectedConnectedWallets = [] // Placeholder for selected wallets
  const totalSelectedBalance = 0 // Placeholder for total balance

  const handleGetPrice = async () => {
    if (!tokenMint.trim()) return
    // Placeholder for fetching price
  }

  const handleBuy = async () => {
    if (!tokenMint.trim() || !buyAmount || selectedConnectedWallets.length === 0) return
    // Placeholder for executing buy
  }

  const handleRandomPercentageBuy = async () => {
    if (!tokenMint.trim() || selectedConnectedWallets.length === 0) return
    // Placeholder for executing random percentage buy
  }

  const handleSell = async (percentage: number) => {
    if (!tokenMint.trim() || selectedConnectedWallets.length === 0) return
    // Placeholder for executing sell
  }

  const successfulTrades = results.filter((r) => r.status === "success").length
  const failedTrades = results.filter((r) => r.status === "error").length
  const pendingTrades = results.filter((r) => r.status === "pending").length
  const progressPercentage = tradingProgress.total > 0 ? (tradingProgress.current / tradingProgress.total) * 100 : 0

  const handleAutoSell = async () => {
    if (!tokenMint.trim() || selectedConnectedWallets.length === 0) return

    setAutoSellActive(true)
    try {
      const privateKeys = selectedConnectedWallets.map((w) => w.privateKey)

      const response = await fetch("/api/auto-sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: tokenMint.trim(),
          privateKeys,
          percentage: 100,
          slippageBps: Number.parseInt(slippage) * 100,
          mode: "volume",
          delayMinutes: Number.parseInt(autoSellDelay) || 0,
        }),
      })

      const result = await response.json()
      console.log("Auto-sell result:", result)

      if (result.success) {
        const delayText =
          Number.parseInt(autoSellDelay) > 0 ? ` (scheduled in ${autoSellDelay} minutes)` : " (immediate)"
        toast.success(`Auto-sell monitoring started${delayText}`)
      } else {
        toast.error(`Auto-sell failed: ${result.error}`)
      }
    } catch (error) {
      console.error("Auto-sell error:", error)
      toast.error("Auto-sell request failed")
    } finally {
      setAutoSellActive(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Trading Controls */}
      <Card className="bg-black/40 backdrop-blur-sm border-green-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-green-400" />🔥 Maximum Speed Trading Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Selected Wallets Info */}
          <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-400">{selectedConnectedWallets.length}</div>
                <div className="text-xs text-blue-300">Selected Wallets</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400">{totalSelectedBalance.toFixed(4)}</div>
                <div className="text-xs text-green-300">Total SOL</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-400">⚡</div>
                <div className="text-xs text-yellow-300">Lightning Speed</div>
              </div>
            </div>
          </div>

          {/* Speed Warning */}
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3">
            <div className="text-center">
              <div className="text-lg font-bold text-red-400">🔥 MAXIMUM SPEED MODE</div>
              <div className="text-sm text-red-300">
                ALL {selectedConnectedWallets.length} WALLETS FIRE SIMULTANEOUSLY
              </div>
              <div className="text-xs text-red-200">NO DELAYS - MAXIMUM SPEED</div>
            </div>
          </div>

          {/* Token Mint */}
          <div className="space-y-2">
            <Label className="text-slate-300">Token Mint Address</Label>
            <div className="flex gap-2">
              <Input
                value={tokenMint}
                onChange={(e) => setTokenMint(e.target.value)}
                placeholder="Enter token mint address"
                className="bg-slate-800 border-slate-600 text-white flex-1"
              />
              <Button
                onClick={handleGetPrice}
                disabled={false || !tokenMint.trim()}
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
              >
                {false ? <RefreshCw className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Token Price Display */}
          {tokenPrice && (
            <div className="bg-green-900/20 border border-green-600/50 rounded-lg p-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">${tokenPrice.toFixed(8)}</div>
                <div className="text-sm text-green-300">Current Token Price</div>
              </div>
            </div>
          )}

          {/* Trading Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-slate-300">Buy Amount (SOL)</Label>
              <Input
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                placeholder="0.01"
                type="number"
                step="0.001"
                min="0.001"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Slippage (%)</Label>
              <Input
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                placeholder="50"
                type="number"
                min="1"
                max="100"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
          </div>

          <Separator className="bg-slate-600" />

          {/* Percentage Settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-orange-400" />
              <Label className="text-slate-300">Percentage Buy Settings</Label>
            </div>

            {/* Mode Selection */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Mode</Label>
              <Select value={randomMode} onValueChange={(value: "preset" | "custom") => setRandomMode(value)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="preset" className="text-white">
                    Exact Percentages
                  </SelectItem>
                  <SelectItem value="custom" className="text-white">
                    Random Range
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Preset Range Selection */}
            {randomMode === "preset" && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">Exact Percentage</Label>
                <Select
                  value={selectedPercentages[0]}
                  onValueChange={(value) => setSelectedPercentages([Number(value)])}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="25" className="text-white">
                      25% Exact
                    </SelectItem>
                    <SelectItem value="50" className="text-white">
                      50% Exact
                    </SelectItem>
                    <SelectItem value="75" className="text-white">
                      75% Exact
                    </SelectItem>
                    <SelectItem value="100" className="text-white">
                      100% Exact (All Balance)
                    </SelectItem>
                    <SelectItem value="10" className="text-white">
                      10% Conservative
                    </SelectItem>
                    <SelectItem value="33" className="text-white">
                      33% Moderate
                    </SelectItem>
                    <SelectItem value="66" className="text-white">
                      66% Aggressive
                    </SelectItem>
                    <SelectItem value="95" className="text-white">
                      95% High Risk
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Custom Range Inputs */}
            {randomMode === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Min %</Label>
                  <Input
                    value={minPercentage}
                    onChange={(e) => setMinPercentage(e.target.value)}
                    placeholder="10"
                    type="number"
                    min="1"
                    max="99"
                    className="bg-slate-800 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Max %</Label>
                  <Input
                    value={maxPercentage}
                    onChange={(e) => setMaxPercentage(e.target.value)}
                    placeholder="90"
                    type="number"
                    min="2"
                    max="100"
                    className="bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-slate-600" />

          {/* Trading Progress */}
          {isTrading && (
            <div className="bg-red-900/20 border border-red-600 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-red-400 font-medium">
                  🔥 FIRING ALL {tradingProgress.total} WALLETS SIMULTANEOUSLY
                </span>
                <Badge variant="outline" className="text-red-300">
                  {tradingProgress.current}/{tradingProgress.total}
                </Badge>
              </div>
              <Progress value={progressPercentage} className="h-2 bg-red-900/50" />
              <div className="text-xs text-red-300 mt-1">MAXIMUM SPEED - NO TIMEOUTS</div>
            </div>
          )}

          {/* Buy Controls */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">🔥 Lightning Speed Buy Controls</h3>
            <div className="space-y-2">
              <Button
                onClick={handleBuy}
                disabled={isTrading || !tokenMint.trim() || !buyAmount || selectedConnectedWallets.length === 0}
                className="w-full h-12 text-lg font-bold bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white"
              >
                {isTrading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />🔥 FIRING ALL {tradingProgress.total} WALLETS - NO
                    DELAYS!
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />🔥 LIGHTNING BUY - ALL {selectedConnectedWallets.length} WALLETS (
                    {buyAmount} SOL)
                  </div>
                )}
              </Button>
              <Button
                onClick={handleRandomPercentageBuy}
                disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                className="w-full h-12 text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              >
                {isTrading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />🔥 FIRING % BUY WITH ALL {tradingProgress.total}{" "}
                    WALLETS!
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />🔥 LIGHTNING % BUY (
                    {randomMode === "preset" ? `${selectedPercentages[0]}%` : `${minPercentage}%-${maxPercentage}%`}) -
                    ALL {selectedConnectedWallets.length} WALLETS
                  </div>
                )}
              </Button>
            </div>
          </div>

          {/* Sell Controls */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">🔥 Lightning Speed Sell Controls</h3>
            <div className="grid grid-cols-2 gap-2">
              {selectedPercentages.map((pct) => (
                <Button
                  key={pct}
                  onClick={() => handleSell(pct)}
                  disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                  variant="outline"
                  className="border-red-600 text-red-400 hover:bg-red-900/20"
                >
                  <TrendingDown className="h-4 w-4 mr-1" />🔥 {pct}%
                </Button>
              ))}
            </div>
          </div>

          {/* Auto-sell Settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-400" />
              <Label className="text-slate-300">3) Auto-sell settings</Label>
            </div>
            <div className="text-xs text-slate-400">Sell percentage when triggered:</div>
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <Button
                  key={pct}
                  variant="outline"
                  size="sm"
                  className="border-purple-600 text-purple-400 hover:bg-purple-900/20 bg-transparent"
                >
                  {pct}%
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Delay after buy detection (minutes)</Label>
              <Input
                value={autoSellDelay}
                onChange={(e) => setAutoSellDelay(e.target.value)}
                placeholder="0"
                type="number"
                min="0"
                max="60"
                className="bg-slate-800 border-slate-600 text-white"
              />
              <div className="text-xs text-slate-400">
                0 = immediate sell, 1-60 = wait X minutes after detecting buy activity
              </div>
            </div>

            <div className="text-xs text-slate-400">
              {Number.parseInt(autoSellDelay) > 0
                ? `2000 bps = 20%. Higher slippage = faster buys/sells.`
                : "2000 bps = 20%. Higher slippage = faster buys/sells."}
            </div>
            <Button
              onClick={handleAutoSell}
              disabled={autoSellActive || !tokenMint.trim() || selectedConnectedWallets.length === 0}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {autoSellActive ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {Number.parseInt(autoSellDelay) > 0
                    ? `Scheduling auto-sell (${autoSellDelay}min delay)...`
                    : "Starting auto-sell..."}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  AUTO SELL
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Panel */}
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />🔥 Lightning Speed Results ({results.length})
            </div>
            <Button
              onClick={() => setResults([])}
              disabled={results.length === 0}
              size="sm"
              variant="ghost"
              className="text-slate-400 hover:bg-slate-700 h-8 w-8 p-0"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-green-900/20 border border-green-600/50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-green-400">{successfulTrades}</div>
              <div className="text-xs text-slate-400">Success</div>
            </div>
            <div className="bg-red-900/20 border border-red-600/50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-red-400">{failedTrades}</div>
              <div className="text-xs text-slate-400">Failed</div>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-yellow-400">{pendingTrades}</div>
              <div className="text-xs text-slate-400">Pending</div>
            </div>
          </div>

          {/* Results List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {results.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No trades yet</p>
                <p className="text-sm">Execute a lightning speed trade to see results</p>
              </div>
            ) : (
              results
                .slice()
                .reverse()
                .map((result) => (
                  <Card key={result.id} className="bg-slate-800/50 border-slate-600">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={result.type === "buy" ? "default" : "outline"}
                              className={`text-xs ${result.type === "buy" ? "bg-green-600" : "border-red-600 text-red-400"}`}
                            >
                              🔥 {result.type.toUpperCase()}
                            </Badge>
                            {result.status === "pending" && <Clock className="h-3 w-3 text-yellow-400" />}
                            {result.status === "success" && <CheckCircle className="h-3 w-3 text-green-400" />}
                            {result.status === "error" && <AlertCircle className="h-3 w-3 text-red-400" />}
                            {result.amount.includes("% of balance") && (
                              <Badge variant="outline" className="text-xs border-orange-500 text-orange-400">
                                🎯 EXACT
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate mt-1 font-mono">
                            {result.walletAddress.slice(0, 8)}...{result.walletAddress.slice(-4)}
                          </p>
                          <p className="text-sm text-white">{result.amount}</p>
                          {result.tokenAmount && (
                            <p className="text-xs text-green-400">
                              {result.type === "buy"
                                ? `${result.tokenAmount.toFixed(2)} tokens`
                                : `${result.tokenAmount.toFixed(4)} SOL`}
                            </p>
                          )}
                          {result.executionTime && (
                            <p className="text-xs text-blue-400">
                              ⚡ {result.executionTime}ms
                              {result.executionTime < 1000 && " 🔥"}
                            </p>
                          )}
                          {result.error && <p className="text-xs text-red-400 mt-1 truncate">{result.error}</p>}
                        </div>
                        {result.signature && (
                          <Button
                            onClick={() => window.open(`https://solscan.io/tx/${result.signature}`, "_blank")}
                            size="sm"
                            variant="ghost"
                            className="text-blue-400 hover:bg-blue-900/20 h-8 w-8 p-0"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
