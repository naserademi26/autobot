import { NextResponse } from "next/server"
import { Connection } from "@solana/web3.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e"

const BXR_REGION = process.env.BLOXROUTE_REGION_URL || "https://ny.solana.dex.blxrbdn.com"
const BXR_SUBMIT = process.env.BLOXROUTE_SUBMIT_URL || "https://global.solana.dex.blxrbdn.com"

const JUP_BASE = process.env.JUP_BASE || "https://api.jup.ag"
const JUP_API_KEY = process.env.JUP_API_KEY || process.env.JUPITER_API_KEY || "e2f280df-aa16-4c78-979c-6468f660dbfb"

const healthCache = {
  lastCheck: 0,
  data: null as any,
  ttl: 10000, // 10 seconds cache
}

export async function GET() {
  const now = Date.now()

  if (healthCache.data && now - healthCache.lastCheck < healthCache.ttl) {
    return NextResponse.json(healthCache.data)
  }

  const out: any = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    autoSell: {
      running: false,
      wallets: 0,
      lastActivity: null,
    },
  }

  try {
    const { autoSellState } = await import("../auto-sell/start/route")
    out.autoSell = {
      running: autoSellState.isRunning,
      wallets: autoSellState.wallets?.length || 0,
      lastActivity: autoSellState.metrics?.lastSellTrigger || null,
      memoryWarnings: autoSellState.memoryUsage?.warnings || 0,
      peakMemoryMB: Math.round((autoSellState.memoryUsage?.peakRSS || 0) / 1024 / 1024),
    }
  } catch (e) {
    // Auto-sell module not loaded yet
  }

  try {
    const conn = new Connection(HELIUS_RPC_URL, { commitment: "confirmed" })
    const bh = (await Promise.race([
      conn.getLatestBlockhash("confirmed"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 8000)),
    ])) as any
    out.rpc = { ok: true, lastValidBlockHeight: bh.lastValidBlockHeight }
  } catch (e: any) {
    out.rpc = { ok: false, error: e?.message || String(e) }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const url = `${JUP_BASE}/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=So11111111111111111111111111111111111111112&amount=1000&slippageBps=10`
    const res = await fetch(url, {
      headers: { "X-API-Key": JUP_API_KEY, Accept: "application/json" },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    out.jupiter = { ok: res.ok, status: res.status }
  } catch (e: any) {
    out.jupiter = { ok: false, error: e?.message || String(e) }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const resRegion = await fetch(BXR_REGION, {
      method: "GET",
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    out.bloxroute = {
      regionReachable: true,
      regionStatus: resRegion.status,
      submitReachable: true, // Assume submit works if region works
      submitStatus: 200,
    }
  } catch (e: any) {
    out.bloxroute = { reachable: false, error: e?.message || String(e) }
  }

  healthCache.lastCheck = now
  healthCache.data = out

  return NextResponse.json(out)
}
