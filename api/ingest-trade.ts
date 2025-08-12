import { z } from "zod"
import { POST as sellHandler } from "../sell/route"

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

let lastPush: {
  buyers_usd: number
  sellers_usd: number
  at: number
  window_seconds: number
} | null = null

let lastSellAt = 0
const COOLDOWN_MS = Number(process.env.COOLDOWN_SECONDS ?? "0") * 1000
const TRIGGER_MODE = (process.env.TRIGGER_MODE || "netflow").toLowerCase()
const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25")

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
      lastPush = {
        buyers_usd: w.buyers_usd,
        sellers_usd: w.sellers_usd,
        at: Date.now(),
        window_seconds: w.window_seconds ?? Number(process.env.WINDOW_SECONDS || 120),
      }
    }

    // Handle individual trades (perbuy mode)
    if (w.trades && TRIGGER_MODE === "perbuy") {
      const mintAddress = process.env.AUTO_SELL_MINT
      const privateKeys = process.env.AUTO_SELL_WALLETS?.split(",") || []

      if (mintAddress && privateKeys.length) {
        for (const trade of w.trades) {
          if (trade.side !== "buy" || trade.usd <= 0) continue
          if (Date.now() - lastSellAt < COOLDOWN_MS) continue

          // Calculate sell percentage based on buy amount
          const sellPercentage = Math.min(NET_FRACTION * 100, 100)

          // Execute immediate sell
          const sellRequest = new Request("http://localhost:3000/api/sell", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mint: mintAddress,
              privateKeys,
              percentage: sellPercentage,
              slippageBps: 2000, // 20% slippage for auto-sell
            }),
          })

          const sellResponse = await sellHandler(sellRequest)
          if (sellResponse.ok) {
            lastSellAt = Date.now()
          }
        }
      }

      // Also aggregate for status reporting
      let buyers = 0,
        sellers = 0
      const now = Date.now()
      const windowMs = Number(process.env.WINDOW_SECONDS || 120) * 1000

      for (const trade of w.trades) {
        if (now - trade.ts > windowMs) continue
        if (trade.side === "buy") buyers += trade.usd
        else sellers += trade.usd
      }

      lastPush = {
        buyers_usd: buyers,
        sellers_usd: sellers,
        at: now,
        window_seconds: Number(process.env.WINDOW_SECONDS || 120),
      }
    }

    return new Response(JSON.stringify({ ok: true, mode: TRIGGER_MODE }))
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 },
    )
  }
}

export function readLastPush() {
  return lastPush
}
