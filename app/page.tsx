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

interface AutoSellConfig {
  windowSeconds: number
  minTradeUsd: number
  sellFractionOfNet: number
  cooldownSeconds: number
  slippageBps: number
}

interface AutoSellStatus {
  isRunning: boolean
  currentWindow: {
    buys: number
    sells: number
    net: number
    priceUsd: number
  }
  lastActivity: string
  totalSells: number
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

export default function Home() {
  const connection = useMemo(() => new Connection(ENDPOINT, { commitment: "confirmed" }), [])
  const [rpcOk, setRpcOk] = useState<boolean | null>(null)

  const [vaultKeys, setVaultKeys] = useState<string>("")
  const [connected, setConnected] = useState<VaultEntry[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({})
  const [balancesLoading, setBalancesLoading] = useState(false)

  const [mintRaw, setMintRaw] = useState<string>("")
  const mint = useMemo(() => sanitizeMintInput(mintRaw), [mintRaw])
  const [token, setToken] = useState<TokenInfo>({})

  const [autoSellConfig, setAutoSellConfig] = useState<AutoSellConfig>({
    windowSeconds: 120,
    minTradeUsd: 1,
    sellFractionOfNet: 0.25,
    cooldownSeconds: 30,
    slippageBps: 2000,
  })

  const [autoSellStatus, setAutoSellStatus] = useState<AutoSellStatus>({
    isRunning: false,
    currentWindow: { buys: 0, sells: 0, net: 0, priceUsd: 0 },
    lastActivity: "Never",
    totalSells: 0,
  })

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
      setTokenBalances({})
      return
    }
    setBalancesLoading(true)
    try {
      const nextSol: Record<string, number> = {}
      const nextToken: Record<string, number> = {}

      // Get SOL balances
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
          nextSol[key] = lamports / 1e9
        })
        if (cur !== refreshId.current) return
      }

      // Get token balances if mint is set
      if (mint) {
        try {
          const res = await fetch("/api/token-balances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mint, wallets: pubkeys }),
          })
          if (res.ok) {
            const tokenData = await res.json()
            Object.assign(nextToken, tokenData.balances || {})
          }
        } catch (e) {
          console.error("Failed to fetch token balances:", e)
        }
      }

      if (cur === refreshId.current) {
        setBalances(nextSol)
        setTokenBalances(nextToken)
      }
    } finally {
      if (cur === refreshId.current) setBalancesLoading(false)
    }
  }

  useEffect(() => {
    void refreshBalances()
  }, [connected, connection, mint])

  function toggleAll(v: boolean) {
    const s: Record<string, boolean> = {}
    connected.forEach((w) => (s[w.pubkey] = v))
    setSelected(s)
  }

  async function startAutoSell() {
    if (!mint || Object.values(selected).every((v) => !v)) {
      setLog("❌ Please select a token and wallets first")
      return
    }

    try {
      const keys = connected.filter((w) => selected[w.pubkey] && w.hasSecret).map((w) => w.sk!)

      const res = await fetch("/api/auto-sell/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint,
          privateKeys: keys,
          config: autoSellConfig,
        }),
      })

      const result = await res.json()
      if (res.ok) {
        setAutoSellStatus({ ...autoSellStatus, isRunning: true })
        setLog(`✅ Auto-sell started for ${token.symbol || mint.slice(0, 8)}...\n${JSON.stringify(result, null, 2)}`)
      } else {
        setLog(`❌ Failed to start auto-sell: ${result.error}`)
      }
    } catch (e: any) {
      setLog(`❌ Error starting auto-sell: ${e.message}`)
    }
  }

  async function stopAutoSell() {
    try {
      const res = await fetch("/api/auto-sell/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      })

      const result = await res.json()
      if (res.ok) {
        setAutoSellStatus({ ...autoSellStatus, isRunning: false })
        setLog(`🛑 Auto-sell stopped\n${JSON.stringify(result, null, 2)}`)
      } else {
        setLog(`❌ Failed to stop auto-sell: ${result.error}`)
      }
    } catch (e: any) {
      setLog(`❌ Error stopping auto-sell: ${e.message}`)
    }
  }

  useEffect(() => {
    if (!mint || !autoSellStatus.isRunning) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auto-sell/status?mint=${mint}`)
        if (res.ok) {
          const status = await res.json()
          setAutoSellStatus((prev) => ({
            ...prev,
            currentWindow: status.window || prev.currentWindow,
            lastActivity: status.lastActivity || prev.lastActivity,
            totalSells: status.totalSells || prev.totalSells,
          }))
        }
      } catch (e) {
        console.error("Failed to fetch auto-sell status:", e)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [mint, autoSellStatus.isRunning])

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected])
  const totalSelectedSol = useMemo(
    () =>
      connected.reduce((acc, w) => {
        if (!selected[w.pubkey]) return acc
        return acc + (balances[w.pubkey] ?? 0)
      }, 0),
    [connected, selected, balances],
  )
  const totalSelectedTokens = useMemo(
    () =>
      connected.reduce((acc, w) => {
        if (!selected[w.pubkey]) return acc
        return acc + (tokenBalances[w.pubkey] ?? 0)
      }, 0),
    [connected, selected, tokenBalances],
  )

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Solana Auto-Sell Bot</h1>
          <p className="text-slate-400 text-sm">Monitor trades and automatically sell when profitable.</p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <span className="text-slate-400">RPC: </span>
            <span className={rpcOk ? "text-emerald-400" : rpcOk === false ? "text-rose-400" : "text-slate-400"}>
              {rpcOk == null ? "Checking..." : rpcOk ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <span className="text-slate-400">Auto-Sell: </span>
            <span className={autoSellStatus.isRunning ? "text-emerald-400" : "text-slate-400"}>
              {autoSellStatus.isRunning ? "Running" : "Stopped"}
            </span>
          </div>
        </div>
      </header>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <h2 className="font-semibold">1) Connect wallets</h2>
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
                setTokenBalances({})
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
              Selected Tokens: <span className="font-mono text-white">{totalSelectedTokens.toFixed(2)}</span>
            </div>
          </div>

          <div className="max-h-72 overflow-auto border border-slate-800 rounded-xl p-2">
            {connected.length === 0 ? (
              <p className="text-slate-400 text-sm">No vault wallets yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {connected.map((w) => {
                  const solBal = balances[w.pubkey]
                  const tokenBal = tokenBalances[w.pubkey]
                  return (
                    <li key={w.pubkey} className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!selected[w.pubkey]}
                          onChange={(e) => setSelected({ ...selected, [w.pubkey]: e.target.checked })}
                        />
                        <span className="font-mono text-xs">
                          {w.pubkey.slice(0, 8)}...{w.pubkey.slice(-4)}
                        </span>
                      </label>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-mono tabular-nums">
                          {solBal == null ? "…" : `${solBal.toFixed(3)} SOL`}
                        </span>
                        {mint && (
                          <span className="font-mono tabular-nums text-orange-400">
                            {tokenBal == null ? "…" : `${tokenBal.toFixed(2)} ${token.symbol || "TOK"}`}
                          </span>
                        )}
                        <span className={w.hasSecret ? "text-emerald-400" : "text-yellow-400"}>
                          {w.hasSecret ? "🔑" : "👁"}
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
          <h2 className="font-semibold">2) Configure auto-sell</h2>
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

          <div className="space-y-3 border-t border-slate-800 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-400">
                Window (seconds):
                <input
                  className="input mt-1"
                  type="number"
                  min={30}
                  step={30}
                  value={autoSellConfig.windowSeconds}
                  onChange={(e) => setAutoSellConfig({ ...autoSellConfig, windowSeconds: Number(e.target.value) })}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Min trade USD:
                <input
                  className="input mt-1"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={autoSellConfig.minTradeUsd}
                  onChange={(e) => setAutoSellConfig({ ...autoSellConfig, minTradeUsd: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-400">
                Sell fraction of net:
                <input
                  className="input mt-1"
                  type="number"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={autoSellConfig.sellFractionOfNet}
                  onChange={(e) => setAutoSellConfig({ ...autoSellConfig, sellFractionOfNet: Number(e.target.value) })}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Cooldown (seconds):
                <input
                  className="input mt-1"
                  type="number"
                  min={5}
                  step={5}
                  value={autoSellConfig.cooldownSeconds}
                  onChange={(e) => setAutoSellConfig({ ...autoSellConfig, cooldownSeconds: Number(e.target.value) })}
                />
              </label>
            </div>

            <label className="block text-xs text-slate-400">
              Slippage (bps):
              <input
                className="input mt-1"
                type="number"
                min={100}
                step={100}
                value={autoSellConfig.slippageBps}
                onChange={(e) => setAutoSellConfig({ ...autoSellConfig, slippageBps: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="flex gap-2 pt-3">
            <button
              className="btn flex-1 bg-emerald-600 hover:bg-emerald-500"
              disabled={autoSellStatus.isRunning || !mint || Object.values(selected).every((v) => !v)}
              onClick={startAutoSell}
            >
              {autoSellStatus.isRunning ? "🟢 Running" : "▶️ Start Auto-Sell"}
            </button>
            <button
              className="btn flex-1 bg-red-600 hover:bg-red-500"
              disabled={!autoSellStatus.isRunning}
              onClick={stopAutoSell}
            >
              🛑 Stop
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3">Auto-Sell Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="text-center">
            <div className="text-2xl font-mono text-emerald-400">${autoSellStatus.currentWindow.buys.toFixed(2)}</div>
            <div className="text-xs text-slate-400">Buys (window)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono text-red-400">${autoSellStatus.currentWindow.sells.toFixed(2)}</div>
            <div className="text-xs text-slate-400">Sells (window)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono text-blue-400">${autoSellStatus.currentWindow.net.toFixed(2)}</div>
            <div className="text-xs text-slate-400">Net USD</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono text-yellow-400">
              ${autoSellStatus.currentWindow.priceUsd.toFixed(6)}
            </div>
            <div className="text-xs text-slate-400">Token Price</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm text-slate-300">
          <div>
            Last Activity: <span className="text-white">{autoSellStatus.lastActivity}</span>
          </div>
          <div>
            Total Sells: <span className="text-white">{autoSellStatus.totalSells}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Activity Log</h2>
        <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto">{log}</pre>
      </section>
    </div>
  )
}
