import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? "120")
const WINDOW_MS = WINDOW_SECONDS * 1000

const KEYS = {
  QUEUE: "autosell:q",
  BUYERS_SUM: "autosell:buyers",
  SELLERS_SUM: "autosell:sellers",
  LAST_SELL_AT: "autosell:lastSellAt",
}

export async function pushTrade(t: { ts: number; side: "buy" | "sell"; usd: number }) {
  await redis.rpush(KEYS.QUEUE, JSON.stringify(t))
  await evictOld()
  if (t.side === "buy") await redis.incrbyfloat(KEYS.BUYERS_SUM, t.usd)
  else await redis.incrbyfloat(KEYS.SELLERS_SUM, t.usd)
}

export async function evictOld() {
  const now = Date.now()
  const items = await redis.lrange<string>(KEYS.QUEUE, 0, -1)
  let buyers = 0,
    sellers = 0
  const fresh: string[] = []

  for (const s of items) {
    try {
      const t = JSON.parse(s) as { ts: number; side: "buy" | "sell"; usd: number }
      if (now - t.ts <= WINDOW_MS) {
        fresh.push(s)
        if (t.side === "buy") buyers += t.usd
        else sellers += t.usd
      }
    } catch {}
  }

  await redis.del(KEYS.QUEUE)
  if (fresh.length) await redis.rpush(KEYS.QUEUE, ...fresh)
  await redis.set(KEYS.BUYERS_SUM, buyers)
  await redis.set(KEYS.SELLERS_SUM, sellers)
}

export async function getWindow() {
  const [buyers, sellers, lastSellAt] = await redis.mget<number[]>(KEYS.BUYERS_SUM, KEYS.SELLERS_SUM, KEYS.LAST_SELL_AT)
  return {
    buyers_usd: Number(buyers ?? 0),
    sellers_usd: Number(sellers ?? 0),
    lastSellAt: Number(lastSellAt ?? 0),
    window_seconds: WINDOW_SECONDS,
  }
}

export async function setLastSellAt(ts: number) {
  await redis.set(KEYS.LAST_SELL_AT, ts)
}
