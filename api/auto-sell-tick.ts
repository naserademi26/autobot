import { readLastPush } from "./ingest-trade"

const NET_FLOW_MIN_USD = Number(process.env.NET_FLOW_MIN_USD ?? "0")
const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? "120")
const COOLDOWN_MS = Number(process.env.COOLDOWN_SECONDS ?? "0") * 1000
const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25")
const MINT_ADDRESS = process.env.AUTO_SELL_MINT || process.env.MINT_ADDRESS!

let lastSellAt = 0

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

async function computeSellAmountFromNetUsd(netUsd: number): Promise<bigint> {
  if (netUsd <= 0) return BigInt(0)
  const sellUsd = netUsd * NET_FRACTION // 25% of net_usd
  const usdcPerBase = await getUsdPerBaseUnit(MINT_ADDRESS)
  if (usdcPerBase <= 0) return BigInt(0)
  const baseUnits = Math.floor(sellUsd / usdcPerBase)
  return BigInt(baseUnits)
}

async function getWindowSumsUSD(mint: string): Promise<{ buyers_usd: number; sellers_usd: number }> {
  // TODO: Implement actual Helius enriched transaction parsing
  return { buyers_usd: 0, sellers_usd: 0 }
}

export const config = { runtime: "nodejs" }

export default async function handler(_req: Request) {
  const pushed = readLastPush()
  let buyers_usd = 0,
    sellers_usd = 0

  if (pushed && Date.now() - pushed.at <= pushed.window_seconds * 1000 + 2000) {
    buyers_usd = pushed.buyers_usd
    sellers_usd = pushed.sellers_usd
  } else {
    const sums = await getWindowSumsUSD(MINT_ADDRESS)
    buyers_usd = sums.buyers_usd
    sellers_usd = sums.sellers_usd
  }

  const net = buyers_usd - sellers_usd
  const cooldownLeftMs = Math.max(0, COOLDOWN_MS - (Date.now() - lastSellAt))

  const amountBaseUnits = net > 0 ? await computeSellAmountFromNetUsd(net) : BigInt(0)

  const decision = {
    mode: "netflow",
    window_seconds: WINDOW_SECONDS,
    buyers_usd,
    sellers_usd,
    net_usd: net,
    should_sell: net > NET_FLOW_MIN_USD && cooldownLeftMs === 0 && amountBaseUnits > BigInt(0),
    mint: MINT_ADDRESS,
    amount: amountBaseUnits.toString(), // token base units to sell
    cooldown_left_ms: cooldownLeftMs,
    sell_fraction: NET_FRACTION,
    sell_usd: net > 0 ? net * NET_FRACTION : 0,
  }

  if (decision.should_sell) lastSellAt = Date.now()

  return new Response(JSON.stringify(decision), {
    headers: { "Content-Type": "application/json" },
  })
}
