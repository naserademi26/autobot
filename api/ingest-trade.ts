import { z } from "zod"

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

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "Auto-sell functionality has been removed",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    },
  )
}
