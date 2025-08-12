"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Coins, ExternalLink, TrendingUp, TrendingDown } from "lucide-react"

interface TokenInfo {
  mint: string
  name?: string
  symbol?: string
  price?: number
  priceChange24h?: number
  marketCap?: number
  volume24h?: number
  holders?: number
}

interface TokenDisplayProps {
  tokenInfo: TokenInfo | null
  loading: boolean
}

export function TokenDisplay({ tokenInfo, loading }: TokenDisplayProps) {
  const openSolscan = () => {
    if (tokenInfo?.mint) {
      window.open(`https://solscan.io/token/${tokenInfo.mint}`, "_blank")
    }
  }

  const openDexScreener = () => {
    if (tokenInfo?.mint) {
      window.open(`https://dexscreener.com/solana/${tokenInfo.mint}`, "_blank")
    }
  }

  if (loading) {
    return (
      <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Coins className="w-5 h-5" />
            Token Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-600 rounded w-3/4"></div>
            <div className="h-4 bg-gray-600 rounded w-1/2"></div>
            <div className="h-4 bg-gray-600 rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!tokenInfo) {
    return (
      <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Coins className="w-5 h-5" />
            Token Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-400">
            <Coins className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No token selected</p>
            <p className="text-sm">Enter a token mint address to view details</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Coins className="w-5 h-5" />
          Token Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token Name & Symbol */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold text-lg">{tokenInfo.name || "Unknown Token"}</h3>
            <p className="text-gray-400 font-mono text-sm">{tokenInfo.symbol || "N/A"}</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={openSolscan}
              variant="outline"
              size="sm"
              className="bg-blue-600/20 border-blue-500/50 text-blue-300"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
            <Button
              onClick={openDexScreener}
              variant="outline"
              size="sm"
              className="bg-green-600/20 border-green-500/50 text-green-300"
            >
              <TrendingUp className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Mint Address */}
        <div className="p-3 bg-white/5 rounded-lg border border-gray-600/50">
          <p className="text-gray-400 text-sm mb-1">Mint Address</p>
          <p className="text-white font-mono text-sm break-all">{tokenInfo.mint}</p>
        </div>

        {/* Price Information */}
        {tokenInfo.price !== undefined && (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-gray-400 text-sm">Price</p>
              <p className="text-white font-bold">${tokenInfo.price.toFixed(8)}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-gray-400 text-sm">24h Change</p>
              <div className="flex items-center gap-1">
                {tokenInfo.priceChange24h !== undefined && (
                  <>
                    {tokenInfo.priceChange24h >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    )}
                    <span className={tokenInfo.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}>
                      {tokenInfo.priceChange24h >= 0 ? "+" : ""}
                      {tokenInfo.priceChange24h.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Market Stats */}
        <div className="grid grid-cols-1 gap-3">
          {tokenInfo.marketCap !== undefined && (
            <div className="flex justify-between items-center p-2 bg-white/5 rounded">
              <span className="text-gray-400 text-sm">Market Cap</span>
              <span className="text-white font-mono">${tokenInfo.marketCap.toLocaleString()}</span>
            </div>
          )}

          {tokenInfo.volume24h !== undefined && (
            <div className="flex justify-between items-center p-2 bg-white/5 rounded">
              <span className="text-gray-400 text-sm">24h Volume</span>
              <span className="text-white font-mono">${tokenInfo.volume24h.toLocaleString()}</span>
            </div>
          )}

          {tokenInfo.holders !== undefined && (
            <div className="flex justify-between items-center p-2 bg-white/5 rounded">
              <span className="text-gray-400 text-sm">Holders</span>
              <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/50">
                {tokenInfo.holders.toLocaleString()}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
