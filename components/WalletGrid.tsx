"use client"

import type React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Wallet, RefreshCw, Trash2, CheckSquare, Square } from "lucide-react"
import type { WalletData, ImportProgress } from "@/hooks/useWalletManager"

interface WalletGridProps {
  wallets: WalletData[]
  selectedWallets: string[]
  importProgress: ImportProgress
  onToggleWallet: (walletId: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRefreshBalances: () => void
  onRemoveWallet: (walletId: string) => void
  onClearWallets: () => void
  onSellWallet?: (walletId: string, percentage: number) => void
}

export function WalletGrid({
  wallets,
  selectedWallets,
  importProgress,
  onToggleWallet,
  onSelectAll,
  onDeselectAll,
  onRefreshBalances,
  onRemoveWallet,
  onClearWallets,
  onSellWallet,
}: WalletGridProps) {
  const connectedWallets = wallets.filter((w) => w.connected)
  const selectedConnectedWallets = connectedWallets.filter((w) => selectedWallets.includes(w.id))
  const totalBalance = selectedConnectedWallets.reduce((sum, wallet) => sum + wallet.balance, 0)
  const allSelected = connectedWallets.length > 0 && selectedConnectedWallets.length === connectedWallets.length

  const handleWalletCardClick = (walletId: string, wallet: WalletData) => {
    // Only allow selection if wallet is connected
    if (wallet.connected) {
      onToggleWallet(walletId)
    }
  }

  const handleDeleteClick = (e: React.MouseEvent, walletId: string) => {
    // Prevent the card click event from firing when delete button is clicked
    e.stopPropagation()
    onRemoveWallet(walletId)
  }

  const handleSellClick = (e: React.MouseEvent, walletId: string, percentage: number) => {
    // Prevent the card click event from firing when sell button is clicked
    e.stopPropagation()
    if (onSellWallet) {
      onSellWallet(walletId, percentage)
    }
  }

  const sellPercentages = [25, 50, 75, 100]

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card className="bg-black/40 backdrop-blur-sm border-blue-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Wallet Manager ({wallets.length}/60)
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={onRefreshBalances}
                disabled={wallets.length === 0}
                size="sm"
                variant="outline"
                className="border-blue-600 text-blue-400 hover:bg-blue-900/20 bg-transparent"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
              <Button
                onClick={onClearWallets}
                disabled={wallets.length === 0}
                size="sm"
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20 bg-transparent"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Import Progress */}
          {importProgress.status === "importing" && (
            <div className="mb-4 bg-blue-900/20 border border-blue-600 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm text-white mb-2">
                <span>⚡ IMPORTING {importProgress.total} WALLETS SIMULTANEOUSLY...</span>
                <span className="font-mono text-blue-400">
                  {importProgress.current}/{importProgress.total}
                </span>
              </div>
              <Progress value={(importProgress.current / importProgress.total) * 100} className="bg-gray-700" />
              <div className="text-xs text-blue-300 mt-1 text-center">
                All wallets importing at the same time with Promise.all()
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="bg-green-900/20 border border-green-600/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{connectedWallets.length}</div>
              <div className="text-xs text-green-300">Connected</div>
            </div>
            <div className="bg-blue-900/20 border border-blue-600/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-400">{selectedConnectedWallets.length}</div>
              <div className="text-xs text-blue-300">Selected</div>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-400">{totalBalance.toFixed(4)}</div>
              <div className="text-xs text-yellow-300">Total SOL</div>
            </div>
            <div className="bg-purple-900/20 border border-purple-600/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-purple-400">⚡</div>
              <div className="text-xs text-purple-300">Simultaneous</div>
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                onClick={allSelected ? onDeselectAll : onSelectAll}
                disabled={connectedWallets.length === 0}
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
              >
                {allSelected ? <Square className="w-4 h-4 mr-1" /> : <CheckSquare className="w-4 h-4 mr-1" />}
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <Badge variant="outline" className="text-slate-300">
              {selectedConnectedWallets.length} selected for trading
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Grid */}
      {wallets.length === 0 ? (
        <Card className="bg-black/40 backdrop-blur-sm border-slate-600">
          <CardContent className="py-12">
            <div className="text-center text-slate-400">
              <Wallet className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Wallets Imported</h3>
              <p className="text-sm">Use the "Instant Import" tab to import up to 60 wallets simultaneously</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {wallets.map((wallet) => (
            <Card
              key={wallet.id}
              onClick={() => handleWalletCardClick(wallet.id, wallet)}
              className={`bg-black/40 backdrop-blur-sm border transition-all duration-200 cursor-pointer ${
                selectedWallets.includes(wallet.id)
                  ? "border-green-500/50 bg-green-900/10"
                  : "border-slate-600 hover:border-slate-500"
              } ${wallet.connected ? "hover:bg-slate-800/30" : "cursor-not-allowed opacity-60"}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedWallets.includes(wallet.id)}
                      onCheckedChange={() => onToggleWallet(wallet.id)}
                      disabled={!wallet.connected}
                      onClick={(e) => e.stopPropagation()} // Prevent double-triggering
                    />
                    <Badge
                      variant={wallet.connected ? "default" : "secondary"}
                      className={`text-xs ${wallet.connected ? "bg-green-600" : "bg-gray-600"}`}
                    >
                      {wallet.connected ? "Connected" : "Disconnected"}
                    </Badge>
                  </div>
                  <Button
                    onClick={(e) => handleDeleteClick(e, wallet.id)}
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:bg-red-900/20 h-6 w-6 p-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-white text-sm">{wallet.name}</h3>
                    <p className="text-xs text-slate-400 font-mono break-all">
                      {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-4)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Balance:</span>
                    <span className="text-sm font-medium text-white">
                      {wallet.isLoading ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        `${wallet.balance.toFixed(4)} SOL`
                      )}
                    </span>
                  </div>

                  {/* Sell Percentage Buttons */}
                  {wallet.connected && wallet.balance > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-400 text-center">Quick Sell:</div>
                      <div className="grid grid-cols-4 gap-1">
                        {sellPercentages.map((percentage) => (
                          <Button
                            key={percentage}
                            onClick={(e) => handleSellClick(e, wallet.id, percentage)}
                            size="sm"
                            variant="outline"
                            className={`text-xs h-6 px-1 border transition-all duration-200 ${
                              percentage === 100
                                ? "border-red-500 text-red-400 hover:bg-red-900/20 hover:border-red-400"
                                : percentage >= 75
                                  ? "border-orange-500 text-orange-400 hover:bg-orange-900/20 hover:border-orange-400"
                                  : percentage >= 50
                                    ? "border-yellow-500 text-yellow-400 hover:bg-yellow-900/20 hover:border-yellow-400"
                                    : "border-green-500 text-green-400 hover:bg-green-900/20 hover:border-green-400"
                            } bg-transparent`}
                          >
                            {percentage}%
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
