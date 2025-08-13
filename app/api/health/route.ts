import { NextResponse } from "next/server"
import { Connection } from "@solana/web3.js"
import { AbortSignal } from "abort-controller"

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

export async function GET() {
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
    }
  } catch (e) {
    // Auto-sell module not loaded yet
  }

  try {
    const conn = new Connection(HELIUS_RPC_URL, { commitment: "confirmed" })
    const bh = await conn.getLatestBlockhash("confirmed")
    out.rpc = { ok: true, lastValidBlockHeight: bh.lastValidBlockHeight }
  } catch (e: any) {
    out.rpc = { ok: false, error: e?.message || String(e) }
  }

  try {
    const url = `${JUP_BASE}/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=So11111111111111111111111111111111111111112&amount=1000&slippageBps=10`
    const res = await fetch(url, {
      headers: { "X-API-Key": JUP_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    out.jupiter = { ok: res.ok, status: res.status }
  } catch (e: any) {
    out.jupiter = { ok: false, error: e?.message || String(e) }
  }

  try {
    const resRegion = await fetch(BXR_REGION, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    const resSubmit = await fetch(BXR_SUBMIT, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    out.bloxroute = {
      regionReachable: true,
      regionStatus: resRegion.status,
      submitReachable: true,
      submitStatus: resSubmit.status,
    }
  } catch (e: any) {
    out.bloxroute = { reachable: false, error: e?.message || String(e) }
  }

  return NextResponse.json(out)
}
