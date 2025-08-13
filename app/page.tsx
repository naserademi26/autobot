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
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-text">🤖 Market Momentum Auto-Sell</h1>
          <p className="text-slate-400 text-sm">
            Monitors market buy/sell activity and sells {config.sellPercentageOfNetFlow}% of net positive USD flow
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <span className="text-slate-400">RPC: </span>
            <span className={rpcOk ? "text-emerald-400" : rpcOk === false ? "text-rose-400" : "text-slate-400"}>
              {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
            </span>
          </div>
          <Badge
            variant={status.isRunning ? "default" : "secondary"}
            className={status.isRunning ? "bg-green-600 animate-pulse" : "bg-gray-600"}
          >
            {status.isRunning ? "🟢 MONITORING" : "🔴 STOPPED"}
          </Badge>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1 space-y-6">
          {/* Wallet Management */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Wallet Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                className="input min-h-[120px] font-mono text-xs"
                placeholder="One base58 or JSON secret array per line"
                value={vaultKeys}
                onChange={(e) => setVaultKeys(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={addVault}>
                  Add Wallets
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConnected([])}>
                  Clear
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>
                  Select All
                </Button>
                <Button size="sm" variant="outline" onClick={refreshBalances} disabled={balancesLoading}>
                  <RefreshCw className={`w-4 h-4 ${balancesLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-slate-800/50 p-3 rounded-lg text-center">
                  <div className="text-xl font-bold text-blue-400">{connected.length}</div>
                  <div className="text-slate-400">Wallets</div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg text-center">
                  <div className="text-xl font-bold text-green-400">{selectedCount}</div>
                  <div className="text-slate-400">Selected</div>
                </div>
              </div>

              {connected.length > 0 && (
                <div className="max-h-40 overflow-auto border border-slate-700 rounded-lg p-2">
                  {connected.map((w) => (
                    <div key={w.pubkey} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={!!selected[w.pubkey]}
                        onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                        className="rounded"
                      />
                      <span className="font-mono text-xs text-slate-300">
                        {w.pubkey.slice(0, 6)}...{w.pubkey.slice(-4)}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto">
                        {balances[w.pubkey]?.toFixed(3) || "0.000"} SOL
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Token Configuration */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Market Momentum Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Token Mint Address</Label>
                <Input
                  placeholder="Paste mint address or pump.fun URL"
                  value={mintRaw}
                  onChange={(e) => setMintRaw(e.target.value)}
                  className="font-mono text-sm"
                />
                {token.name && (
                  <p className="text-sm text-green-400 mt-1">
                    ✅ {token.name} ({token.symbol}) via {token.source}
                  </p>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Time Window (sec)</Label>
                  <Input
                    type="number"
                    min="60"
                    max="600"
                    value={config.timeWindowSeconds}
                    onChange={(e) => setConfig((prev) => ({ ...prev, timeWindowSeconds: Number(e.target.value) }))}
                  />
                  <p className="text-xs text-slate-400 mt-1">Track buy/sell activity</p>
                </div>
                <div>
                  <Label>Sell % of Net Flow</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={config.sellPercentageOfNetFlow}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sellPercentageOfNetFlow: Number(e.target.value) }))
                    }
                  />
                  <p className="text-xs text-slate-400 mt-1">% of net USD flow</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Min Net Flow ($)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={config.minNetFlowUsd}
                    onChange={(e) => setConfig((prev) => ({ ...prev, minNetFlowUsd: Number(e.target.value) }))}
                  />
                  <p className="text-xs text-slate-400 mt-1">Minimum trigger amount</p>
                </div>
                <div>
                  <Label>Cooldown (sec)</Label>
                  <Input
                    type="number"
                    value={config.cooldownSeconds}
                    onChange={(e) => setConfig((prev) => ({ ...prev, cooldownSeconds: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div>
                <Label>Slippage (bps)</Label>
                <Input
                  type="number"
                  value={config.slippageBps}
                  onChange={(e) => setConfig((prev) => ({ ...prev, slippageBps: Number(e.target.value) }))}
                />
                <p className="text-xs text-slate-400 mt-1">300 bps = 3%</p>
              </div>
            </CardContent>
          </Card>

          {/* Control Panel */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Engine Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={startAutoSell}
                  disabled={loading || status.isRunning || !mint || selectedCount === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start
                </Button>
                <Button onClick={stopAutoSell} disabled={loading || !status.isRunning} variant="destructive">
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                  Stop
                </Button>
              </div>

              {status.config && (
                <div className="text-xs text-slate-400 space-y-1">
                  <div>Window: {status.config.timeWindowSeconds}s</div>
                  <div>Sell: {status.config.sellPercentageOfNetFlow}% of net flow</div>
                  <div>Min Trigger: ${status.config.minNetFlowUsd}</div>
                  <div>Cooldown: {status.config.cooldownSeconds}s</div>
                  <div className="text-yellow-400">Sells tokens for SOL based on market momentum</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Monitoring Dashboard */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-green-900/20 border-green-600/50">
              <CardContent className="p-4 text-center">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-green-400" />
                <div className="text-2xl font-bold text-green-400">${status.metrics.buyVolumeUsd.toFixed(0)}</div>
                <div className="text-sm text-green-300">Buy Volume</div>
                <div className="text-xs text-slate-400">{config.timeWindowSeconds}s window</div>
              </CardContent>
            </Card>

            <Card className="bg-red-900/20 border-red-600/50">
              <CardContent className="p-4 text-center">
                <TrendingDown className="w-8 h-8 mx-auto mb-2 text-red-400" />
                <div className="text-2xl font-bold text-red-400">${status.metrics.sellVolumeUsd.toFixed(0)}</div>
                <div className="text-sm text-red-300">Sell Volume</div>
                <div className="text-xs text-slate-400">{config.timeWindowSeconds}s window</div>
              </CardContent>
            </Card>

            <Card
              className={`${status.metrics.netUsdFlow >= 0 ? "bg-green-900/20 border-green-600/50" : "bg-red-900/20 border-red-600/50"}`}
            >
              <CardContent className="p-4 text-center">
                <BarChart3
                  className={`w-8 h-8 mx-auto mb-2 ${status.metrics.netUsdFlow >= 0 ? "text-green-400" : "text-red-400"}`}
                />
                <div
                  className={`text-2xl font-bold ${status.metrics.netUsdFlow >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(0)}
                </div>
                <div className={`text-sm ${status.metrics.netUsdFlow >= 0 ? "text-green-300" : "text-red-300"}`}>
                  Net Flow
                </div>
                <div className="text-xs text-slate-400">
                  {status.metrics.netUsdFlow >= config.minNetFlowUsd ? "🟢 Above threshold" : "🔴 Below threshold"}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-blue-900/20 border-blue-600/50">
              <CardContent className="p-4 text-center">
                <DollarSign className="w-8 h-8 mx-auto mb-2 text-blue-400" />
                <div className="text-2xl font-bold text-blue-400">${status.metrics.currentPriceUsd.toFixed(6)}</div>
                <div className="text-sm text-blue-300">Current Price</div>
                <div className="text-xs text-slate-400">{status.metrics.currentPrice.toFixed(8)} SOL</div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Market Activity Monitor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Buy Pressure:</span>
                    <span className="text-green-400 font-mono">${status.metrics.buyVolumeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Sell Pressure:</span>
                    <span className="text-red-400 font-mono">${status.metrics.sellVolumeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Net Flow:</span>
                    <span className={`font-mono ${status.metrics.netUsdFlow >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {status.metrics.netUsdFlow >= 0 ? "+" : ""}${status.metrics.netUsdFlow.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Trigger Threshold:</span>
                    <span className="text-yellow-400 font-mono">${config.minNetFlowUsd}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Sell Amount:</span>
                    <span className="text-blue-400 font-mono">
                      ${Math.max(0, (status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Last Sell:</span>
                    <span className="text-slate-300 font-mono">
                      {status.metrics.lastSellTrigger > 0 ? `${timeSinceLastSell}s ago` : "Never"}
                    </span>
                  </div>
                </div>
              </div>

              {status.metrics.netUsdFlow >= config.minNetFlowUsd && (
                <div className="mt-4 p-3 bg-green-900/20 border border-green-600/50 rounded-lg">
                  <div className="flex items-center gap-2 text-green-400">
                    <TrendingUp className="w-4 h-4" />
                    <span className="font-semibold">SELL TRIGGER ACTIVE</span>
                  </div>
                  <p className="text-sm text-green-300 mt-1">
                    Net buying pressure detected! Will sell {config.sellPercentageOfNetFlow}% of $
                    {status.metrics.netUsdFlow.toFixed(2)} = $
                    {((status.metrics.netUsdFlow * config.sellPercentageOfNetFlow) / 100).toFixed(2)} worth of tokens
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Wallet Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status.walletStatus.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No wallets configured</p>
                  <p className="text-sm">Start the engine to see wallet status</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-60 overflow-auto">
                  {status.walletStatus.map((wallet, idx) => (
                    <div key={idx} className="p-3 bg-slate-800/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm text-slate-300">
                          {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-4)}
                        </span>
                        <Badge variant={wallet.cooldownUntil > Date.now() ? "secondary" : "default"}>
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
                        <div>
                          <span className="text-slate-400">SOL: </span>
                          <span className="text-white font-mono">{wallet.balance.toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Tokens: </span>
                          <span className="text-white font-mono">{wallet.tokenBalance.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* System Log */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle>System Log</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap bg-black/30 p-4 rounded-lg max-h-40 overflow-auto">
                {log ||
                  `Market momentum auto-sell ready. System monitors buy/sell activity in ${config.timeWindowSeconds}s windows and sells ${config.sellPercentageOfNetFlow}% of net positive USD flow when above $${config.minNetFlowUsd} threshold.`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
