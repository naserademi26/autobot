import { getWindowSumsUSD } from "../lib/helius-netflow"
import { readLastPush } from "./ingest-trade"

export const config = { runtime: "nodejs" }

export default async function handler(req: Request) {
  try {
    const mintAddress = process.env.AUTO_SELL_MINT
    const privateKeys = process.env.AUTO_SELL_WALLETS?.split(",") || []
    const triggerMode = (process.env.TRIGGER_MODE || "netflow").toLowerCase()

    const pushed = readLastPush()
    let buyers_usd = 0
    let sellers_usd = 0
    let source = "helius"

    if (pushed && Date.now() - pushed.at <= pushed.window_seconds * 1000 + 2000) {
      buyers_usd = pushed.buyers_usd
      sellers_usd = pushed.sellers_usd
      source = "push"
    } else if (mintAddress) {
      const sums = await getWindowSumsUSD(mintAddress)
      buyers_usd = sums.buyers_usd
      sellers_usd = sums.sellers_usd
    }

    const res = {
      now: new Date().toISOString(),
      mode: triggerMode,
      window_seconds: Number(process.env.WINDOW_SECONDS ?? "120"),
      buyers_usd,
      sellers_usd,
      net_usd: buyers_usd - sellers_usd,
      source,
      config: {
        net_fraction: Number(process.env.NET_FRACTION ?? "0.25"),
        cooldown_seconds: Number(process.env.COOLDOWN_SECONDS ?? "0"),
        min_net_usd: Number(process.env.NET_FLOW_MIN_USD ?? "0"),
        trigger_mode: triggerMode,
        mint_address: mintAddress || null,
        wallets_count: privateKeys.length,
        helius_configured: !!process.env.HELIUS_RPC_URL || !!process.env.RPC_URL,
        jupiter_configured: !!process.env.JUPITER_API_KEY || !!process.env.NEXT_PUBLIC_JUPITER_API_KEY,
      },
    }

    return new Response(JSON.stringify(res), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 },
    )
  }
}
