"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trash2, ExternalLink } from "lucide-react"
import type { TradeResult } from "@/hooks/useTrading"

interface TransactionHistoryProps {
  transactions?: TradeResult[]
  onClear?: () => void
}

export function TransactionHistory({ transactions = [], onClear }: TransactionHistoryProps) {
  if (!transactions || transactions.length === 0) {
    return (
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white">📜 Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-400">No transactions yet</p>
            <p className="text-sm text-gray-500 mt-2">Your trading history will appear here</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">📜 Transaction History ({transactions.length})</CardTitle>
          {onClear && (
            <Button onClick={onClear} variant="outline" size="sm" className="bg-red-600/20 text-red-300">
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-gray-700"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant={tx.type === "buy" ? "default" : "secondary"}
                    className={tx.type === "buy" ? "bg-green-600" : "bg-red-600"}
                  >
                    {tx.type.toUpperCase()}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      tx.status === "success"
                        ? "border-green-500 text-green-400"
                        : tx.status === "failed"
                          ? "border-red-500 text-red-400"
                          : "border-yellow-500 text-yellow-400"
                    }
                  >
                    {tx.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-gray-400">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-sm text-white">
                  <span className="font-mono">{tx.walletId}</span> • {tx.amount} SOL
                </div>
                <div className="text-xs text-gray-400 font-mono">
                  {tx.tokenMint.slice(0, 8)}...{tx.tokenMint.slice(-8)}
                </div>
                {tx.error && <div className="text-xs text-red-400 mt-1">Error: {tx.error}</div>}
              </div>
              {tx.signature && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-400 hover:text-blue-300"
                  onClick={() => window.open(`https://solscan.io/tx/${tx.signature}`, "_blank")}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
