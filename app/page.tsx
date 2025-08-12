"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import bs58 from "bs58"
import { Connection, PublicKey } from "@solana/web3.js"

type VaultEntry = { pubkey: string; hasSecret: boolean; sk?: string }

interface TokenInfo {
  name?: string
  symbol?: string
  source?: "jup" | "pump" | "unknown"
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

export default function Page() {
  return <App />
}

function App() {
  const connection = useMemo(() => new Connection(ENDPOINT, { commitment: "confirmed" }), [])
  const [rpcOk, setRpcOk] = useState<boolean | null>(null)

  const [vaultKeys, setVaultKeys] = useState<string>("")
  const [connected, setConnected] = useState<VaultEntry[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [balancesLoading, setBalancesLoading] = useState(false)

  const [mintRaw, setMintRaw] = useState<string>("")
  const mint = useMemo(() => sanitizeMintInput(mintRaw), [mintRaw])
  const [token, setToken] = useState<TokenInfo>({})

  const [activeTab, setActiveTab] = useState<"buy" | "sell" | "auto-sell">("buy")
  const [buyPerc, setBuyPerc] = useState<number>(50)
  const [sellPerc, setSellPerc] = useState<number>(100)
  const [slippageBps, setSlippageBps] = useState<number>(2000)

  const [autoSellActive, setAutoSellActive] = useState(false)
  const [autoSellPerc, setAutoSellPerc] = useState<number>(100)
  const [monitoredMints, setMonitoredMints] = useState<string[]>([])

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

  async function execute() {
    setLoading(true)
    const action = activeTab === "buy" ? "buy" : "sell"
    const percentage = activeTab === "buy" ? buyPerc : sellPerc
    setLog(`🚀 Executing ultra-fast ${action} with all selected wallets simultaneously...`)

    try {
      const keys = connected.filter((w) => selected[w.pubkey] && w.hasSecret).map((w) => w.sk!)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const endpoint = activeTab === "buy" ? "/api/snipe" : "/api/sell"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          mint,
          privateKeys: keys.slice(0, 65),
          limitWallets: 65,
          percentage,
          slippageBps,
        }),
      })

