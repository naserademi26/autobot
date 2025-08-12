import { getWindowSumsUSD } from "../lib/helius-netflow"
import { computeSellAmountTokensFromNetUsd } from "../lib/jupiter-price"
// Fixed import path from ./sell/route to ../sell/route
import { POST as sellHandler } from "../sell/route"

const TRIGGER_MODE = (process.env.TRIGGER_MODE || "netflow").toLowerCase()
const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS ?? "0") // Default 0 for faster execution
const COOLDOWN_MS = COOLDOWN_SECONDS * 1000
const NET_FLOW_MIN_USD = Number(process.env.NET_FLOW_MIN_USD ?? "0") // Default 0 to trigger on any positive flow
const NET_FRACTION = Number(process.env.NET_FRACTION ?? "0.25") // 25%

let lastSellAt = 0 // in-memory cooldown tracking

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

    // Get buy/sell volume from Helius
    const { buyers_usd, sellers_usd } = await getWindowSumsUSD(mintAddress)
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

    // Calculate sell amount in tokens (25% of net USD volume)
    const sellAmountTokens = await computeSellAmountTokensFromNetUsd(mintAddress, net)

    // Changed 0n to BigInt(0) for ES2019 compatibility
    if (sellAmountTokens <= BigInt(0)) {
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "sell amount = 0",
          net,
        }),
      )
    }

    // Convert token amount to percentage of wallet balance for sell handler
    const sellPercentage = Math.min(NET_FRACTION * 100, 100) // Use configured fraction as percentage

    // Execute sell via existing sell handler
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
    const sellResult = await sellResponse.json()

    lastSellAt = Date.now()

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "netflow",
        net,
        buyers_usd,
        sellers_usd,
        sellPercentage,
        sellAmountTokens: sellAmountTokens.toString(),
        sellResult,
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
