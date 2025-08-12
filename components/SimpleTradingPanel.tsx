"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Loader2, Zap } from "lucide-react"
import { useSimpleTrading } from "@/hooks/useSimpleTrading"

interface SimpleTradingPanelProps {
  wallets: any[]
  selectedWallets: string[]
}

export function SimpleTradingPanel({ wallets, selectedWallets }: SimpleTradingPanelProps) {
  const [tokenMint, setTokenMint] = useState("")
  const [buyAmount, setBuyAmount] = useState("0.01")
  const { isTrading, executeBuy, executeSell } = useSimpleTrading()

  const selectedWalletObjects = wallets.filter((w) => selectedWallets.includes(w.id) && w.connected)
  const connectedWallets = wallets.filter((w) => w.connected)

  const handleBuyAll = async () => {
    if (selectedWalletObjects.length === 0) {
      alert("Select wallets first!")
      return
    }
    await executeBuy(selectedWalletObjects, tokenMint, Number.parseFloat(buyAmount))
  }

  const handleSellWallet = async (wallet: any, percentage: number) => {
    await executeSell(wallet, tokenMint, percentage)
  }

  return (
    <div className="space-y-6">
      {/* Simple Trading Controls */}
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5" />⚡ SIMPLE TRADING
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token Input */}
          <div>
            <Label className="text-white text-sm">🎯 Token Mint Address</Label>
            <Input
              value={tokenMint}
              onChange={(e) => setTokenMint(e.target.value)}
              placeholder="Enter pump.fun token mint address..."
              className="bg-black/30 border-gray-600 text-white font-mono"
            />
          </div>

          {/* Buy Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-white text-sm">💰 Buy Amount (SOL)</Label>
              <Input
                type="number"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                step="0.001"
                className="bg-black/30 border-gray-600 text-white"
              />
            </div>
            <div className="flex items-end">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{selectedWalletObjects.length}</div>
                <div className="text-xs text-gray-400">Selected</div>
              </div>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleBuyAll}
                disabled={isTrading || selectedWalletObjects.length === 0 || !tokenMint.trim()}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold h-12"
              >
                {isTrading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    BUYING...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4 mr-2" />
                    BUY ALL ({selectedWalletObjects.length})
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual Wallet Controls */}
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingDown className="w-5 h-5" />🔥 QUICK SELL - Individual Wallets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {connectedWallets.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No connected wallets</p>
              <p className="text-sm">Connect wallets to start selling</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connectedWallets.map((wallet) => (
                <Card key={wallet.id} className="bg-black/20 border-gray-700">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-white font-semibold text-sm">{wallet.name}</h3>
                        <p className="text-gray-400 text-xs font-mono">
                          {wallet.publicKey.slice(0, 6)}...{wallet.publicKey.slice(-6)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          selectedWallets.includes(wallet.id)
                            ? "bg-green-500/20 text-green-400 border-green-500/50"
                            : "bg-gray-500/20 text-gray-400 border-gray-500/50"
                        }
                      >
                        {wallet.balance.toFixed(3)} SOL
                      </Badge>
                    </div>

                    <div className="grid grid-cols-5 gap-1">
                      <Button
                        onClick={() => handleSellWallet(wallet, 25)}
                        disabled={isTrading || !tokenMint.trim()}
                        size="sm"
                        className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold"
                      >
                        {isTrading ? <Loader2 className="w-3 h-3 animate-spin" /> : "25%"}
                      </Button>
                      <Button
                        onClick={() => handleSellWallet(wallet, 50)}
                        disabled={isTrading || !tokenMint.trim()}
                        size="sm"
                        className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold"
                      >
                        {isTrading ? <Loader2 className="w-3 h-3 animate-spin" /> : "50%"}
                      </Button>
                      <Button
                        onClick={() => handleSellWallet(wallet, 75)}
                        disabled={isTrading || !tokenMint.trim()}
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
                      >
                        {isTrading ? <Loader2 className="w-3 h-3 animate-spin" /> : "75%"}
                      </Button>
                      <Button
                        onClick={() => handleSellWallet(wallet, 95)}
                        disabled={isTrading || !tokenMint.trim()}
                        size="sm"
                        className="bg-red-700 hover:bg-red-800 text-white text-xs font-bold"
                      >
                        {isTrading ? <Loader2 className="w-3 h-3 animate-spin" /> : "95%"}
                      </Button>
                      <Button
                        onClick={() => handleSellWallet(wallet, 100)}
                        disabled={isTrading || !tokenMint.trim()}
                        size="sm"
                        className="bg-red-800 hover:bg-red-900 text-white text-xs font-bold"
                      >
                        {isTrading ? <Loader2 className="w-3 h-3 animate-spin" /> : "ALL"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!tokenMint.trim() && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
          <p className="text-yellow-300 text-center">⚠️ Enter token mint address to enable trading</p>
        </div>
      )}
    </div>
  )
}
