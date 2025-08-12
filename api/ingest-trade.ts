import { z } from "zod"
import { setLastPush } from "./auto-sell-tick"

const TradeSchema = z.object({
  ts: z.number(),
  side: z.enum(["buy", "sell"]),
  usd: z.number().nonnegative(),
})

const IngestBodySchema = z.object({
  trades: z.array(TradeSchema).optional(),
  buyers_usd: z.number().nonnegative().optional(),
  sellers_usd: z.number().nonnegative().optional(),
  window_seconds: z.number().optional(),
})

let lastSellAt = 0
const COOLDOWN_MS = Number(process.env.COOLDOWN_SECONDS ?? "0") * 1000
const TRIGGER_MODE = (process.env.TRIGGER_MODE || "netflow").toLowerCase()
const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25")
const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? "120")

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

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  try {
    const data = await req.json()
    const parsed = IngestBodySchema.safeParse(data)

    if (!parsed.success) {
      return new Response("Bad Request", { status: 400 })
    }

    const w = parsed.data

    // Handle aggregated data (netflow mode)
    if (w.buyers_usd !== undefined && w.sellers_usd !== undefined) {
      const pushData = {
        buyers_usd: w.buyers_usd,
        sellers_usd: w.sellers_usd,
        at: Date.now(),
        window_seconds: w.window_seconds ?? WINDOW_SECONDS,
      }

      setLastPush(pushData)
    }

    // Handle individual trades (perbuy mode)
    if (w.trades && TRIGGER_MODE === "perbuy") {
      const mintAddress = process.env.AUTO_SELL_MINT
      const privateKeys = process.env.AUTO_SELL_WALLETS?.split(",") || []

      if (mintAddress && privateKeys.length) {
        for (const trade of w.trades) {
          if (trade.side !== "buy" || trade.usd <= 0) continue
          if (Date.now() - lastSellAt < COOLDOWN_MS) continue

          const sellUsd = trade.usd * NET_FRACTION
          const sellTokens = await tokensFromUsd(sellUsd, mintAddress)

          if (sellTokens <= BigInt(0)) continue

          const payload = {
            action: "SELL",
            mint: mintAddress,
            privateKeys,
            percentage: 25, // 25% of token balance
            slippageBps: 2000,
            reason: "perbuy",
            buy_usd: trade.usd,
            sell_usd: sellUsd,
          }

          const execRes = await sendToExecutor(payload)
          if (execRes.ok) {
            lastSellAt = Date.now()
            console.log(`✅ Perbuy sell executed for $${trade.usd} buy -> $${sellUsd.toFixed(2)} sell`)
          }
        }
      }

      // Also aggregate for status reporting
      let buyers = 0,
        sellers = 0
      const now = Date.now()
      const windowMs = WINDOW_SECONDS * 1000

      for (const trade of w.trades) {
        if (now - trade.ts > windowMs) continue
        if (trade.side === "buy") buyers += trade.usd
        else sellers += trade.usd
      }

      setLastPush({
        buyers_usd: buyers,
        sellers_usd: sellers,
        at: now,
        window_seconds: WINDOW_SECONDS,
      })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode: TRIGGER_MODE,
        message: w.trades
          ? `Processed ${w.trades.length} trades in ${TRIGGER_MODE} mode`
          : `Updated volume data: $${w.buyers_usd || 0} buy, $${w.sellers_usd || 0} sell`,
      }),
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 },
    )
  }
}
