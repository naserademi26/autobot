"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Wifi, DollarSign, Zap } from "lucide-react"

interface StatusPanelProps {
  walletManager: any
  trading: any
  solPrice: number
}

export function StatusPanel({ walletManager, trading, solPrice }: StatusPanelProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">RPC Connection</span>
            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50">
              <Wifi className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">SOL Price</span>
            <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/50">
              <DollarSign className="w-3 h-3 mr-1" />${solPrice.toFixed(2)}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Trading Status</span>
            <Badge
              variant="outline"
              className={
                trading.isTrading
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                  : "bg-green-500/20 text-green-400 border-green-500/50"
              }
            >
              <Zap className="w-3 h-3 mr-1" />
              {trading.isTrading ? "Active" : "Ready"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white">Wallet Statistics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{walletManager.connectedWallets.length}</div>
              <div className="text-sm text-gray-400">Connected</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{walletManager.selectedWallets.length}</div>
              <div className="text-sm text-gray-400">Selected</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400">{walletManager.totalBalance.toFixed(4)}</div>
              <div className="text-sm text-gray-400">Total SOL</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{walletManager.totalTokenBalance.toFixed(2)}</div>
              <div className="text-sm text-gray-400">Total Tokens</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
