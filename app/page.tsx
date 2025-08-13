"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
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
  AlertTriangle,
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
  const connection = useMemo(() => {
    try {
      return new Connection(ENDPOINT, { commitment: "confirmed" })
    } catch (error) {
      console.error("Failed to create connection:", error)
      return null
    }
  }, [])

  const [rpcOk, setRpcOk] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    timeWindowSeconds: 120, // 2 minutes time window
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
  })

  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<string>("")
  const refreshId = useRef(0)

  useEffect(() => {
    let mounted = true
    if (!connection) {
      if (mounted) setRpcOk(false)
      return
    }

    const checkConnection = async () => {
      try {
        await connection.getLatestBlockhash("confirmed")
        if (mounted) {
          setRpcOk(true)
          setError(null)
        }
      } catch (err) {
        console.error("RPC connection failed:", err)
        if (mounted) {
          setRpcOk(false)
          setError("RPC connection failed")
        }
      }
    }

    checkConnection()
    return () => {
      mounted = false
    }
  }, [connection])

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auto-sell/status")
        if (res.ok) {
          const data = await res.json()
          setStatus({
            ...data,
            walletStatus: Array.isArray(data.walletStatus) ? data.walletStatus : [],
            metrics: {
              ...data.metrics,
              totalBought: data.metrics?.totalBought || 0,
              totalSold: data.metrics?.totalSold || 0,
              currentPrice: data.metrics?.currentPrice || 0,
              currentPriceUsd: data.metrics?.currentPriceUsd || 0,
              solPriceUsd: data.metrics?.solPriceUsd || 100,
              netUsdFlow: data.metrics?.netUsdFlow || 0,
              buyVolumeUsd: data.metrics?.buyVolumeUsd || 0,
              sellVolumeUsd: data.metrics?.sellVolumeUsd || 0,
              lastSellTrigger: data.metrics?.lastSellTrigger || 0,
            },
          })
          setError(null)
        } else {
          console.error("Status fetch failed:", res.status, res.statusText)
        }
      } catch (error) {
        console.error("Failed to fetch status:", error)
        setError("Failed to fetch status")
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  const addVault = useCallback(async () => {
    try {
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
        } catch (err) {
          console.warn("Invalid wallet key:", err)
        }
      }

      const map = new Map<string, VaultEntry>()
      const existingConnected = Array.isArray(connected) ? connected : []
      for (const w of [...existingConnected, ...items]) map.set(w.pubkey, w)
      const next = Array.from(map.values()).slice(0, 120)
      setConnected(next)

      const sel: Record<string, boolean> = { ...selected }
      next.forEach((w) => (sel[w.pubkey] = true))
      setSelected(sel)
      setVaultKeys("")
      setError(null)
    } catch (err) {
      console.error("Failed to add wallets:", err)
      setError("Failed to add wallets")
    }
  }, [vaultKeys, connected, selected])

  const resolveTokenMeta = useCallback(async (mintAddr: string) => {
    try {
      setToken({})
      if (!mintAddr) return

      // Try Jupiter first
      try {
        const j = await fetch("https://token.jup.ag/all", {
          signal: AbortSignal.timeout(5000),
        }).then((r) => r.json())
        const found = (j as any[]).find((t: any) => t.address === mintAddr)
        if (found) {
          setToken({ name: found.name, symbol: found.symbol, source: "jup" })
          return
        }
      } catch (err) {
        console.warn("Jupiter API failed:", err)
      }

      // Try Pump.fun as fallback
      try {
        const p = await fetch(`https://frontend-api.pump.fun/coins/${mintAddr}`, {
          signal: AbortSignal.timeout(5000),
        }).then((r) => (r.ok ? r.json() : null))
        if (p && p.symbol) {
          setToken({ name: p.name, symbol: p.symbol, source: "pump" })
          return
        }
      } catch (err) {
        console.warn("Pump.fun API failed:", err)
      }

      setToken({ name: undefined, symbol: undefined, source: "unknown" })
    } catch (err) {
      console.error("Failed to resolve token metadata:", err)
      setToken({ source: "unknown" })
    }
  }, [])

  useEffect(() => {
    if (mint) {
      resolveTokenMeta(mint).catch(console.error)
    }
  }, [mint, resolveTokenMeta])

  const refreshBalances = useCallback(async () => {
    if (!connection) {
      setError("No RPC connection")
      return
    }

    const cur = ++refreshId.current
    const connectedWallets = Array.isArray(connected) ? connected : []
    const pubkeys = connectedWallets.map((w) => w.pubkey)
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
        try {
          const infos = await connection.getMultipleAccountsInfo(
            slice.map((s) => new PublicKey(s)),
            { commitment: "confirmed" },
          )
          infos.forEach((info, idx) => {
            const key = slice[idx]
            const lamports = info?.lamports ?? 0
            next[key] = lamports / 1e9
          })
        } catch (err) {
          console.error("Failed to fetch balances for chunk:", err)
          // Continue with other chunks
        }
        if (cur !== refreshId.current) return
      }
      if (cur === refreshId.current) {
        setBalances(next)
        setError(null)
      }
    } catch (err) {
      console.error("Failed to refresh balances:", err)
      setError("Failed to refresh balances")
    } finally {
      if (cur === refreshId.current) setBalancesLoading(false)
    }
  }, [connection, connected])

  useEffect(() => {
    refreshBalances().catch(console.error)
  }, [refreshBalances])

  const startAutoSell = useCallback(async () => {
    setLoading(true)
    setLog(`🚀 Starting market momentum auto-sell engine...`)

    try {
      const connectedWallets = Array.isArray(connected) ? connected : []
      const selectedWallets = selected || {}
      const keys = connectedWallets.filter((w) => selectedWallets[w.pubkey] && w.hasSecret).map((w) => w.sk!)

      if (keys.length === 0) {
        throw new Error("No wallets selected with private keys")
      }

      if (!mint) {
        throw new Error("No token mint address provided")
      }

      const res = await fetch("/api/auto-sell/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          privateKeys: keys,
        }),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      })

      const result = await res.json()

      if (res.ok) {
        setLog(`✅ Market momentum auto-sell engine started successfully!`)
        setError(null)
      } else {
        throw new Error(result.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      const errorMsg = e?.message || String(e)
      setLog(`❌ Error: ${errorMsg}`)
      setError(errorMsg)
      console.error("Start auto-sell failed:", e)
    } finally {
      setLoading(false)
    }
  }, [connected, selected, config, mint])

  const stopAutoSell = useCallback(async () => {
    setLoading(true)
    setLog(`⏹️ Stopping auto-sell engine...`)

    try {
      const res = await fetch("/api/auto-sell/stop", {
        method: "POST",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })

      const result = await res.json()

      if (res.ok) {
        setLog(`✅ Auto-sell engine stopped successfully!`)
        setError(null)
      } else {
        throw new Error(result.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      const errorMsg = e?.message || String(e)
      setLog(`❌ Error: ${errorMsg}`)
      setError(errorMsg)
      console.error("Stop auto-sell failed:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setConfig((prev) => ({ ...prev, mint }))
  }, [mint])

  function toggleAll(v: boolean) {
    const s: Record<string, boolean> = {}
    const connectedWallets = Array.isArray(connected) ? connected : []
    connectedWallets.forEach((w) => (s[w.pubkey] = v))
    setSelected(s)
  }

  const selectedCount = useMemo(() => {
    const selectedObj = selected || {}
    return Object.values(selectedObj).filter(Boolean).length
  }, [selected])

  const totalSelectedSol = useMemo(() => {
    const connectedWallets = Array.isArray(connected) ? connected : []
    const selectedObj = selected || {}
    const balancesObj = balances || {}
    return connectedWallets.reduce((acc, w) => {
      if (!selectedObj[w.pubkey]) return acc
      return acc + (balancesObj[w.pubkey] ?? 0)
    }, 0)
  }, [connected, selected, balances])

  const timeSinceLastSell =
    status?.metrics?.lastSellTrigger && status.metrics.lastSellTrigger > 0
      ? Math.floor((Date.now() - status.metrics.lastSellTrigger) / 1000)
      : 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto p-8 space-y-8">
        <header className="flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white">🤖 Market Momentum Auto-Sell</h1>
            <p className="text-slate-300 text-base leading-relaxed">
              Monitors market buy/sell activity and sells {config.sellPercentageOfNetFlow}% of net positive USD flow
            </p>
            {error && (
              <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-900/20 px-3 py-2 rounded-lg border border-rose-600/50">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800/80 backdrop-blur-sm px-4 py-3 text-sm shadow-lg">
              <span className="text-slate-300 font-medium">RPC: </span>
              <span
                className={
                  rpcOk
                    ? "text-emerald-400 font-semibold"
                    : rpcOk === false
                      ? "text-rose-400 font-semibold"
                      : "text-slate-400"
                }
              >
                {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
              </span>
            </div>
            <Badge
              variant={status.isRunning ? "default" : "secondary"}
              className={`px-4 py-2 text-sm font-semibold ${
                status.isRunning
                  ? "bg-emerald-600 text-white animate-pulse shadow-lg shadow-emerald-600/25"
                  : "bg-slate-600 text-slate-200"
              }`}
            >
              {status.isRunning ? "🟢 MONITORING" : "🔴 STOPPED"}
            </Badge>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 space-y-8">
            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-white text-lg">
                  <Wallet className="w-6 h-6 text-blue-400" />
                  Wallet Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <textarea
                  className="w-full min-h-[120px] p-4 bg-slate-900/80 border border-slate-600 rounded-lg font-mono text-sm text-slate-200 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  placeholder="One base58 or JSON secret array per line"
                  value={vaultKeys}
                  onChange={(e) => setVaultKeys(e.target.value)}
                />
                <div className="flex flex-wrap gap-3">
                  <Button size="sm" onClick={addVault} className="bg-blue-600 hover:bg-blue-700 text-white font-medium">
                    Add Wallets
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConnected([])}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleAll(true)}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Select All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshBalances}
                    disabled={balancesLoading}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
                  >
                    <RefreshCw className={`w-4 h-4 ${balancesLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-700/50 p-4 rounded-xl text-center border border-slate-600">
                    <div className="text-2xl font-bold text-blue-400">{connected.length}</div>
                    <div className="text-slate-300 font-medium">Wallets</div>
                  </div>
                  <div className="bg-slate-700/50 p-4 rounded-xl text-center border border-slate-600">
                    <div className="text-2xl font-bold text-emerald-400">{selectedCount}</div>
                    <div className="text-slate-300 font-medium">Selected</div>
                  </div>
                </div>

                {Array.isArray(connected) && connected.length > 0 && (
                  <div className="max-h-48 overflow-auto border border-slate-600 rounded-xl p-3 bg-slate-900/50">
                    <div className="space-y-2">
                      {connected.map((w) => (
                        <div
                          key={w.pubkey}
                          className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={!!(selected && selected[w.pubkey])}
                            onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-500 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-mono text-sm text-slate-200 flex-1">
                            {w.pubkey.slice(0, 8)}...{w.pubkey.slice(-6)}
                          </span>
                          <span className="text-sm text-slate-300 font-medium">
                            {balances && balances[w.pubkey] ? balances[w.pubkey].toFixed(3) : "0.000"} SOL
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-white text-lg">
                  <Target className="w-6 h-6 text-orange-400" />
                  Market Momentum Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-slate-300 font-medium">Token Mint Address</Label>
                  <Input
                    placeholder="Paste mint address or pump.fun URL"
                    value={mintRaw}
                    onChange={(e) => setMintRaw(e.target.value)}
                    className="font-mono text-sm bg-slate-900/80 border-slate-600 text-slate-200 placeholder-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                  />
                  {token.name && (
                    <p className="text-sm text-emerald-400 font-medium mt-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                      {token.name} ({token.symbol}) via {token.source}
                    </p>
                  )}
                </div>

                <Separator className="bg-slate-600" />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-medium">Time Window (sec)</Label>
                    <Input
                      type="number"
                      min="60"
                      max="600"
                      value={config.timeWindowSeconds}
                      onChange={(e) => setConfig((prev) => ({ ...prev, timeWindowSeconds: Number(e.target.value) }))}
                      className="bg-slate-900/80 border-slate-600 text-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    />
                    <p className="text-xs text-slate-400">Track buy/sell activity</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-medium">Sell % of Net Flow</Label>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      value={config.sellPercentageOfNetFlow}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, sellPercentageOfNetFlow: Number(e.target.value) }))
                      }
                      className="bg-slate-900/80 border-slate-600 text-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    />
                    <p className="text-xs text-slate-400">% of net USD flow</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-medium">Min Net Flow ($)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={config.minNetFlowUsd}
                      onChange={(e) => setConfig((prev) => ({ ...prev, minNetFlowUsd: Number(e.target.value) }))}
                      className="bg-slate-900/80 border-slate-600 text-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    />
                    <p className="text-xs text-slate-400">Minimum trigger amount</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-medium">Cooldown (sec)</Label>
                    <Input
                      type="number"
                      value={config.cooldownSeconds}
                      onChange={(e) => setConfig((prev) => ({ ...prev, cooldownSeconds: Number(e.target.value) }))}
                      className="bg-slate-900/80 border-slate-600 text-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300 font-medium">Slippage (bps)</Label>
                  <Input
                    type="number"
                    value={config.slippageBps}
                    onChange={(e) => setConfig((prev) => ({ ...prev, slippageBps: Number(e.target.value) }))}
                    className="bg-slate-900/80 border-slate-600 text-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                  />
                  <p className="text-xs text-slate-400">300 bps = 3%</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-white text-lg">
                  <Settings className="w-6 h-6 text-purple-400" />
                  Engine Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    onClick={startAutoSell}
                    disabled={loading || status.isRunning || !mint || selectedCount === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    Start
                  </Button>
                  <Button
                    onClick={stopAutoSell}
                    disabled={loading || !status.isRunning}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 shadow-lg shadow-rose-600/25 disabled:opacity-50"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                    Stop
                  </Button>
                </div>

                {status.config && (
                  <div className="bg-slate-700/50 p-4 rounded-xl border border-slate-600 space-y-2">
                    <div className="text-sm text-slate-200 space-y-1">
                      <div className="flex justify-between">
                        <span>Window:</span>
                        <span className="font-mono text-blue-400">{status.config.timeWindowSeconds}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sell:</span>
                        <span className="font-mono text-orange-400">
                          {status.config.sellPercentageOfNetFlow}% of net flow
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Min Trigger:</span>
                        <span className="font-mono text-yellow-400">${status.config.minNetFlowUsd}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Cooldown:</span>
                        <span className="font-mono text-purple-400">{status.config.cooldownSeconds}s</span>
                      </div>
                    </div>
                    <div className="text-xs text-emerald-400 font-medium pt-2 border-t border-slate-600">
                      💡 Sells tokens for SOL based on market momentum
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Card className="bg-gradient-to-br from-emerald-900/40 to-emerald-800/20 border-emerald-600/50 shadow-xl shadow-emerald-900/20">
                <CardContent className="p-6 text-center">
                  <TrendingUp className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                  <div className="text-3xl font-bold text-emerald-300">${status.metrics.buyVolumeUsd.toFixed(0)}</div>
                  <div className="text-sm text-emerald-200 font-medium">Buy Volume</div>
                  <div className="text-xs text-slate-300 mt-1">{config.timeWindowSeconds}s window</div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-rose-900/40 to-rose-800/20 border-rose-600/50 shadow-xl shadow-rose-900/20">
                <CardContent className="p-6 text-center">
                  <TrendingDown className="w-10 h-10 mx-auto mb-3 text-rose-400" />
                  <div className="text-3xl font-bold text-rose-300">${status.metrics.sellVolumeUsd.toFixed(0)}</div>
                  <div className="text-sm text-rose-200 font-medium">Sell Volume</div>
                  <div className="text-xs text-slate-300 mt-1">{config.timeWindowSeconds}s window</div>
                </CardContent>
              </Card>

              <Card
                className={`shadow-xl ${
                  status.metrics.netUsdFlow >= 0
                    ? "bg-gradient-to-br from-emerald-900/40 to-emerald-800/20 border-emerald-600/50 shadow-emerald-900/20"
                    : "bg-gradient-to-br from-rose-900/40 to-rose-800/20 border-rose-600/50 shadow-rose-900/20"
                }`}
              >
                <CardContent className="p-6 text-center">
                  <BarChart3
                    className={`w-10 h-10 mx-auto mb-3 ${status.metrics.netUsdFlow >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                  />
                  <div
                    className={`text-3xl font-bold ${status.metrics.netUsdFlow >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(0)}
                  </div>
                  <div
                    className={`text-sm font-medium ${status.metrics.netUsdFlow >= 0 ? "text-emerald-200" : "text-rose-200"}`}
                  >
                    Net Flow
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
                    {status.metrics.netUsdFlow >= config.minNetFlowUsd ? "🟢 Above threshold" : "🔴 Below threshold"}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-600/50 shadow-xl shadow-blue-900/20">
                <CardContent className="p-6 text-center">
                  <DollarSign className="w-10 h-10 mx-auto mb-3 text-blue-400" />
                  <div className="text-3xl font-bold text-blue-300">${status.metrics.currentPriceUsd.toFixed(6)}</div>
                  <div className="text-sm text-blue-200 font-medium">Current Price</div>
                  <div className="text-xs text-slate-300 mt-1">{status.metrics.currentPrice.toFixed(8)} SOL</div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-white text-lg">
                  <Activity className="w-6 h-6 text-cyan-400" />
                  Market Activity Monitor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Buy Pressure:</span>
                      <span className="text-emerald-400 font-mono text-lg font-bold">
                        ${status.metrics.buyVolumeUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Sell Pressure:</span>
                      <span className="text-rose-400 font-mono text-lg font-bold">
                        ${status.metrics.sellVolumeUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Net Flow:</span>
                      <span
                        className={`font-mono text-lg font-bold ${status.metrics.netUsdFlow >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Trigger Threshold:</span>
                      <span className="text-yellow-400 font-mono text-lg font-bold">${config.minNetFlowUsd}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Sell Amount:</span>
                      <span className="text-blue-400 font-mono text-lg font-bold">
                        ${Math.max(0, (status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-slate-300 font-medium">Last Sell:</span>
                      <span className="text-slate-200 font-mono text-lg font-bold">
                        {status.metrics.lastSellTrigger > 0 ? `${timeSinceLastSell}s ago` : "Never"}
                      </span>
                    </div>
                  </div>
                </div>

                {status.metrics.netUsdFlow >= config.minNetFlowUsd && (
                  <div className="mt-6 p-4 bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 border border-emerald-600/50 rounded-xl">
                    <div className="flex items-center gap-3 text-emerald-300 mb-2">
                      <TrendingUp className="w-5 h-5" />
                      <span className="font-bold text-lg">SELL TRIGGER ACTIVE</span>
                    </div>
                    <p className="text-emerald-200 leading-relaxed">
                      Net buying pressure detected! Will sell {config.sellPercentageOfNetFlow}% of $
                      {status.metrics.netUsdFlow.toFixed(2)} = $
                      {((status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)} worth of tokens
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-white text-lg">
                  <Wallet className="w-6 h-6 text-indigo-400" />
                  Wallet Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!Array.isArray(status?.walletStatus) || status.walletStatus.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Wallet className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">No wallets configured</p>
                    <p className="text-sm">Start the engine to see wallet status</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-72 overflow-auto">
                    {status.walletStatus.map((wallet, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-700/50 rounded-xl border border-slate-600 hover:bg-slate-700/70 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-mono text-sm text-slate-200 font-medium">
                            {wallet.publicKey?.slice(0, 12)}...{wallet.publicKey?.slice(-6)}
                          </span>
                          <Badge
                            variant={wallet.cooldownUntil > Date.now() ? "secondary" : "default"}
                            className={`px-3 py-1 ${
                              wallet.cooldownUntil > Date.now()
                                ? "bg-orange-600/20 text-orange-300 border-orange-600/50"
                                : "bg-emerald-600/20 text-emerald-300 border-emerald-600/50"
                            }`}
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
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <span className="text-slate-400 text-sm">SOL Balance: </span>
                            <span className="text-white font-mono font-semibold">
                              {(wallet.balance || 0).toFixed(4)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 text-sm">Token Balance: </span>
                            <span className="text-white font-mono font-semibold">
                              {(wallet.tokenBalance || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="text-white text-lg">System Log</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap bg-slate-900/80 border border-slate-600 p-4 rounded-xl max-h-48 overflow-auto text-slate-200 leading-relaxed">
                  {log ||
                    `Market momentum auto-sell ready. System monitors buy/sell activity in ${config.timeWindowSeconds}s windows and sells ${config.sellPercentageOfNetFlow}% of net positive USD flow when above $${config.minNetFlowUsd} threshold.`}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
