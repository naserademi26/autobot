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
import { useUltraFastTrading } from "@/hooks/useUltraFastTrading"
import { useRealTokenPrice } from "@/hooks/useRealTokenPrice"
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
import type { WalletData } from "@/hooks/useWalletManager"

interface UltraFastTradingPanelProps {
  wallets: WalletData[]
  selectedWallets: string[]
}

export function UltraFastTradingPanel({ wallets, selectedWallets }: UltraFastTradingPanelProps) {
  const [tokenMint, setTokenMint] = useState("")
  const [buyAmount, setBuyAmount] = useState("0.01")
  const [slippage, setSlippage] = useState("50")
  const [randomMode, setRandomMode] = useState<"preset" | "custom">("preset")
  const [minPercent, setMinPercent] = useState("25")
  const [maxPercent, setMaxPercent] = useState("100")
  const [presetRange, setPresetRange] = useState("25")

  const { results, isTrading, tradingProgress, executeBuy, executeRandomPercentageBuy, executeSell, clearResults } =
    useUltraFastTrading()
  const { tokenPrice, isLoading: isPriceLoading, fetchPrice } = useRealTokenPrice()

  const selectedConnectedWallets = wallets.filter((w) => selectedWallets.includes(w.id) && w.connected)
  const totalSelectedBalance = selectedConnectedWallets.reduce((sum, wallet) => sum + wallet.balance, 0)

  const handleGetPrice = async () => {
    if (!tokenMint.trim()) return
    await fetchPrice(tokenMint.trim())
  }

  const handleBuy = async () => {
    if (!tokenMint.trim() || !buyAmount || selectedConnectedWallets.length === 0) return
    await executeBuy(
      selectedConnectedWallets,
      tokenMint.trim(),
      Number.parseFloat(buyAmount),
      Number.parseInt(slippage),
    )
  }

  const handleRandomPercentageBuy = async () => {
    if (!tokenMint.trim() || selectedConnectedWallets.length === 0) return

    let min: number, max: number

    if (randomMode === "preset") {
      // Use exact percentage for preset mode
      const exactPercent = Number.parseInt(presetRange)
      min = exactPercent
      max = exactPercent
    } else {
      min = Number.parseInt(minPercent)
      max = Number.parseInt(maxPercent)
    }

    if (randomMode === "custom" && min >= max) {
      console.error("❌ Min percentage must be less than max percentage")
      return
    }

    await executeRandomPercentageBuy(selectedConnectedWallets, tokenMint.trim(), Number.parseInt(slippage), min, max)
  }

  const handleSell = async (percentage: number) => {
    if (!tokenMint.trim() || selectedConnectedWallets.length === 0) return
    await executeSell(selectedConnectedWallets, tokenMint.trim(), percentage, Number.parseInt(slippage))
  }

  const successfulTrades = results.filter((r) => r.status === "success").length
  const failedTrades = results.filter((r) => r.status === "error").length
  const pendingTrades = results.filter((r) => r.status === "pending").length
  const progressPercentage = tradingProgress.total > 0 ? (tradingProgress.current / tradingProgress.total) * 100 : 0

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
                disabled={isPriceLoading || !tokenMint.trim()}
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isPriceLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Token Price Display */}
          {tokenPrice && (
            <div className="bg-green-900/20 border border-green-600/50 rounded-lg p-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">${tokenPrice.price.toFixed(8)}</div>
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
                <Select value={presetRange} onValueChange={setPresetRange}>
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
                    value={minPercent}
                    onChange={(e) => setMinPercent(e.target.value)}
                    placeholder="25"
                    type="number"
                    min="1"
                    max="99"
                    className="bg-slate-800 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Max %</Label>
                  <Input
                    value={maxPercent}
                    onChange={(e) => setMaxPercent(e.target.value)}
                    placeholder="100"
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
                    {randomMode === "preset" ? `${presetRange}%` : `${minPercent}%-${maxPercent}%`}) - ALL{" "}
                    {selectedConnectedWallets.length} WALLETS
                  </div>
                )}
              </Button>
            </div>
          </div>

          {/* Sell Controls */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">🔥 Lightning Speed Sell Controls</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => handleSell(25)}
                disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20"
              >
                <TrendingDown className="h-4 w-4 mr-1" />🔥 25%
              </Button>
              <Button
                onClick={() => handleSell(50)}
                disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20"
              >
                <TrendingDown className="h-4 w-4 mr-1" />🔥 50%
              </Button>
              <Button
                onClick={() => handleSell(75)}
                disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20"
              >
                <TrendingDown className="h-4 w-4 mr-1" />🔥 75%
              </Button>
              <Button
                onClick={() => handleSell(100)}
                disabled={isTrading || !tokenMint.trim() || selectedConnectedWallets.length === 0}
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20"
              >
                <TrendingDown className="h-4 w-4 mr-1" />🔥 100%
              </Button>
            </div>
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
              onClick={clearResults}
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
