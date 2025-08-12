import type { NextRequest } from "next/server"
import { Keypair } from "@solana/web3.js"
import { Connection, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { z } from "zod"

const TradeSchema = z.object({
  ts: z.number(),
  side: z.enum(["buy", "sell"]),
  usd: z.number().nonnegative(),
})

const BodySchema = z.object({
  trades: z.array(TradeSchema).optional(),
  mint: z.string().optional(),
  privateKeys: z.array(z.string()).optional(),
  percentage: z.number().optional(),
  slippageBps: z.number().optional(),
  mode: z.enum(["netflow", "perbuy", "volume"]).optional(),
  delayMinutes: z.number().optional(), // Added delayMinutes parameter
})

// In-memory state for volume tracking
let lastPush: { buyers_usd: number; sellers_usd: number; at: number; window_seconds: number } | null = null
let lastSellAt = 0

const NET_FRACTION = 0.25 // 25% of net volume
const WINDOW_SECONDS = 120 // 2 minutes
const COOLDOWN_MS = 0 // No cooldown by default

const delayedAutoSellTasks = new Map<string, NodeJS.Timeout>()

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
  // For now, use the existing sell handler as executor
  // In production, this would call an external service
  const { POST: sellHandler } = await import("../sell/route")

  const mockRequest = {
    json: async () => ({
      mint: payload.mint,
      privateKeys: payload.privateKeys,
      percentage: payload.percentage || 25,
      slippageBps: payload.slippageBps || 2000,
    }),
  } as any

  const response = await sellHandler(mockRequest)
  const result = await response.json()

  return {
    ok: response.ok,
    status: response.status,
    data: result,
  }
}

async function analyzeTransactionVolume(
  connection: Connection,
  signature: string,
  mint: string,
): Promise<{ isBuy: boolean; solAmount: number } | null> {
  try {
    const tx = (await Promise.race([
      connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction timeout")), 1500)),
    ])) as any

    if (!tx?.meta || tx.meta.err) return null

    const mintPubkey = new PublicKey(mint)
    let netSolChange = 0
    let tokenChange = 0
    let hasTokenActivity = false

    const preBalances = tx.meta.preBalances
    const postBalances = tx.meta.postBalances
    const accountKeys = tx.transaction.message.accountKeys

    for (let i = 0; i < preBalances.length; i++) {
      const account = accountKeys[i]
      if (account && !account.toString().includes("11111111111111111111111111111111")) {
        const solChange = (postBalances[i] - preBalances[i]) / 1e9
        netSolChange += Math.abs(solChange)
      }
    }

    if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
      for (const preToken of tx.meta.preTokenBalances) {
        if (preToken.mint === mint) {
          hasTokenActivity = true
          const postToken = tx.meta.postTokenBalances.find((post) => post.accountIndex === preToken.accountIndex)
          if (postToken) {
            const preAmount = preToken.uiTokenAmount?.uiAmount || 0
            const postAmount = postToken.uiTokenAmount?.uiAmount || 0
            tokenChange += postAmount - preAmount
          }
        }
      }

      for (const postToken of tx.meta.postTokenBalances) {
        if (postToken.mint === mint) {
          const preToken = tx.meta.preTokenBalances.find((pre) => pre.accountIndex === postToken.accountIndex)
          if (!preToken) {
            hasTokenActivity = true
            tokenChange += postToken.uiTokenAmount?.uiAmount || 0
          }
        }
      }
    }

    if (!hasTokenActivity || Math.abs(tokenChange) < 0.000001) {
      return null
    }

    const isBuy = tokenChange > 0
    const solAmount = netSolChange

    if (solAmount < 0.001) {
      return null
    }

    console.log(
      `📊 Transaction ${signature.slice(0, 8)}...: ${isBuy ? "BUY" : "SELL"} ${solAmount.toFixed(4)} SOL, Token change: ${tokenChange.toFixed(6)}`,
    )

    return { isBuy, solAmount }
  } catch (error) {
    return null
  }
}

