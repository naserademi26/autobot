"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Flame, TrendingUp, Shuffle, Loader2, RefreshCw } from "lucide-react"

interface TradingControlsProps {
  walletManager: any
  trading: any
  solPrice: number
}

export function TradingControls({ walletManager, trading, solPrice }: TradingControlsProps) {
  const [tokenMint, setTokenMint] = useState("")
  const [buyAmount, setBuyAmount] = useState("0.01")
  const [maxBuyAmount, setMaxBuyAmount] = useState("0.05")
  const [slippage, setSlippage] = useState("50")

  const selectedWalletObjects = walletManager.wallets.filter(
    (w: any) => walletManager.selectedWallets.includes(w.id) && w.connected,
  )
  const walletsWithTokens = selectedWalletObjects.filter((w: any) => w.tokenBalance > 0)

  const handleBuy = async () => {
    await trading.executeBuy({
      tokenMint,
      amount: Number.parseFloat(buyAmount),
      slippage: Number.parseFloat(slippage),
      selectedWallets: walletManager.selectedWallets,
    })
  }

  const handleSell = async (percentage: number) => {
    await trading.executeSell({
      tokenMint,
      amount: percentage,
      slippage: Number.parseFloat(slippage),
      selectedWallets: walletManager.selectedWallets,
    })
  }

  const handleRandomBuy = async () => {
    await trading.executeRandomBuy({
      tokenMint,
      minAmount: Number.parseFloat(buyAmount),
      maxAmount: Number.parseFloat(maxBuyAmount),
      slippage: Number.parseFloat(slippage),
      selectedWallets: walletManager.selectedWallets,
    })
  }

  const handleRandomSell = async () => {
    await trading.executeRandomSell({
      tokenMint,
      slippage: Number.parseFloat(slippage),
      selectedWallets: walletManager.selectedWallets,
    })
  }

  return (
    <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Flame className="w-5 h-5" />⚡ ULTRA-FAST TRADING
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Token Input */}
        <div className="space-y-2">
          <Label className="text-white">🎯 Token Mint</Label>
          <Input
            value={tokenMint}
            onChange={(e) => setTokenMint(e.target.value)}
            placeholder="Enter pump.fun token mint..."
            className="bg-black/30 border-gray-600 text-white"
          />
        </div>

        {/* Trading Controls */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-white">Min Buy (SOL)</Label>
            <Input
              type="number"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              step="0.001"
              className="bg-black/30 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label className="text-white">Max Buy (SOL)</Label>
            <Input
              type="number"
              value={maxBuyAmount}
              onChange={(e) => setMaxBuyAmount(e.target.value)}
              step="0.001"
              className="bg-black/30 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label className="text-white">Slippage (%)</Label>
            <Input
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              className="bg-black/30 border-gray-600 text-white"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="w-full bg-blue-600/20 border-blue-500/50 text-blue-300"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Buy Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            onClick={handleBuy}
            disabled={trading.isTrading || selectedWalletObjects.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white font-bold h-12"
          >
            {trading.isTrading ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <TrendingUp className="w-5 h-5 mr-2" />
            )}
            {trading.isTrading ? "BUYING..." : `⚡ BUY ${buyAmount} SOL (${selectedWalletObjects.length})`}
          </Button>
          <Button
            onClick={handleRandomBuy}
            disabled={trading.isTrading || selectedWalletObjects.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold h-12"
          >
            {trading.isTrading ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Shuffle className="w-5 h-5 mr-2" />
            )}
            {trading.isTrading ? "RANDOM BUYING..." : `🎲 RANDOM BUY (${selectedWalletObjects.length})`}
          </Button>
        </div>

        {/* Sell Buttons */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Button
            onClick={() => handleSell(25)}
            disabled={trading.isTrading || walletsWithTokens.length === 0}
            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold"
          >
            {trading.isTrading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔥 25%"}
          </Button>
          <Button
            onClick={() => handleSell(50)}
            disabled={trading.isTrading || walletsWithTokens.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold"
          >
            {trading.isTrading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔥 50%"}
          </Button>
          <Button
            onClick={() => handleSell(75)}
            disabled={trading.isTrading || walletsWithTokens.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white font-bold"
          >
            {trading.isTrading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔥 75%"}
          </Button>
          <Button
            onClick={() => handleSell(100)}
            disabled={trading.isTrading || walletsWithTokens.length === 0}
            className="bg-red-800 hover:bg-red-900 text-white font-bold"
          >
            {trading.isTrading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔥 ALL"}
          </Button>
          <Button
            onClick={handleRandomSell}
            disabled={trading.isTrading || walletsWithTokens.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold"
          >
            {trading.isTrading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Shuffle className="w-4 h-4 mr-1" />🎲
              </>
            )}
          </Button>
        </div>

        {/* Status */}
        <div className="bg-black/20 p-4 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-green-400">{walletManager.connectedWallets.length}</div>
              <div className="text-sm text-gray-400">Connected</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{walletManager.selectedWallets.length}</div>
              <div className="text-sm text-gray-400">Selected</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">{walletManager.totalBalance.toFixed(4)}</div>
              <div className="text-sm text-gray-400">Total SOL</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-400">{walletManager.totalTokenBalance.toFixed(2)}</div>
              <div className="text-sm text-gray-400">Total Tokens</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
