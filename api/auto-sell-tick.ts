import { z } from "zod"

const TradeSchema = z.object({
  ts: z.number(),
  side: z.enum(["buy", "sell"]),
  usd: z.number().nonnegative(),
})

// In-memory state for volume tracking
let lastPush: { buyers_usd: number; sellers_usd: number; at: number; window_seconds: number } | null = null
let lastSellAt = 0

const TRIGGER_MODE = (process.env.TRIGGER_MODE || "netflow").toLowerCase()
const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25") // 25% of net volume
const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? "120") // 2 minutes
const COOLDOWN_MS = Number(process.env.COOLDOWN_SECONDS ?? "0") * 1000
const NET_FLOW_MIN_USD = Number(process.env.NET_FLOW_MIN_USD ?? "0")

async function getUsdPerBaseUnit(mint: string): Promise<number> {
  const QUOTE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC
  const JUP_BASE = "https://quote-api.jup.ag"

  const key = process.env.JUPITER_API_KEY || process.env.NEXT_PUBLIC_JUPITER_API_KEY || process.env.JUP_API_KEY
  const headers = key
    ? { "Content-Type": "application/json", "X-API-KEY": key }
    : { "Content-Type": "application/json" }

  const url = `${JUP_BASE}/v6/quote?inputMint=${mint}&outputMint=${QUOTE_MINT}&amount=1000000&slippageBps=50`
  const res = await fetch(url, { cache: "no-store", headers })

  if (!res.ok) return 0
  const data = await res.json()
  const route = data?.data?.[0]
  if (!route) return 0

  const outAmount = Number(route.outAmount)
  const inAmount = Number(route.inAmount)
  if (!outAmount || !inAmount) return 0

  return outAmount / inAmount
}

async function tokensFromUsd(usd: number, mint: string): Promise<bigint> {
  if (usd <= 0) return BigInt(0)
  const usdcPerBase = await getUsdPerBaseUnit(mint)
  if (usdcPerBase <= 0) return BigInt(0)
  const baseUnits = Math.floor(usd / usdcPerBase)
  return BigInt(baseUnits)
}

async function sendToExecutor(payload: any) {
  const url = process.env.EXECUTOR_URL
  const secret = process.env.EXECUTOR_SECRET

  if (!url || !secret) {
    // Fallback to internal sell handler if no external executor configured
    const { POST: sellHandler } = await import("../sell/route")

    const mockRequest = new Request("http://localhost:3000/api/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint: payload.mint,
        privateKeys: payload.privateKeys,
        percentage: payload.percentage || 25,
        slippageBps: payload.slippageBps || 2000,
      }),
    })

    const response = await sellHandler(mockRequest)
    const result = await response.json()

    return {
      ok: response.ok,
      status: response.status,
      data: result,
    }
  }

  // External executor call
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth": secret },
    body: JSON.stringify(payload),
  })

  return {
    ok: res.ok,
    status: res.status,
    data: await res.json(),
  }
}

export const config = { runtime: "nodejs" }

export default async function handler(req: Request) {
  try {
    // Skip if in perbuy mode (handled by ingest-trade)
    if (TRIGGER_MODE === "perbuy") {
      return new Response(JSON.stringify({ ok: true, mode: "perbuy", reason: "handled by ingest-trade" }))
    }

    // Get active auto-sell configuration
    const mintAddress = process.env.AUTO_SELL_MINT
    const privateKeys = process.env.AUTO_SELL_WALLETS?.split(",") || []

    if (!mintAddress || !privateKeys.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "no auto-sell config",
          mintAddress: !!mintAddress,
          walletsCount: privateKeys.length,
        }),
      )
    }

    // Get buy/sell volume from pushed data or fallback to blockchain monitoring
    const pushed = lastPush
    let buyers_usd = 0,
      sellers_usd = 0

    if (pushed && Date.now() - pushed.at <= pushed.window_seconds * 1000 + 2000) {
      buyers_usd = pushed.buyers_usd
      sellers_usd = pushed.sellers_usd
    } else {
      console.log("No recent pushed data, using fallback monitoring")
      // In production, this would query Helius or other data source
      buyers_usd = 0
      sellers_usd = 0
    }

    const net = buyers_usd - sellers_usd

    if (net <= 0 || net <= NET_FLOW_MIN_USD) {
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "net non-positive or below threshold",
          net,
          threshold: NET_FLOW_MIN_USD,
          buyers_usd,
          sellers_usd,
        }),
      )
    }

    if (Date.now() - lastSellAt < COOLDOWN_MS) {
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "cooldown",
          net,
          cooldownRemaining: Math.ceil((COOLDOWN_MS - (Date.now() - lastSellAt)) / 1000),
        }),
      )
    }

    const sellUsd = net * NET_FRACTION
    const sellAmountTokens = await tokensFromUsd(sellUsd, mintAddress)

    if (sellAmountTokens <= BigInt(0)) {
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "sell amount = 0",
          net,
          sellUsd,
        }),
      )
    }

    const payload = {
      action: "SELL",
      mint: mintAddress,
      privateKeys,
      percentage: 25, // 25% of token balance
      slippageBps: 2000,
      reason: "netflow",
      net_usd: net,
      sell_usd: sellUsd,
    }

    const execRes = await sendToExecutor(payload)

    if (!execRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Executor failed",
          details: execRes.data,
        }),
        { status: 500 },
      )
    }

    lastSellAt = Date.now()

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "netflow",
        net,
        buyers_usd,
        sellers_usd,
        sell_usd: sellUsd,
        sellAmountTokens: sellAmountTokens.toString(),
        sellResult: execRes.data,
        message: `Auto-sell executed: 25% of $${net.toFixed(2)} net volume = $${sellUsd.toFixed(2)} worth of tokens sold`,
      }),
    )
  } catch (error) {
    console.error("Auto-sell tick error:", error)
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 },
    )
  }
}

// Export function to read last push data
export function readLastPush() {
  return lastPush
}

// Export function to set push data (for ingest-trade to use)
export function setLastPush(data: { buyers_usd: number; sellers_usd: number; at: number; window_seconds: number }) {
  lastPush = data
}
