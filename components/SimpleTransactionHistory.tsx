"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2, ExternalLink, TrendingUp, TrendingDown } from "lucide-react"
import type { SimpleTradeResult } from "@/hooks/useSimpleTrading"

interface SimpleTransactionHistoryProps {
  transactions: SimpleTradeResult[]
  onClear: () => void
}

export function SimpleTransactionHistory({ transactions, onClear }: SimpleTransactionHistoryProps) {
  const successCount = transactions.filter((t) => t.status === "success").length
  const failCount = transactions.filter((t) => t.status === "failed").length

  return (
    <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            📜 Trading History ({transactions.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50">
              ✅ {successCount}
            </Badge>
            <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/50">
              ❌ {failCount}
            </Badge>
            {transactions.length > 0 && (
              <Button onClick={onClear} variant="outline" size="sm" className="bg-red-600/20 text-red-300">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>No transactions yet</p>
            <p className="text-sm">Your trading history will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-gray-700"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {tx.type === "buy" ? (
                        <TrendingUp className="w-4 h-4 text-green-400" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      )}
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
                      <span className="font-semibold">{tx.walletName}</span>
                      {tx.type === "buy" ? (
                        <span className="text-green-400"> • Buy {tx.amount} SOL</span>
                      ) : (
                        <span className="text-red-400"> • Sell {tx.percentage}%</span>
                      )}
                    </div>
                    {tx.error && <div className="text-xs text-red-400 mt-1">❌ {tx.error}</div>}
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
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
