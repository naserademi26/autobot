"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import bs58 from "bs58"
import { Connection, PublicKey } from "@solana/web3.js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Wallet,
  RefreshCw,
  Play,
  Pause,
  Settings,
  TrendingDown,
  Activity,
  DollarSign,
  Clock,
  Target,
  TrendingUp,
  BarChart3,
} from "lucide-react"

type VaultEntry = { pubkey: string; hasSecret: boolean; sk?: string }

interface TokenInfo {
  name?: string
  symbol?: string
  source?: "jup" | "pump" | "unknown"
}

interface AutoSellConfig {
  mint: string
  timeWindowSeconds: number // Time window for tracking buy/sell activity
  sellPercentageOfNetFlow: number // Percentage of net USD flow to sell
  minNetFlowUsd: number // Minimum net flow to trigger sell
  cooldownSeconds: number
  slippageBps: number
}

interface AutoSellStatus {
  isRunning: boolean
  config: AutoSellConfig | null
  metrics: {
    totalBought: number
    totalSold: number
    currentPrice: number
    currentPriceUsd: number
    solPriceUsd: number
    netUsdFlow: number // Net USD flow (buyers - sellers) in time window
    buyVolumeUsd: number // Total buy volume in USD in time window
    sellVolumeUsd: number // Total sell volume in USD in time window
    lastSellTrigger: number // Timestamp of last sell trigger
  }
  walletStatus: Array<{
    name: string
    publicKey: string
    balance: number
    tokenBalance: number
    cooldownUntil: number
    lastTransactionSignature: string
  }>
}

const ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e"

function sanitizeMintInput(input: string): string {
  const s = input.trim()
  if (!s) return ""
  try {
    if (s.startsWith("http")) {
      const url = new URL(s)
      const mintParam = url.searchParams.get("mint")
      if (mintParam) return sanitizeMintInput(mintParam)
      const parts = url.pathname.split("/").filter(Boolean)
      const coinsIdx = parts.findIndex((p) => p.toLowerCase() === "coins")
      if (coinsIdx >= 0 && parts[coinsIdx + 1]) return sanitizeMintInput(parts[coinsIdx + 1])
    }
  } catch {}
  return s.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "")
}

