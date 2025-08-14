export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"

type HeliusTx = {
  signature: string
  timestamp: number
  tokenTransfers?: Array<{
    tokenAddress: string
    fromUserAccount: string | null
    toUserAccount: string | null
    tokenAmount: number
    mint?: string
  }>
}

type Trade = {
  sig: string
  ts: number
  side: "buy" | "sell"
  tokenAmount: number
  usd: number
  wallet?: string
}

let redis: any = null
async function getRedis() {
  if (!redis) {
    try {
      const { Redis } = await import("@upstash/redis")
      redis = Redis.fromEnv()
    } catch (error) {
      console.warn("Redis not available:", error)
      return null
    }
  }
  return redis
}

async function getSolUsd(): Promise<number> {
  try {
    const response = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111112")
    const data = await response.json()
    return Number.parseFloat(data.pairs?.[0]?.priceUsd || "0")
  } catch {
    return 0
  }
}

async function getTokenPrice(mint: string): Promise<number> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
    const data = await response.json()
    return Number.parseFloat(data.pairs?.[0]?.priceUsd || "0")
  } catch {
    return 0
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.HELIUS_WEBHOOK_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const body = await req.json()
  const mint = process.env.TOKEN_MINT?.trim()
  if (!mint) return NextResponse.json({ ok: false, error: "TOKEN_MINT missing" }, { status: 400 })

  const arr: HeliusTx[] = Array.isArray(body) ? body : body?.events || body?.data || []
  if (!Array.isArray(arr)) return NextResponse.json({ ok: true, received: 0 })

  const tokenPrice = await getTokenPrice(mint)
  const trades: Trade[] = []
  const redisClient = await getRedis()

  for (const tx of arr) {
    const tokenTransfers =
      tx.tokenTransfers?.filter((t) => (t.tokenAddress === mint || t.mint === mint) && t.tokenAmount !== 0) || []

    if (!tokenTransfers.length) continue

    const primary = tokenTransfers.sort((a, b) => b.tokenAmount - a.tokenAmount)[0]
    const tokenAmount = Math.abs(primary.tokenAmount)

    const to = primary.toUserAccount || ""
    const from = primary.fromUserAccount || ""
    const looksLikeUser = (s: string) => s && !s.includes("11111111111111111111111111111111")
    const side: "buy" | "sell" = looksLikeUser(to) ? "buy" : "sell"

    const usd = tokenAmount * tokenPrice

    const trade: Trade = {
      sig: tx.signature,
      ts: (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000,
      side,
      tokenAmount,
      usd,
      wallet: looksLikeUser(to) ? to : from,
    }

    trades.push(trade)

    if (redisClient && usd > 0) {
      try {
        await redisClient.lpush(`trades:${mint}`, JSON.stringify(trade))
        await redisClient.ltrim(`trades:${mint}`, 0, 199) // Keep last 200 trades
      } catch (error) {
        console.warn("Redis storage failed:", error)
      }
    }

    if (global.autoSellState?.isRunning) {
      const now = Date.now()
      if (now >= global.autoSellState.firstAnalysisTime) {
        if (side === "buy") {
          global.autoSellState.metrics.buyVolumeUsd += usd
        } else {
          global.autoSellState.metrics.sellVolumeUsd += usd
        }

        global.autoSellState.metrics.netUsdFlow =
          global.autoSellState.metrics.buyVolumeUsd - global.autoSellState.metrics.sellVolumeUsd

        if (tokenPrice > 0) {
          global.autoSellState.metrics.currentPrice = tokenPrice
        }

        if (global.autoSellState.metrics.netUsdFlow > 0 && global.autoSellState.metrics.buyVolumeUsd > 0) {
          const sellAmountUsd = global.autoSellState.metrics.netUsdFlow * 0.25
          executeAutoSell(sellAmountUsd)
        }
      }
    }
  }

  console.log(`Processed ${trades.length} trades, total received: ${arr.length}`)
  return NextResponse.json({ ok: true, received: arr.length, parsed: trades.length })
}

async function executeAutoSell(sellAmountUsd: number) {
  try {
    if (!global.autoSellState?.wallets?.length) return

    const totalTokenBalance = global.autoSellState.wallets.reduce((sum, wallet) => sum + (wallet.tokenBalance || 0), 0)

    if (totalTokenBalance === 0) return

    const tokenPrice = global.autoSellState.metrics.currentPrice || 0
    if (tokenPrice === 0) return

    const tokensToSell = sellAmountUsd / tokenPrice

    for (const wallet of global.autoSellState.wallets) {
      if (!wallet.tokenBalance || wallet.tokenBalance === 0) continue

      const walletPortion = wallet.tokenBalance / totalTokenBalance
      const walletTokensToSell = tokensToSell * walletPortion

      if (walletTokensToSell > 0) {
        await executeSellForWallet(wallet, walletTokensToSell, sellAmountUsd * walletPortion)
      }
    }

    global.autoSellState.metrics.lastSellTime = Date.now()
    global.autoSellState.metrics.totalSold += sellAmountUsd
  } catch (error) {
    console.error("Auto-sell execution error:", error)
  }
}

async function executeSellForWallet(wallet: any, tokenAmount: number, usdAmount: number) {
  try {
    console.log(`Executing sell: ${tokenAmount} tokens (~$${usdAmount.toFixed(2)}) from wallet ${wallet.address}`)

    wallet.tokenBalance = Math.max(0, wallet.tokenBalance - tokenAmount)

    if (!global.autoSellState.transactionHistory) {
      global.autoSellState.transactionHistory = []
    }

    global.autoSellState.transactionHistory.unshift({
      timestamp: Date.now(),
      wallet: wallet.address,
      tokenAmount,
      usdAmount,
      signature: `sell_${Date.now()}`,
      type: "sell",
    })
  } catch (error) {
    console.error(`Sell execution failed for wallet ${wallet.address}:`, error)
  }
}
