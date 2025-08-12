"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Search, TrendingUp, Clock, Coins, FlameIcon as Fire } from "lucide-react"
import { usePumpFunData, type PumpFunToken } from "@/hooks/usePumpFunData"

interface PumpFunTokenDisplayProps {
  onTokenSelect: (mint: string) => void
  selectedToken?: string
}

export function PumpFunTokenDisplay({ onTokenSelect, selectedToken }: PumpFunTokenDisplayProps) {
  const { loading, error, getTokenData, getNewTokens, getTrendingTokens } = usePumpFunData()
  const [searchMint, setSearchMint] = useState("")
  const [searchedToken, setSearchedToken] = useState<PumpFunToken | null>(null)
  const [newTokens, setNewTokens] = useState<PumpFunToken[]>([])
  const [trendingTokens, setTrendingTokens] = useState<PumpFunToken[]>([])

  useEffect(() => {
    // Load trending tokens on mount
    getTrendingTokens().then(setTrendingTokens)
    getNewTokens(20).then(setNewTokens)
  }, [getTrendingTokens, getNewTokens])

  const handleSearch = async () => {
    if (!searchMint.trim()) return

    const token = await getTokenData(searchMint.trim())
    setSearchedToken(token)
  }

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1000000) {
      return `$${(marketCap / 1000000).toFixed(2)}M`
    } else if (marketCap >= 1000) {
      return `$${(marketCap / 1000).toFixed(2)}K`
    }
    return `$${marketCap.toFixed(2)}`
  }

  const TokenCard = ({ token }: { token: PumpFunToken }) => (
    <div
      className={`p-4 rounded-lg border cursor-pointer transition-all ${
        selectedToken === token.mint
          ? "bg-blue-900/30 border-blue-500/50"
          : "bg-white/5 border-gray-600/50 hover:border-gray-500/50"
      }`}
      onClick={() => onTokenSelect(token.mint)}
    >
      <div className="flex items-start gap-3">
        {token.image && (
          <img
            src={token.image || "/placeholder.svg"}
            alt={token.name}
            className="w-12 h-12 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-semibold truncate">{token.name}</h3>
            <Badge variant="outline" className="bg-purple-500/20 text-purple-400 border-purple-500/50 text-xs">
              {token.symbol}
            </Badge>
          </div>

          <p className="text-gray-400 text-sm line-clamp-2 mb-2">{token.description || "No description available"}</p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Market Cap:</span>
              <span className="text-green-400 ml-1 font-mono">{formatMarketCap(token.usdMarketCap)}</span>
            </div>
            <div>
              <span className="text-gray-400">Replies:</span>
              <span className="text-blue-400 ml-1">{token.reply_count}</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-gray-400">{new Date(token.createdTimestamp).toLocaleDateString()}</div>
            <div className="flex gap-1">
              {token.complete && (
                <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50 text-xs">
                  Graduated
                </Badge>
              )}
              {token.nsfw && (
                <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/50 text-xs">
                  NSFW
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Coins className="w-5 h-5" />🚀 PumpFun Token Explorer
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Search Section */}
        <div className="space-y-4 mb-6">
          <div className="flex gap-2">
            <Input
              placeholder="Enter token mint address..."
              value={searchMint}
              onChange={(e) => setSearchMint(e.target.value)}
              className="bg-white/10 border-gray-600 text-white font-mono"
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button
              onClick={handleSearch}
              disabled={loading || !searchMint.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {searchedToken && (
            <div className="space-y-2">
              <h3 className="text-white font-medium">Search Result:</h3>
              <TokenCard token={searchedToken} />
            </div>
          )}
        </div>

        {/* Token Lists */}
        <Tabs defaultValue="trending" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white/10">
            <TabsTrigger value="trending" className="data-[state=active]:bg-white/20">
              <Fire className="w-4 h-4 mr-2" />
              Trending
            </TabsTrigger>
            <TabsTrigger value="new" className="data-[state=active]:bg-white/20">
              <Clock className="w-4 h-4 mr-2" />
              New
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trending" className="mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-medium">🔥 Trending Tokens</h3>
                <Button
                  onClick={() => getTrendingTokens().then(setTrendingTokens)}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="bg-orange-600/20 border-orange-500/50 text-orange-300"
                >
                  <TrendingUp className="w-4 h-4" />
                </Button>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-white/5 h-24 rounded-lg" />
                  ))}
                </div>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-3">
                    {trendingTokens.map((token) => (
                      <TokenCard key={token.mint} token={token} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </TabsContent>

          <TabsContent value="new" className="mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-medium">⚡ New Tokens</h3>
                <Button
                  onClick={() => getNewTokens(20).then(setNewTokens)}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="bg-blue-600/20 border-blue-500/50 text-blue-300"
                >
                  <Clock className="w-4 h-4" />
                </Button>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-white/5 h-24 rounded-lg" />
                  ))}
                </div>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-3">
                    {newTokens.map((token) => (
                      <TokenCard key={token.mint} token={token} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
            <p className="text-red-300 text-sm">Error: {error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
