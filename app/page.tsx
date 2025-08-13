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
  transactionHistory: Array<{
    timestamp: number
    type: "sell"
    walletName: string
    tokenAmount: number
    usdValue: number
    signature: string
    price: number
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
    timeWindowSeconds: 30,
    sellPercentageOfNetFlow: 25, // Sell 25% of net USD flow
    minNetFlowUsd: 10, // Minimum $10 net flow to trigger
    cooldownSeconds: 30,
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
    transactionHistory: [],
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto p-4 space-y-6">
        <header className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
              🤖 Market Momentum Auto-Sell
            </h1>
            <p className="text-slate-300 text-base mt-2 font-medium">
              Monitors market buy/sell activity and sells {config.sellPercentageOfNetFlow}% of net positive USD flow
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-slate-600/50 bg-slate-800/60 px-4 py-3 text-sm backdrop-blur-sm shadow-lg">
              <span className="text-slate-300 font-medium">RPC: </span>
              <span
                className={
                  rpcOk
                    ? "text-emerald-400 font-bold"
                    : rpcOk === false
                      ? "text-rose-400 font-bold"
                      : "text-amber-400 font-bold"
                }
              >
                {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
              </span>
            </div>
            <Badge
              variant={status.isRunning ? "default" : "secondary"}
              className={
                status.isRunning
                  ? "bg-emerald-500 text-white animate-pulse shadow-lg text-base px-4 py-2"
                  : "bg-slate-600 text-slate-200 text-base px-4 py-2"
              }
            >
              {status.isRunning ? "🟢 MONITORING" : "🔴 STOPPED"}
            </Badge>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 space-y-6">
            {/* Wallet Management */}
            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <Wallet className="w-6 h-6 text-blue-400" />
                  Wallet Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <textarea
                  className="w-full min-h-[120px] p-4 bg-slate-800/70 border border-slate-500/50 rounded-xl font-mono text-sm text-slate-100 placeholder-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-200 resize-none"
                  placeholder="Enter wallet private keys (one per line)&#10;Supports base58 or JSON array format&#10;Example: 5Kb8kLf9CJfPg..."
                  value={vaultKeys}
                  onChange={(e) => setVaultKeys(e.target.value)}
                />
                <div className="flex flex-wrap gap-3">
                  <Button size="sm" onClick={addVault} className="bg-blue-500 hover:bg-blue-600 text-white font-medium">
                    Add Wallets
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConnected([])}
                    className="border-slate-500 text-slate-300 hover:bg-slate-700"
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleAll(true)}
                    className="border-slate-500 text-slate-300 hover:bg-slate-700"
                  >
                    Select All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshBalances}
                    disabled={balancesLoading}
                    className="border-slate-500 text-slate-300 hover:bg-slate-700 bg-transparent"
                  >
                    <RefreshCw className={`w-4 h-4 ${balancesLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/30 p-4 rounded-xl text-center border border-blue-700/30 shadow-lg">
                    <div className="text-2xl font-bold text-blue-300">{connected.length}</div>
                    <div className="text-slate-200 font-medium">Wallets</div>
                  </div>
                  <div className="bg-gradient-to-br from-green-900/40 to-green-800/30 p-4 rounded-xl text-center border border-green-700/30 shadow-lg">
                    <div className="text-2xl font-bold text-green-300">{selectedCount}</div>
                    <div className="text-slate-200 font-medium">Selected</div>
                  </div>
                </div>

                {connected.length > 0 && (
                  <div className="max-h-40 overflow-auto border border-slate-500/50 rounded-xl p-3 bg-slate-800/50 backdrop-blur-sm">
                    {connected.map((w) => (
                      <div
                        key={w.pubkey}
                        className="flex items-center gap-3 py-2 hover:bg-slate-700/50 rounded-lg px-3 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={!!selected[w.pubkey]}
                          onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                          className="rounded border-slate-400 text-blue-500 focus:ring-blue-500 w-4 h-4"
                        />
                        <span className="font-mono text-sm text-slate-200 font-medium">
                          {w.pubkey.slice(0, 6)}...{w.pubkey.slice(-4)}
                        </span>
                        <span className="text-sm text-slate-300 ml-auto font-bold">
                          {balances[w.pubkey]?.toFixed(3) || "0.000"} SOL
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Token Configuration */}
            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <Target className="w-6 h-6 text-purple-400" />
                  Market Momentum Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label className="text-slate-200 font-semibold text-base mb-2 block">Token Mint Address</Label>
                  <Input
                    placeholder="Paste mint address or pump.fun URL here..."
                    value={mintRaw}
                    onChange={(e) => setMintRaw(e.target.value)}
                    className="font-mono text-sm bg-slate-800/70 border-slate-500/50 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 text-slate-100 placeholder-slate-400 h-12"
                  />
                  {token.name && (
                    <p className="text-sm text-emerald-400 mt-3 flex items-center gap-2 font-medium">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                      {token.name} ({token.symbol}) via {token.source}
                    </p>
                  )}
                </div>

                <Separator className="bg-slate-600/50" />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-200 font-semibold text-sm mb-2 block">Time Window (sec)</Label>
                    <Input
                      type="number"
                      min="30"
                      max="600"
                      value={config.timeWindowSeconds}
                      onChange={(e) => setConfig((prev) => ({ ...prev, timeWindowSeconds: Number(e.target.value) }))}
                      className="bg-slate-800/70 border-slate-500/50 focus:border-purple-400 text-slate-100 h-10"
                    />
                    <p className="text-xs text-slate-400 mt-1 font-medium">Track buy/sell activity</p>
                  </div>
                  <div>
                    <Label className="text-slate-200 font-semibold text-sm mb-2 block">Sell % of Net Flow</Label>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      value={config.sellPercentageOfNetFlow}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, sellPercentageOfNetFlow: Number(e.target.value) }))
                      }
                      className="bg-slate-800/70 border-slate-500/50 focus:border-purple-400 text-slate-100 h-10"
                    />
                    <p className="text-xs text-slate-400 mt-1 font-medium">% of net USD flow</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-200 font-semibold text-sm mb-2 block">Min Net Flow ($)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={config.minNetFlowUsd}
                      onChange={(e) => setConfig((prev) => ({ ...prev, minNetFlowUsd: Number(e.target.value) }))}
                      className="bg-slate-800/70 border-slate-500/50 focus:border-purple-400 text-slate-100 h-10"
                    />
                    <p className="text-xs text-slate-400 mt-1 font-medium">Minimum trigger amount</p>
                  </div>
                  <div>
                    <Label className="text-slate-200 font-semibold text-sm mb-2 block">Cooldown (sec)</Label>
                    <Input
                      type="number"
                      value={config.cooldownSeconds}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cooldownSeconds: Number(e.target.value) }))}
                      className="bg-slate-800/70 border-slate-500/50 focus:border-purple-400 text-slate-100 h-10"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-slate-200 font-semibold text-sm mb-2 block">Slippage (bps)</Label>
                  <Input
                    type="number"
                    value={config.slippageBps}
                    onChange={(e) => setConfig((prev) => ({ ...prev, slippageBps: Number(e.target.value) }))}
                    className="bg-slate-800/70 border-slate-500/50 focus:border-purple-400 text-slate-100 h-10"
                  />
                  <p className="text-xs text-slate-400 mt-1 font-medium">300 bps = 3%</p>
                </div>
              </CardContent>
            </Card>

            {/* Control Panel */}
            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <Settings className="w-6 h-6 text-amber-400" />
                  Engine Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    onClick={startAutoSell}
                    disabled={loading || status.isRunning || !mint || selectedCount === 0}
                    className="bg-emerald-500 hover:bg-emerald-600 shadow-lg h-12 font-semibold"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                    Start
                  </Button>
                  <Button
                    onClick={stopAutoSell}
                    disabled={loading || !status.isRunning}
                    variant="destructive"
                    className="shadow-lg h-12 font-semibold"
                  >
                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Pause className="w-5 h-5" />}
                    Stop
                  </Button>
                </div>

                {status.config && (
                  <div className="text-sm text-slate-300 space-y-2 bg-slate-800/50 p-4 rounded-xl border border-slate-600/30">
                    <div className="flex justify-between">
                      <span className="font-medium">Window:</span>
                      <span className="text-slate-100 font-bold">{status.config.timeWindowSeconds}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Sell:</span>
                      <span className="text-slate-100 font-bold">
                        {status.config.sellPercentageOfNetFlow}% of net flow
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Min Trigger:</span>
                      <span className="text-slate-100 font-bold">${status.config.minNetFlowUsd}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Cooldown:</span>
                      <span className="text-slate-100 font-bold">{status.config.cooldownSeconds}s</span>
                    </div>
                    <div className="text-amber-400 text-center mt-3 font-bold text-base">
                      Sells tokens for SOL based on market momentum
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monitoring Dashboard */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-500/50 shadow-xl backdrop-blur-sm">
                <CardContent className="p-5 text-center">
                  <TrendingUp className="w-10 h-10 mx-auto mb-3 text-green-300" />
                  <div className="text-3xl font-bold text-green-200">${status.metrics.buyVolumeUsd.toFixed(0)}</div>
                  <div className="text-sm text-green-100 font-semibold">Buy Volume</div>
                  <div className="text-xs text-green-300/80 font-medium">{config.timeWindowSeconds}s window</div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-900/50 to-red-800/30 border-red-500/50 shadow-xl backdrop-blur-sm">
                <CardContent className="p-5 text-center">
                  <TrendingDown className="w-10 h-10 mx-auto mb-3 text-red-300" />
                  <div className="text-3xl font-bold text-red-200">${status.metrics.sellVolumeUsd.toFixed(0)}</div>
                  <div className="text-sm text-red-100 font-semibold">Sell Volume</div>
                  <div className="text-xs text-red-300/80 font-medium">{config.timeWindowSeconds}s window</div>
                </CardContent>
              </Card>

              <Card
                className={`${
                  status.metrics.netUsdFlow >= 0
                    ? "bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-500/50"
                    : "bg-gradient-to-br from-red-900/50 to-red-800/30 border-red-500/50"
                } shadow-xl backdrop-blur-sm`}
              >
                <CardContent className="p-5 text-center">
                  <BarChart3
                    className={`w-10 h-10 mx-auto mb-3 ${status.metrics.netUsdFlow >= 0 ? "text-green-300" : "text-red-300"}`}
                  />
                  <div
                    className={`text-3xl font-bold ${status.metrics.netUsdFlow >= 0 ? "text-green-200" : "text-red-200"}`}
                  >
                    {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(0)}
                  </div>
                  <div
                    className={`text-sm font-semibold ${status.metrics.netUsdFlow >= 0 ? "text-green-100" : "text-red-100"}`}
                  >
                    Net Flow
                  </div>
                  <div className="text-xs font-medium">
                    {status.metrics.netUsdFlow > 0 ? (
                      <span className="text-emerald-300">🟢 Positive flow</span>
                    ) : (
                      <span className="text-slate-300">🔴 No positive flow</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border-blue-500/50 shadow-xl backdrop-blur-sm">
                <CardContent className="p-5 text-center">
                  <DollarSign className="w-10 h-10 mx-auto mb-3 text-blue-300" />
                  <div className="text-3xl font-bold text-blue-200">${status.metrics.currentPriceUsd.toFixed(6)}</div>
                  <div className="text-sm text-blue-100 font-semibold">Current Price</div>
                  <div className="text-xs text-blue-300/80 font-medium">
                    {status.metrics.currentPrice.toFixed(8)} SOL
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <Activity className="w-6 h-6 text-green-400" />
                  Market Activity Monitor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-600/30">
                      <span className="text-slate-200 font-semibold">Buy Pressure:</span>
                      <span className="text-green-300 font-mono font-bold text-lg">
                        ${status.metrics.buyVolumeUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-600/30">
                      <span className="text-slate-200 font-semibold">Sell Pressure:</span>
                      <span className="text-red-300 font-mono font-bold text-lg">
                        ${status.metrics.sellVolumeUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-600/30">
                      <span className="text-slate-200 font-semibold">Net Flow:</span>
                      <span
                        className={`font-mono font-bold text-lg ${status.metrics.netUsdFlow >= 0 ? "text-green-300" : "text-red-300"}`}
                      >
                        {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-600/30">
                      <span className="text-slate-200 font-semibold">Sell Amount:</span>
                      <span className="text-blue-300 font-mono font-bold text-lg">
                        ${Math.max(0, (status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg border border-slate-600/30">
                      <span className="text-slate-200 font-semibold">Last Sell:</span>
                      <span className="text-slate-100 font-mono font-bold">
                        {status.metrics.lastSellTrigger > 0 ? `${timeSinceLastSell}s ago` : "Never"}
                      </span>
                    </div>
                  </div>
                </div>

                {status.metrics.netUsdFlow > 0 && status.metrics.buyVolumeUsd > 0 && (
                  <div className="mt-6 p-5 bg-gradient-to-r from-green-900/40 to-emerald-900/30 border border-green-500/50 rounded-xl shadow-xl">
                    <div className="flex items-center gap-3 text-green-300">
                      <TrendingUp className="w-6 h-6" />
                      <span className="font-bold text-xl">SELL TRIGGER ACTIVE</span>
                    </div>
                    <p className="text-base text-green-200 mt-3 font-semibold">
                      Net buying pressure detected! Will sell {config.sellPercentageOfNetFlow}% of $
                      {status.metrics.netUsdFlow.toFixed(2)} = $
                      {((status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)} worth of tokens
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <BarChart3 className="w-6 h-6 text-emerald-400" />
                  Transaction History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {status.transactionHistory && status.transactionHistory.length > 0 ? (
                  <div className="space-y-3 max-h-60 overflow-auto">
                    {status.transactionHistory
                      .slice(-10)
                      .reverse()
                      .map((tx, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-gradient-to-r from-slate-800/60 to-slate-700/40 rounded-lg border border-slate-600/40 shadow-lg"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <TrendingDown className="w-4 h-4 text-red-400" />
                              <span className="font-semibold text-red-300">SELL</span>
                              <span className="text-slate-300 text-sm">
                                {new Date(tx.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <span className="text-emerald-300 font-bold">${tx.usdValue.toFixed(2)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Wallet:</span>
                              <span className="text-slate-200 font-mono">{tx.walletName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Amount:</span>
                              <span className="text-slate-200 font-mono">{tx.tokenAmount.toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Price:</span>
                              <span className="text-slate-200 font-mono">${tx.price.toFixed(6)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Signature:</span>
                              <span className="text-blue-300 font-mono text-xs">
                                {tx.signature.slice(0, 8)}...{tx.signature.slice(-4)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium text-slate-300">No transactions yet</p>
                    <p className="text-sm">Sell transactions will appear here</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-xl text-slate-100">
                  <Wallet className="w-6 h-6 text-blue-400" />
                  Wallet Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {status.walletStatus.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium text-slate-300">No wallets configured</p>
                    <p className="text-sm">Start the engine to see wallet status</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-60 overflow-auto">
                    {status.walletStatus.map((wallet, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-gradient-to-r from-slate-800/60 to-slate-700/40 rounded-lg border border-slate-600/40 shadow-lg"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-mono text-base text-slate-100 font-bold">
                            {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-4)}
                          </span>
                          <Badge
                            variant={wallet.cooldownUntil > Date.now() ? "secondary" : "default"}
                            className={
                              wallet.cooldownUntil > Date.now()
                                ? "bg-amber-500 text-white"
                                : "bg-emerald-500 text-white"
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
                            <span className="text-slate-400 font-medium">SOL:</span>
                            <span className="text-slate-100 font-mono font-bold">{wallet.balance.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-medium">Tokens:</span>
                            <span className="text-slate-100 font-mono font-bold">{wallet.tokenBalance.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/80 border-slate-600/50 backdrop-blur-sm shadow-2xl">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl text-slate-100">System Log</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap bg-black/60 border border-slate-500/50 p-4 rounded-xl max-h-40 overflow-auto font-mono text-slate-200 leading-relaxed">
                  {log ||
                    `Market momentum auto-sell ready. System monitors buy/sell activity in ${config.timeWindowSeconds}s windows and sells ${config.sellPercentageOfNetFlow}% of net positive USD flow when buy pressure is detected.`}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