interface AutoSellConfig {
  mint: string
  wallets: Keypair[]
  percentage: number
  slippageBps: number
  delayMinutes?: number
}

async function startVolumeBasedAutoSell(
  mint: string,
  wallets: Keypair[],
  percentage: number,
  slippageBps: number,
  delayMinutes?: number,
) {
  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  )

  console.log(`🎯 Starting auto-sell monitoring for ${mint}`)
  console.log(`   Wallets: ${wallets.length}`)
  console.log(`   Sell percentage: ${percentage}%`)
  if (delayMinutes) {
    console.log(`   Delay after buy detection: ${delayMinutes} minutes`)
  }

  try {
    const result = await Promise.race([
      (async () => {
        const volumeData = await quickVolumeCheck(connection, mint)

        if (volumeData.buyVolume > volumeData.sellVolume) {
          const volumeDifference = volumeData.buyVolume - volumeData.sellVolume

          console.log(`🚀 Buy volume exceeds sell volume by ${volumeDifference.toFixed(4)} SOL`)

          if (delayMinutes && delayMinutes > 0) {
            const delayMs = delayMinutes * 60 * 1000
            const taskKey = `${mint}-${Date.now()}`

            console.log(`⏰ Scheduling auto-sell in ${delayMinutes} minutes...`)

            // Clear any existing delayed task for this mint
            const existingTaskKey = Array.from(delayedAutoSellTasks.keys()).find((key) => key.startsWith(mint))
            if (existingTaskKey) {
              clearTimeout(delayedAutoSellTasks.get(existingTaskKey)!)
              delayedAutoSellTasks.delete(existingTaskKey)
              console.log(`🔄 Replaced existing delayed auto-sell for ${mint}`)
            }

            const timeoutId = setTimeout(async () => {
              console.log(`⏰ Executing delayed auto-sell for ${mint} after ${delayMinutes} minutes`)
              const sellResult = await executeAutoSell(mint, wallets, percentage, slippageBps, volumeDifference)
              delayedAutoSellTasks.delete(taskKey)
              console.log(`✅ Delayed auto-sell completed for ${mint}:`, sellResult)
            }, delayMs)

            delayedAutoSellTasks.set(taskKey, timeoutId)

            return {
              success: true,
              action: "sell_scheduled",
              volumeData,
              netBuyVolume: volumeDifference,
              delayMinutes,
              scheduledAt: new Date().toISOString(),
              executeAt: new Date(Date.now() + delayMs).toISOString(),
              message: `Auto-sell scheduled: ${percentage}% of tokens will be sold in ${delayMinutes} minutes`,
            }
          } else {
            // Immediate execution (existing behavior)
            const sellResult = await executeAutoSell(mint, wallets, percentage, slippageBps, volumeDifference)
            return {
              success: true,
              action: "sell_executed",
              volumeData,
              sellResult,
              netBuyVolume: volumeDifference,
              message: `Auto-sell executed: ${percentage}% of tokens sold`,
            }
          }
        } else {
          return {
            success: true,
            action: "no_sell",
            volumeData,
            message: `No auto-sell: insufficient buy volume`,
          }
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auto-sell timeout after 8 seconds")), 8000)),
    ])

    return result
  } catch (error) {
    console.error("❌ Auto-sell error:", error)
    return {
      success: false,
      error: error.message,
      message: "Auto-sell failed",
    }
  }
}

async function quickVolumeCheck(connection: Connection, mint: string): Promise<VolumeData> {
  console.log(`⚡ Quick volume check for ${mint}`)

  const volumeData: VolumeData = {
    buyVolume: 0,
    sellVolume: 0,
    transactions: [],
  }

  try {
    const signatures = (await Promise.race([
      connection.getSignaturesForAddress(new PublicKey(mint), { limit: 10 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Quick check timeout")), 2000)),
    ])) as any[]

    const recentSigs = signatures.slice(0, 5)

    for (const sigInfo of recentSigs) {
      const analysis = await analyzeTransactionVolume(connection, sigInfo.signature, mint)
      if (analysis) {
        volumeData.transactions.push(sigInfo.signature)

        if (analysis.isBuy) {
          volumeData.buyVolume += analysis.solAmount
        } else {
          volumeData.sellVolume += analysis.solAmount
        }
      }
    }

    console.log(
      `📊 Quick check: Buy ${volumeData.buyVolume.toFixed(4)} SOL, Sell ${volumeData.sellVolume.toFixed(4)} SOL`,
    )
  } catch (error) {
    console.error("Quick volume check error:", error)
  }

  return volumeData
}

async function executeAutoSell(
  mint: string,
  wallets: Keypair[],
  percentage: number,
  slippageBps: number,
  netBuyVolumeSOL: number,
) {
  console.log(`🤖 Auto-sell triggered for ${mint} with ${wallets.length} wallets`)
  console.log(`   Net buy volume detected: ${netBuyVolumeSOL.toFixed(4)} SOL`)
  console.log(`   Auto-sell percentage: ${percentage}%`)
  console.log(`   Selling ${percentage}% of token balance from each wallet`)

  try {
    const privateKeys = wallets.map((w) => bs58.encode(w.secretKey))

    const requestBody = {
      mint,
      privateKeys,
      percentage,
      slippageBps,
      limitWallets: Math.min(wallets.length, 10),
    }

    console.log(`🔗 Calling sell handler for ${mint} to sell ${percentage}% of tokens`)

    const response = (await Promise.race([
      (async () => {
        const { POST: sellHandler } = await import("../sell/route")

        // Create a proper mock NextRequest
        const mockRequest = new Request("http://localhost/api/sell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }) as NextRequest

        return sellHandler(mockRequest)
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auto-sell timeout")), 20000)),
    ])) as Response

    const result = await response.json()

    if (!response.ok) {
      throw new Error(`Sell handler failed: ${response.status} - ${JSON.stringify(result)}`)
    }

    console.log(`✅ Auto-sell completed:`, result)
    return result
  } catch (error) {
    console.error(`❌ Auto-sell failed:`, error)
    return { error: error.message }
  }
}

interface VolumeData {
  buyVolume: number
  sellVolume: number
  transactions: string[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      mint,
      privateKeys,
      percentage = 25,
      slippageBps = 2000,
      mode = "volume",
      trades,
      delayMinutes, // Added delayMinutes parameter
    } = body

    console.log(`🤖 Auto-sell request: ${mode} mode for ${mint}`)
    if (delayMinutes) {
      console.log(`   Delay setting: ${delayMinutes} minutes`)
    }

    // Handle volume-based auto-sell with delay support
    if (mode === "volume" && mint && privateKeys) {
      const wallets: Keypair[] = []
      for (const pk of privateKeys) {
        try {
          const secretKey = bs58.decode(pk)
          const keypair = Keypair.fromSecretKey(secretKey)
          wallets.push(keypair)
        } catch (error) {
          console.error("Invalid private key:", error)
          continue
        }
      }

      if (wallets.length === 0) {
        return Response.json({ error: "No valid wallets provided" }, { status: 400 })
      }

      const result = await startVolumeBasedAutoSell(mint, wallets, percentage, slippageBps, delayMinutes)

      return Response.json({
        success: true,
        monitoring_started: true,
        result,
        message: result.message,
      })
    }

    // Handle trade ingestion for volume tracking
    if (trades && trades.length > 0) {
      let buyers = 0,
        sellers = 0
      const now = Date.now()

      for (const trade of trades) {
        if (now - trade.ts > WINDOW_SECONDS * 1000) continue
        if (trade.side === "buy") buyers += trade.usd
        else sellers += trade.usd
      }

      lastPush = { buyers_usd: buyers, sellers_usd: sellers, at: now, window_seconds: WINDOW_SECONDS }

      // Immediate sell on each buy (perbuy mode)
      if (mode === "perbuy" && mint && privateKeys) {
        for (const trade of trades) {
          if (trade.side !== "buy" || trade.usd <= 0) continue
          if (Date.now() - lastSellAt < COOLDOWN_MS) continue

          const sellTokens = await tokensFromUsd(trade.usd * NET_FRACTION, mint)
          if (sellTokens <= BigInt(0)) continue

          const payload = {
            mint,
            privateKeys,
            percentage: 25, // 25% of token balance
            slippageBps,
            reason: "perbuy",
            buy_usd: trade.usd,
          }

          const execRes = await sendToExecutor(payload)
          if (execRes.ok) {
            lastSellAt = Date.now()
            console.log(`✅ Perbuy sell executed for $${trade.usd} buy`)
          }
        }
      }

      return Response.json({
        success: true,
        mode,
        buyers_usd: buyers,
        sellers_usd: sellers,
        message: `Processed ${trades.length} trades in ${mode} mode`,
      })
    }

    // Handle netflow mode auto-sell
    if (mode === "netflow" && mint && privateKeys) {
      const pushed = lastPush
      let buyers_usd = 0,
        sellers_usd = 0

      if (pushed && Date.now() - pushed.at <= pushed.window_seconds * 1000 + 2000) {
        buyers_usd = pushed.buyers_usd
        sellers_usd = pushed.sellers_usd
      }

      const net = buyers_usd - sellers_usd

      if (net <= 0) {
        return Response.json({
          success: true,
          action: "no_sell",
          reason: "net non-positive",
          net,
          buyers_usd,
          sellers_usd,
        })
      }

      if (Date.now() - lastSellAt < COOLDOWN_MS) {
        return Response.json({
          success: true,
          action: "no_sell",
          reason: "cooldown",
          net,
        })
      }

      // Calculate sell amount as 25% of net positive volume
      const sellUsd = net * NET_FRACTION
      const sellTokens = await tokensFromUsd(sellUsd, mint)

      if (sellTokens <= BigInt(0)) {
        return Response.json({
          success: true,
          action: "no_sell",
          reason: "sell amount too small",
          net,
        })
      }

      const payload = {
        mint,
        privateKeys,
        percentage: 25, // 25% of token balance
        slippageBps,
        reason: "netflow",
        net_usd: net,
        sell_usd: sellUsd,
      }

      const execRes = await sendToExecutor(payload)

      if (!execRes.ok) {
        return Response.json(
          {
            success: false,
            error: "Executor failed",
            details: execRes.data,
          },
          { status: 500 },
        )
      }

      lastSellAt = Date.now()

      return Response.json({
        success: true,
        action: "sell_executed",
        mode: "netflow",
        net_usd: net,
        sell_usd: sellUsd,
        buyers_usd,
        sellers_usd,
        result: execRes.data,
        message: `Auto-sell executed: 25% of $${net.toFixed(2)} net volume = $${sellUsd.toFixed(2)} worth of tokens sold`,
      })
    }

    // Fallback to original volume monitoring if no trades provided
    if (!trades && mint && privateKeys) {
      const wallets: Keypair[] = []
      for (const pk of privateKeys) {
        try {
          const secretKey = bs58.decode(pk)
          const keypair = Keypair.fromSecretKey(secretKey)
          wallets.push(keypair)
        } catch (error) {
          console.error("Invalid private key:", error)
          continue
        }
      }

      if (wallets.length === 0) {
        return Response.json({ error: "No valid wallets provided" }, { status: 400 })
      }

      return await startVolumeBasedAutoSell(mint, wallets, percentage, slippageBps)
    }

    return Response.json(
      { error: "Invalid request: provide trades for ingestion or mint+privateKeys for monitoring" },
      { status: 400 },
    )
  } catch (error) {
    console.error("Auto-sell API error:", error)
    return Response.json(
      {
        success: false,
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    )
  }
}
