export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"
import { getRedis } from "@/lib/redis"

const FEED = (m: string) => `trades:${m}`
const MAX_ITEMS = 2000

type HeliusTx = {
  signature: string
  timestamp: number // seconds
  tokenTransfers?: Array<{
    tokenAddress: string // mint
    fromUserAccount: string | null
    toUserAccount: string | null
    tokenAmount: number // ui amount
  }>
}

type Trade = {
  sig: string
  ts: number // ms
  side: "buy" | "sell"
  tokenAmount: number
  usd: number
  wallet?: string
  mint: string
}

async function getUsdPriceForMint(mint: string): Promise<number> {
  try {
    const r = await fetch(`https://price.jup.ag/v6/price?ids=${mint}`, { cache: "no-store" })
    const j = (await r.json()) as any
    return Number(j?.data?.[mint]?.price ?? 0)
  } catch {
    return 0
  }
}

async function updateAutoSellState(tradeData: Trade, mintAddress: string) {
  if (!global.autoSellState?.isRunning || mintAddress !== process.env.TOKEN_MINT?.trim()) {
    return
  }

  const now = Date.now()
  if (now < global.autoSellState.firstAnalysisTime) {
    return
  }

  if (tradeData.side === "buy") {
    global.autoSellState.metrics.buyVolumeUsd += tradeData.usd
  } else {
    global.autoSellState.metrics.sellVolumeUsd += tradeData.usd
  }

  global.autoSellState.metrics.netUsdFlow =
    global.autoSellState.metrics.buyVolumeUsd - global.autoSellState.metrics.sellVolumeUsd

  if (tradeData.usd > 0) {
    global.autoSellState.metrics.currentPrice = tradeData.usd / tradeData.tokenAmount
    global.autoSellState.metrics.currentPriceUsd = tradeData.usd / tradeData.tokenAmount
  }

  if (global.autoSellState.metrics.netUsdFlow > 0 && global.autoSellState.metrics.buyVolumeUsd > 0) {
    const sellAmountUsd = global.autoSellState.metrics.netUsdFlow * 0.25
    await executeAutoSell(sellAmountUsd)
  }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-webhook-secret") !== process.env.HELIUS_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rows: HeliusTx[] = Array.isArray(body) ? body : body?.events || body?.data || []
  if (!Array.isArray(rows)) return NextResponse.json({ ok: true, received: 0 })

  const redis = getRedis()
  const perMint: Record<string, Trade[]> = {}

  for (const tx of rows) {
    const arr = tx.tokenTransfers?.filter((t) => t.tokenAmount !== 0) ?? []
    if (!arr.length) continue

    const groups = new Map<string, typeof arr>()
    for (const t of arr) {
      const g = groups.get(t.tokenAddress) || []
      g.push(t)
      groups.set(t.tokenAddress, g)
    }

    for (const [mintAddress, transfers] of groups) {
      const primary = [...transfers].sort((a, b) => b.tokenAmount - a.tokenAmount)[0]
      const tokenAmount = Math.abs(primary.tokenAmount)

      const looksUser = (s?: string | null) => !!(s && !s.endsWith("11111111111111111111111111111111"))
      const side: "buy" | "sell" = looksUser(primary.toUserAccount) ? "buy" : "sell"

      const usdPrice = await getUsdPriceForMint(mintAddress)

      const tradeRecord: Trade = {
        sig: tx.signature,
        ts: (tx.timestamp || Math.floor(Date.now() / 1000)) * 1000,
        side,
        tokenAmount,
        usd: tokenAmount * usdPrice,
        wallet: primary.toUserAccount ?? undefined,
        mint: mintAddress,
      }

      if (!perMint[mintAddress]) {
        perMint[mintAddress] = []
      }
      perMint[mintAddress].push(tradeRecord)

      await updateAutoSellState(tradeRecord, mintAddress)
    }
  }

  if (redis) {
    for (const [mintAddr, tradesList] of Object.entries(perMint)) {
      const key = FEED(mintAddr)
      await redis.lpush(key, ...tradesList.map((tradeItem) => JSON.stringify(tradeItem)))
      await redis.ltrim(key, 0, MAX_ITEMS - 1)
    }
  }

  const total = Object.values(perMint).reduce((sum, tradesArray) => sum + tradesArray.length, 0)
  return NextResponse.json({ ok: true, parsed: total, mints: Object.keys(perMint).length })
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