export default function AutoSellDashboard() {
  const connection = useMemo(() => new Connection(ENDPOINT, { commitment: "confirmed" }), [])
  const [rpcOk, setRpcOk] = useState<boolean | null>(null)

  // Wallet management
  const [vaultKeys, setVaultKeys] = useState<string>("")
  const [connected, setConnected] = useState<VaultEntry[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [balancesLoading, setBalancesLoading] = useState(false)

  // Token configuration
  const [mintRaw, setMintRaw] = useState<string>("")
  const mint = useMemo(() => sanitizeMintInput(mintRaw), [mintRaw])
  const [token, setToken] = useState<TokenInfo>({})

  const [config, setConfig] = useState<AutoSellConfig>({
    mint: "",
    timeWindowSeconds: 30, // Reduced to 30 seconds for faster reaction
    sellPercentageOfNetFlow: 25, // Sell 25% of net USD flow
    minNetFlowUsd: 0, // Set to 0 to trigger on any positive net flow
    cooldownSeconds: 15, // Reduced cooldown for faster execution
    slippageBps: 300,
  })

  // Auto-sell status
  const [status, setStatus] = useState<AutoSellStatus>({
    isRunning: false,
    config: null,
    metrics: {
      totalBought: 0,
      totalSold: 0,
      currentPrice: 0,
      currentPriceUsd: 0,
      solPriceUsd: 100,
      netUsdFlow: 0,
      buyVolumeUsd: 0,
      sellVolumeUsd: 0,
      lastSellTrigger: 0,
    },
    walletStatus: [],
  })

  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<string>("")
  const refreshId = useRef(0)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        await connection.getLatestBlockhash("confirmed")
        if (mounted) setRpcOk(true)
      } catch {
        if (mounted) setRpcOk(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [connection])

  useEffect(() => {
    setConfig((prev) => ({ ...prev, mint }))
  }, [mint])

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auto-sell/status")
        if (res.ok) {
          const data = await res.json()
          setStatus(data)
        }
      } catch (error) {
        console.error("Failed to fetch status:", error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  async function addVault() {
    const lines = vaultKeys
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    const items: VaultEntry[] = []
    for (const line of lines) {
      try {
        const { Keypair } = await import("@solana/web3.js")
        let kp
        if (line.startsWith("[")) {
          const arr = Uint8Array.from(JSON.parse(line))
          kp = Keypair.fromSecretKey(arr)
        } else {
          const secret = bs58.decode(line)
          kp = Keypair.fromSecretKey(secret)
        }
        items.push({ pubkey: kp.publicKey.toBase58(), hasSecret: true, sk: line })
      } catch {
        // ignore invalid entries
      }
    }

    const map = new Map<string, VaultEntry>()
    for (const w of [...connected, ...items]) map.set(w.pubkey, w)
    const next = Array.from(map.values()).slice(0, 120)
    setConnected(next)

    const sel: Record<string, boolean> = { ...selected }
    next.forEach((w) => (sel[w.pubkey] = true))
    setSelected(sel)
    setVaultKeys("")
  }

  async function resolveTokenMeta(mintAddr: string) {
    try {
      setToken({})
      if (!mintAddr) return
      const j = await fetch("https://token.jup.ag/all").then((r) => r.json())
      const found = (j as any[]).find((t: any) => t.address === mintAddr)
      if (found) return setToken({ name: found.name, symbol: found.symbol, source: "jup" })

      const p = await fetch(`https://frontend-api.pump.fun/coins/${mintAddr}`).then((r) => (r.ok ? r.json() : null))
      if (p && p.symbol) return setToken({ name: p.name, symbol: p.symbol, source: "pump" })

      setToken({ name: undefined, symbol: undefined, source: "unknown" })
    } catch {
      setToken({ source: "unknown" })
    }
  }

  useEffect(() => {
    if (mint) void resolveTokenMeta(mint)
  }, [mint])

  async function refreshBalances() {
    const cur = ++refreshId.current
    const pubkeys = connected.map((w) => w.pubkey)
    if (pubkeys.length === 0) {
      setBalances({})
      return
    }
    setBalancesLoading(true)
    try {
      const next: Record<string, number> = {}
      const chunkSize = 99
      for (let i = 0; i < pubkeys.length; i += chunkSize) {
        const slice = pubkeys.slice(i, i + chunkSize)
        const infos = await connection.getMultipleAccountsInfo(
          slice.map((s) => new PublicKey(s)),
          { commitment: "confirmed" },
        )
        infos.forEach((info, idx) => {
          const key = slice[idx]
          const lamports = info?.lamports ?? 0
          next[key] = lamports / 1e9
        })
        if (cur !== refreshId.current) return
      }
      if (cur === refreshId.current) setBalances(next)
    } finally {
      if (cur === refreshId.current) setBalancesLoading(false)
    }
  }

  useEffect(() => {
    void refreshBalances()
  }, [connected, connection])

  function toggleAll(v: boolean) {
    const s: Record<string, boolean> = {}
    connected.forEach((w) => (s[w.pubkey] = v))
    setSelected(s)
  }

  async function startAutoSell() {
    setLoading(true)
    setLog(`🚀 Starting market momentum auto-sell engine...`)

    try {
      const keys = connected.filter((w) => selected[w.pubkey] && w.hasSecret).map((w) => w.sk!)

      const res = await fetch("/api/auto-sell/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          privateKeys: keys,
        }),
      })

      const result = await res.json()
      setLog(JSON.stringify(result, null, 2))

      if (res.ok) {
        setLog(`✅ Market momentum auto-sell engine started successfully!`)
      }
    } catch (e: any) {
      setLog(`❌ Error: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function stopAutoSell() {
    setLoading(true)
    setLog(`⏹️ Stopping auto-sell engine...`)

    try {
      const res = await fetch("/api/auto-sell/stop", {
        method: "POST",
      })

      const result = await res.json()
      setLog(JSON.stringify(result, null, 2))

      if (res.ok) {
        setLog(`✅ Auto-sell engine stopped successfully!`)
      }
    } catch (e: any) {
      setLog(`❌ Error: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected])
  const totalSelectedSol = useMemo(
    () =>
      connected.reduce((acc, w) => {
        if (!selected[w.pubkey]) return acc
        return acc + (balances[w.pubkey] ?? 0)
      }, 0),
    [connected, selected, balances],
  )

  const timeSinceLastSell =
    status.metrics.lastSellTrigger > 0 ? Math.floor((Date.now() - status.metrics.lastSellTrigger) / 1000) : 0

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 min-h-screen">
      <header className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between p-6 rounded-2xl bg-gradient-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-sm border border-slate-700/50">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            🤖 Market Momentum Auto-Sell
          </h1>
          <p className="text-slate-300 text-sm mt-2 font-medium">
            Monitors market buy/sell activity and sells 25% of net positive USD flow
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 backdrop-blur-sm px-4 py-2.5 text-sm font-medium">
            <span className="text-slate-400">RPC: </span>
            <span className={rpcOk ? "text-emerald-400" : rpcOk === false ? "text-rose-400" : "text-amber-400"}>
              {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
            </span>
          </div>
          <Badge
            variant={status.isRunning ? "default" : "secondary"}
            className={`px-4 py-2 text-sm font-semibold ${
              status.isRunning
                ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/50 animate-pulse"
                : "bg-slate-600/20 text-slate-400 border-slate-500/50"
            }`}
          >
            {status.isRunning ? "🟢 MONITORING" : "🔴 STOPPED"}
          </Badge>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1 space-y-6">
          {/* Wallet Management */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Wallet className="w-5 h-5 text-blue-400" />
                </div>
                Wallet Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                className="w-full min-h-[120px] font-mono text-xs bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                placeholder="Enter wallet private keys (one per line)&#10;Supports base58 or JSON array format&#10;Example: 5Kb8kLf9CJfPg..."
                value={vaultKeys}
                onChange={(e) => setVaultKeys(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={addVault} className="bg-blue-600 hover:bg-blue-700 text-white font-medium">
                  Add Wallets
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConnected([])}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAll(true)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshBalances}
                  disabled={balancesLoading}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800 bg-transparent"
                >
                  <RefreshCw className={`w-4 h-4 ${balancesLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border border-blue-500/20 p-4 rounded-xl text-center">
                  <div className="text-2xl font-bold text-blue-400">{connected.length}</div>
                  <div className="text-slate-400 text-sm font-medium">Wallets</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border border-emerald-500/20 p-4 rounded-xl text-center">
                  <div className="text-2xl font-bold text-emerald-400">{selectedCount}</div>
                  <div className="text-slate-400 text-sm font-medium">Selected</div>
                </div>
              </div>

              {connected.length > 0 && (
                <div className="max-h-48 overflow-auto border border-slate-700/50 rounded-xl p-3 bg-slate-800/30 space-y-2">
                  {connected.map((w) => (
                    <div
                      key={w.pubkey}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[w.pubkey]}
                        onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                        className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500/50"
                      />
                      <span className="font-mono text-xs text-slate-300 flex-1">
                        {w.pubkey.slice(0, 6)}...{w.pubkey.slice(-4)}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">
                        {balances[w.pubkey]?.toFixed(3) || "0.000"} SOL
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Token Configuration */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Target className="w-5 h-5 text-purple-400" />
                </div>
                Market Momentum Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-300 font-medium">Token Mint Address</Label>
                <Input
                  placeholder="Paste mint address or pump.fun URL"
                  value={mintRaw}
                  onChange={(e) => setMintRaw(e.target.value)}
                  className="font-mono text-sm bg-slate-800/60 border-slate-700/50 text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 mt-2"
                />
                {token.name && (
                  <p className="text-sm text-emerald-400 mt-2 font-medium">
                    ✅ {token.name} ({token.symbol}) via {token.source}
                  </p>
                )}
              </div>

              <Separator className="bg-slate-700/50" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 font-medium">Time Window (sec)</Label>
                  <Input
                    type="number"
                    min="15"
                    max="300"
                    value={config.timeWindowSeconds}
                    onChange={(e) => setConfig((prev) => ({ ...prev, timeWindowSeconds: Number(e.target.value) }))}
                    className="bg-slate-800/60 border-slate-700/50 text-slate-200 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 mt-2"
                  />
                  <p className="text-xs text-slate-500 mt-1">Track buy/sell activity</p>
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">Sell % of Net Flow</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={config.sellPercentageOfNetFlow}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sellPercentageOfNetFlow: Number(e.target.value) }))
                    }
                    className="bg-slate-800/60 border-slate-700/50 text-slate-200 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 mt-2"
                  />
                  <p className="text-xs text-slate-500 mt-1">% of net USD flow</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 font-medium">Cooldown (sec)</Label>
                  <Input
                    type="number"
                    value={config.cooldownSeconds}
                    onChange={(e) => setConfig((prev) => ({ ...prev, cooldownSeconds: Number(e.target.value) }))}
                    className="bg-slate-800/60 border-slate-700/50 text-slate-200 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 mt-2"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 font-medium">Slippage (bps)</Label>
                  <Input
                    type="number"
                    value={config.slippageBps}
                    onChange={(e) => setConfig((prev) => ({ ...prev, slippageBps: Number(e.target.value) }))}
                    className="bg-slate-800/60 border-slate-700/50 text-slate-200 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 mt-2"
                  />
                  <p className="text-xs text-slate-500 mt-1">300 bps = 3%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Control Panel */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <Settings className="w-5 h-5 text-amber-400" />
                </div>
                Engine Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={startAutoSell}
                  disabled={loading || status.isRunning || !mint || selectedCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 shadow-lg hover:shadow-emerald-500/25 transition-all"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start
                </Button>
                <Button
                  onClick={stopAutoSell}
                  disabled={loading || !status.isRunning}
                  variant="destructive"
                  className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 shadow-lg hover:shadow-rose-500/25 transition-all"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                  Stop
                </Button>
              </div>

              {status.config && (
                <div className="text-xs text-slate-400 space-y-2 p-3 bg-slate-800/30 rounded-lg border border-slate-700/30">
                  <div className="flex justify-between">
                    <span>Window:</span>
                    <span className="text-slate-300">{status.config.timeWindowSeconds}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sell:</span>
                    <span className="text-slate-300">{status.config.sellPercentageOfNetFlow}% of net flow</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cooldown:</span>
                    <span className="text-slate-300">{status.config.cooldownSeconds}s</span>
                  </div>
                  <div className="text-amber-400 text-center font-medium mt-2 pt-2 border-t border-slate-700/50">
                    Triggers on positive net flow only
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monitoring Dashboard */}
        <div className="lg:col-span-2 space-y-6">
          {/* Market Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/30 shadow-lg hover:shadow-emerald-500/20 transition-all">
              <CardContent className="p-6 text-center">
                <TrendingUp className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
                <div className="text-3xl font-bold text-emerald-400">${status.metrics.buyVolumeUsd.toFixed(0)}</div>
                <div className="text-sm text-emerald-300 font-medium">Buy Volume</div>
                <div className="text-xs text-slate-400 mt-1">{config.timeWindowSeconds}s window</div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-rose-500/10 to-rose-600/10 border-rose-500/30 shadow-lg hover:shadow-rose-500/20 transition-all">
              <CardContent className="p-6 text-center">
                <TrendingDown className="w-8 h-8 mx-auto mb-3 text-rose-400" />
                <div className="text-3xl font-bold text-rose-400">${status.metrics.sellVolumeUsd.toFixed(0)}</div>
                <div className="text-sm text-rose-300 font-medium">Sell Volume</div>
                <div className="text-xs text-slate-400 mt-1">{config.timeWindowSeconds}s window</div>
              </CardContent>
            </Card>

            <Card
              className={`${
                status.metrics.netUsdFlow >= 0
                  ? "bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/30 shadow-lg hover:shadow-emerald-500/20"
                  : "bg-gradient-to-br from-rose-500/10 to-rose-600/10 border-rose-500/30 shadow-lg hover:shadow-rose-500/20"
              } transition-all`}
            >
              <CardContent className="p-6 text-center">
                <BarChart3
                  className={`w-8 h-8 mx-auto mb-3 ${status.metrics.netUsdFlow >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                />
                <div
                  className={`text-3xl font-bold ${status.metrics.netUsdFlow >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(0)}
                </div>
                <div
                  className={`text-sm font-medium ${status.metrics.netUsdFlow >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                >
                  Net Flow
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {status.metrics.netUsdFlow > 0 ? "🟢 Positive flow" : "🔴 No positive flow"}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/30 shadow-lg hover:shadow-blue-500/20 transition-all">
              <CardContent className="p-6 text-center">
                <DollarSign className="w-8 h-8 mx-auto mb-3 text-blue-400" />
                <div className="text-3xl font-bold text-blue-400">${status.metrics.currentPriceUsd.toFixed(6)}</div>
                <div className="text-sm text-blue-300 font-medium">Current Price</div>
                <div className="text-xs text-slate-400 mt-1">{status.metrics.currentPrice.toFixed(8)} SOL</div>
              </CardContent>
            </Card>
          </div>

          {/* Market Activity Monitor */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <Activity className="w-5 h-5 text-green-400" />
                </div>
                Market Activity Monitor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-800/30 rounded-lg">
                    <span className="text-slate-400 font-medium">Buy Pressure:</span>
                    <span className="text-emerald-400 font-mono font-bold text-lg">
                      ${status.metrics.buyVolumeUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-800/30 rounded-lg">
                    <span className="text-slate-400 font-medium">Sell Pressure:</span>
                    <span className="text-rose-400 font-mono font-bold text-lg">
                      ${status.metrics.sellVolumeUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-800/30 rounded-lg">
                    <span className="text-slate-400 font-medium">Net Flow:</span>
                    <span
                      className={`font-mono font-bold text-lg ${status.metrics.netUsdFlow >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-800/30 rounded-lg">
                    <span className="text-slate-400 font-medium">Sell Amount:</span>
                    <span className="text-blue-400 font-mono font-bold text-lg">
                      ${Math.max(0, (status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-800/30 rounded-lg">
                    <span className="text-slate-400 font-medium">Last Sell:</span>
                    <span className="text-slate-300 font-mono font-bold text-lg">
                      {status.metrics.lastSellTrigger > 0 ? `${timeSinceLastSell}s ago` : "Never"}
                    </span>
                  </div>
                </div>
              </div>

              {status.metrics.netUsdFlow > 0 && status.metrics.buyVolumeUsd > 0 && (
                <div className="mt-6 p-4 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/30 rounded-xl shadow-lg">
                  <div className="flex items-center gap-3 text-emerald-400 mb-2">
                    <TrendingUp className="w-5 h-5" />
                    <span className="font-bold text-lg">SELL TRIGGER ACTIVE</span>
                  </div>
                  <p className="text-sm text-emerald-300 font-medium">
                    Net buying pressure detected! Will sell {config.sellPercentageOfNetFlow}% of $
                    {status.metrics.netUsdFlow.toFixed(2)} = $
                    {((status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)} worth of tokens
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Transaction History */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-indigo-500/20">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                </div>
                Transaction History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-slate-400">
                <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No transactions yet</p>
                <p className="text-sm">Sell transactions will appear here</p>
              </div>
            </CardContent>
          </Card>

          {/* Wallet Status */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-cyan-500/20">
                  <Wallet className="w-5 h-5 text-cyan-400" />
                </div>
                Wallet Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status.walletStatus.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Wallet className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No wallets configured</p>
                  <p className="text-sm">Start the engine to see wallet status</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-auto">
                  {status.walletStatus.map((wallet, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-slate-800/40 rounded-xl border border-slate-700/30 hover:bg-slate-800/60 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-mono text-sm text-slate-300 font-medium">
                          {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-4)}
                        </span>
                        <Badge
                          variant={wallet.cooldownUntil > Date.now() ? "secondary" : "default"}
                          className={
                            wallet.cooldownUntil > Date.now()
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          }
                        >
                          {wallet.cooldownUntil > Date.now() ? (
                            <>
                              <Clock className="w-3 h-3 mr-1" />
                              Cooldown
                            </>
                          ) : (
                            "Ready"
                          )}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">SOL:</span>
                          <span className="text-white font-mono font-medium">{wallet.balance.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Tokens:</span>
                          <span className="text-white font-mono font-medium">{wallet.tokenBalance.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* System Log */}
          <Card className="bg-slate-900/60 backdrop-blur-sm border-slate-700/50 shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-slate-100">
                <div className="p-2 rounded-lg bg-slate-500/20">
                  <Activity className="w-5 h-5 text-slate-400" />
                </div>
                System Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap bg-slate-950/60 border border-slate-800/50 p-4 rounded-xl max-h-48 overflow-auto font-mono text-slate-300 leading-relaxed">
                {log ||
                  `Market momentum auto-sell ready. System monitors buy/sell activity in ${config.timeWindowSeconds}s windows and sells ${config.sellPercentageOfNetFlow}% of net positive USD flow when net flow > $0.`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
