const JUP_BASE = process.env.JUPITER_API_BASE || "https://quote-api.jup.ag"
const QUOTE_MINT = process.env.QUOTE_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC mainnet

function jupHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY || process.env.NEXT_PUBLIC_JUPITER_API_KEY || process.env.JUP_API_KEY
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (key) {
    headers["X-API-KEY"] = key
  }
  return headers
}

export async function getUsdPrice(mintAddress: string): Promise<number> {
  try {
    const url = `${JUP_BASE}/v6/quote?inputMint=${mintAddress}&outputMint=${QUOTE_MINT}&amount=1000000&slippageBps=50`
    const res = await fetch(url, { cache: "no-store", headers: jupHeaders() })

    if (!res.ok) return 0

    const data = await res.json()
    const route = data?.data?.[0]
    if (!route) return 0

    const outAmount = Number(route.outAmount)
    const inAmount = Number(route.inAmount)
    if (!outAmount || !inAmount) return 0

    return outAmount / inAmount // USDC per base unit of token
  } catch (e) {
    console.error("Jupiter price fetch failed:", e)
    return 0
  }
}

export async function computeSellAmountTokensFromNetUsd(mintAddress: string, netUsd: number): Promise<bigint> {
  if (netUsd <= 0) return BigInt(0)

  const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25")
  const MAX_SELL_USD = Number(process.env.MAX_SELL_USD ?? "0") // Default to 0 (no limit) to avoid requiring MAX_SELL_USD env var

  const pricePerBaseUnit = await getUsdPrice(mintAddress)
  if (pricePerBaseUnit <= 0) return BigInt(0)

  let sellUsd = netUsd * NET_FRACTION
  if (MAX_SELL_USD > 0 && sellUsd > MAX_SELL_USD) sellUsd = MAX_SELL_USD

  const baseUnits = Math.floor(sellUsd / pricePerBaseUnit)
  return BigInt(baseUnits)
}