      clearTimeout(timeoutId)
      const j = await res.json()
      setLog(JSON.stringify(j, null, 2))
    } catch (e: any) {
      if (e.name === "AbortError") {
        setLog(`Timeout: Operation took longer than 30 seconds`)
      } else {
        setLog(`Error: ${e?.message || String(e)}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function startAutoSell() {
    if (!mint) return
    setLoading(true)
    setLog(`🤖 Starting auto-sell monitoring for ${mint}...`)

    try {
      const keys = connected.filter((w) => selected[w.pubkey] && w.hasSecret).map((w) => w.sk!)
      const res = await fetch("/api/auto-sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          mint,
          privateKeys: keys.slice(0, 65),
          percentage: autoSellPerc,
          slippageBps,
        }),
      })

      const j = await res.json()
      if (j.success) {
        setAutoSellActive(true)
        setMonitoredMints([...monitoredMints, mint])
        setLog(`✅ Auto-sell monitoring started for ${mint}\nWatching for new buys to trigger sells...`)
      } else {
        setLog(`❌ Failed to start auto-sell: ${j.error}`)
      }
    } catch (e: any) {
      setLog(`Error: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function stopAutoSell() {
    setLoading(true)
    setLog(`🛑 Stopping auto-sell monitoring...`)

    try {
      const res = await fetch("/api/auto-sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          mint,
        }),
      })

      const j = await res.json()
      setAutoSellActive(false)
      setMonitoredMints(monitoredMints.filter((m) => m !== mint))
      setLog(`✅ Auto-sell monitoring stopped`)
    } catch (e: any) {
      setLog(`Error: ${e?.message || String(e)}`)
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
  const totalVaultSol = useMemo(
    () => connected.reduce((acc, w) => acc + (balances[w.pubkey] ?? 0), 0),
    [connected, balances],
  )

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Solana Sniper · 65 Wallets</h1>
          <p className="text-slate-400 text-sm">Paste keys, pick mint, execute ultra-fast buy/sell or auto-sell.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
          <span className="text-slate-400">RPC: </span>
          <span className={rpcOk ? "text-emerald-400" : rpcOk === false ? "text-rose-400" : "text-slate-400"}>
            {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <h2 className="font-semibold">1) Connect wallets (local vault)</h2>
          <textarea
            className="input min-h-[140px] font-mono"
            placeholder="One base58 or JSON secret array per line"
            value={vaultKeys}
            onChange={(e) => setVaultKeys(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => addVault()}>
              Add to vault
            </button>
            <button
              className="btn bg-slate-700 hover:bg-slate-600"
              onClick={() => {
                setConnected([])
                setSelected({})
                setBalances({})
              }}
            >
              Clear
            </button>
            <button className="btn bg-slate-700 hover:bg-slate-600" onClick={() => toggleAll(true)}>
              Select all
            </button>
            <button className="btn bg-slate-700 hover:bg-slate-600" onClick={() => toggleAll(false)}>
              Unselect all
            </button>
            <button
              className="btn bg-indigo-700 hover:bg-indigo-600"
              onClick={() => refreshBalances()}
              disabled={balancesLoading}
            >
              {balancesLoading ? "Refreshing…" : "Refresh balances"}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm text-slate-300">
            <div>Vault wallets: {connected.length}</div>
            <div>Selected: {selectedCount}</div>
            <div>
              Selected SOL: <span className="font-mono text-white">{totalSelectedSol.toFixed(4)} SOL</span>
            </div>
            <div>
              Total SOL: <span className="font-mono text-white">{totalVaultSol.toFixed(4)} SOL</span>
            </div>
          </div>

          <div className="max-h-72 overflow-auto border border-slate-800 rounded-xl p-2">
            {connected.length === 0 ? (
              <p className="text-slate-400 text-sm">No vault wallets yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {connected.map((w) => {
                  const bal = balances[w.pubkey]
                  return (
                    <li key={w.pubkey} className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!selected[w.pubkey]}
                          onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                        />
                        <span className="font-mono">{w.pubkey}</span>
                      </label>
                      <div className="flex items-center gap-3">
                        <span className="font-mono tabular-nums">{bal == null ? "…" : `${bal.toFixed(4)} SOL`}</span>
                        <span className={w.hasSecret ? "text-emerald-400" : "text-yellow-400"}>
                          {w.hasSecret ? "secret" : "read-only"}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">2) Pick token</h2>
          <input
            className="input"
            placeholder="Paste mint address or pump.fun URL"
            value={mintRaw}
            onChange={(e) => setMintRaw(e.target.value)}
          />
          <div className="text-xs text-slate-400">
            Using mint: <span className="text-white font-mono">{mint || "—"}</span>
          </div>

          <div className="text-sm text-slate-300">
            {token.name ? (
              <p>
                Resolved: <span className="text-white font-semibold">{token.name}</span>{" "}
                {token.symbol ? `(${token.symbol})` : ""} <span className="text-slate-400">via {token.source}</span>
              </p>
            ) : (
              <p>We try Jupiter first, then Pump.fun metadata.</p>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab("buy")}
              className={`btn flex-1 ${activeTab === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-700 hover:bg-slate-600"}`}
            >
              🚀 BUY
            </button>
            <button
              onClick={() => setActiveTab("sell")}
              className={`btn flex-1 ${activeTab === "sell" ? "bg-rose-600 hover:bg-rose-500" : "bg-slate-700 hover:bg-slate-600"}`}
            >
              💰 SELL
            </button>
            <button
              onClick={() => setActiveTab("auto-sell")}
              className={`btn flex-1 ${activeTab === "auto-sell" ? "bg-purple-600 hover:bg-purple-500" : "bg-slate-700 hover:bg-slate-600"}`}
            >
              🤖 AUTO SELL
            </button>
          </div>

          {activeTab === "buy" ? (
            <div className="space-y-3">
              <h3 className="font-semibold">3) Buy percentage & slippage</h3>
              <div className="flex flex-wrap gap-2">
                {[25, 50, 75, 95, 100].map((p) => (
                  <button
                    key={p}
                    onClick={() => setBuyPerc(p)}
                    className={`btn ${buyPerc === p ? "bg-emerald-500" : "bg-slate-700 hover:bg-slate-600"}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">Percentage of SOL balance to spend on buying tokens.</p>
            </div>
          ) : activeTab === "sell" ? (
            <div className="space-y-3">
              <h3 className="font-semibold">3) Sell percentage</h3>
              <div className="flex flex-wrap gap-2">
                {[25, 50, 75, 100].map((p) => (
                  <button
                    key={p}
                    onClick={() => setSellPerc(p)}
                    className={`btn ${sellPerc === p ? "bg-rose-500" : "bg-slate-700 hover:bg-slate-600"}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSellPerc(100)}
                className={`btn w-full ${sellPerc === 100 ? "bg-rose-500" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                SELL ALL (100%)
              </button>
              <p className="text-xs text-slate-400">Percentage of token balance to sell.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="font-semibold">3) Auto-sell settings</h3>
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">Sell percentage when triggered:</label>
                <div className="flex flex-wrap gap-2">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      onClick={() => setAutoSellPerc(p)}
                      className={`btn ${autoSellPerc === p ? "bg-purple-500" : "bg-slate-700 hover:bg-slate-600"}`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>

                {monitoredMints.length > 0 && (
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold">Currently monitoring:</p>
                    <ul className="list-disc list-inside">
                      {monitoredMints.map((m) => (
                        <li key={m} className="font-mono">
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="block text-xs text-slate-400 mt-2">
            Slippage (bps):
            <input
              className="input mt-1"
              type="number"
              min={100}
              step={100}
              value={slippageBps}
              onChange={(e) => setSlippageBps(Math.max(100, Number(e.target.value || 0)))}
            />
          </label>
          <p className="text-xs text-slate-400">2000 bps = 20%. Higher slippage = faster fills on new launches.</p>

          {activeTab === "auto-sell" ? (
            <div className="space-y-2">
              <button
                className="btn w-full bg-purple-600 hover:bg-purple-500"
                disabled={loading || !mint || Object.values(selected).every((v) => !v) || autoSellActive}
                onClick={startAutoSell}
              >
                {loading ? "🤖 Starting auto-sell..." : autoSellActive ? "🤖 AUTO-SELL ACTIVE" : "🤖 START AUTO-SELL"}
              </button>
              {autoSellActive && (
                <button className="btn w-full bg-red-600 hover:bg-red-500" disabled={loading} onClick={stopAutoSell}>
                  🛑 STOP AUTO-SELL
                </button>
              )}
            </div>
          ) : (
            <button
              className="btn w-full mt-2"
              disabled={loading || !mint || Object.values(selected).every((v) => !v)}
              onClick={execute}
            >
              {loading
                ? `🚀 ${activeTab === "buy" ? "Buying" : "Selling"} with all wallets...`
                : `🚀 ULTRA-FAST ${activeTab.toUpperCase()} (All Wallets)`}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Run output</h2>
        <pre className="text-xs whitespace-pre-wrap">{log}</pre>
      </section>
    </div>
  )
}
