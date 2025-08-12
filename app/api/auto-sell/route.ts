import type { NextRequest } from "next/server"
import { Keypair } from "@solana/web3.js"
import { Connection, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { z } from "zod"
import WebSocket from "ws"

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
  mode: z.enum(["netflow", "perbuy"]).optional(),
})

let lastPush: { buyers_usd: number; sellers_usd: number; at: number; window_seconds: number } | null = null
let lastSellAt = 0

const NET_FRACTION = 0.25 // 25% of net volume
const WINDOW_SECONDS = 120 // 2 minutes
const COOLDOWN_MS = 0 // No cooldown by default

const BLOXROUTE_WS_URL = "wss://api.blxrbdn.com/ws"
const BLOXROUTE_API_KEY = process.env.BLOXROUTE_API_KEY || process.env.NEXT_PUBLIC_BLOXROUTE_API_KEY

const activeMonitoringSessions = new Map<
  string,
  {
    ws: WebSocket | null
    wallets: Keypair[]
    percentage: number
    slippageBps: number
    startTime: number
  }
>()

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
      new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction timeout")), 5000)),
    ])) as any

    if (!tx?.meta || tx.meta.err) return null

    const mintPubkey = new PublicKey(mint)
    const normalizedMint = mintPubkey.toString()

    const jupiterPrograms = [
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter V6
      "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", // Jupiter V4
      "JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph", // Jupiter V3
    ]

    let hasJupiterSwap = false
    let tokenAmountChange = 0
    let solAmountChange = 0

    if (tx.transaction?.message?.accountKeys) {
      for (const account of tx.transaction.message.accountKeys) {
        const accountStr = typeof account === "string" ? account : account.toString()
        if (jupiterPrograms.includes(accountStr)) {
          hasJupiterSwap = true
          break
        }
      }
    }

    if (!hasJupiterSwap && tx.transaction?.message?.instructions) {
      for (const instruction of tx.transaction.message.instructions) {
        if (instruction.programId) {
          const programIdStr =
            typeof instruction.programId === "string" ? instruction.programId : instruction.programId.toString()
          if (jupiterPrograms.includes(programIdStr)) {
            hasJupiterSwap = true
            break
          }
        }
      }
    }

    if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
      for (const postToken of tx.meta.postTokenBalances) {
        if (postToken.mint === normalizedMint || postToken.mint === mint) {
          const preToken = tx.meta.preTokenBalances.find((pre) => pre.accountIndex === postToken.accountIndex)

          const preAmount = preToken?.uiTokenAmount?.uiAmount || 0
          const postAmount = postToken.uiTokenAmount?.uiAmount || 0
          const change = postAmount - preAmount

          if (Math.abs(change) > 0.001) {
            tokenAmountChange += change
          }
        }
      }

      for (const postToken of tx.meta.postTokenBalances) {
        if (postToken.mint === normalizedMint || postToken.mint === mint) {
          const hasPreBalance = tx.meta.preTokenBalances.some((pre) => pre.accountIndex === postToken.accountIndex)
          if (!hasPreBalance && postToken.uiTokenAmount?.uiAmount > 0.001) {
            tokenAmountChange += postToken.uiTokenAmount.uiAmount
          }
        }
      }
    }

    const preBalances = tx.meta.preBalances || []
    const postBalances = tx.meta.postBalances || []

    for (let i = 0; i < Math.min(preBalances.length, postBalances.length); i++) {
      const solChange = (postBalances[i] - preBalances[i]) / 1e9
      if (Math.abs(solChange) > 0.0005) {
        solAmountChange += Math.abs(solChange)
      }
    }

    const isBuy = tokenAmountChange > 0
    const isSell = tokenAmountChange < 0

    if (Math.abs(tokenAmountChange) < 0.001 && solAmountChange < 0.0005) {
      return null
    }

    const minSolAmount = 0.0001
    if (solAmountChange < minSolAmount && Math.abs(tokenAmountChange) < 0.001) {
      return null
    }

    console.log(
      `📊 ${hasJupiterSwap ? "Jupiter" : "DEX"} Transaction ${signature.slice(0, 8)}...: ${isBuy ? "BUY" : isSell ? "SELL" : "UNKNOWN"} ${solAmountChange.toFixed(4)} SOL, Token change: ${tokenAmountChange.toFixed(2)}`,
    )

    return {
      isBuy: isBuy || solAmountChange > 0.0005,
      solAmount: solAmountChange,
    }
  } catch (error) {
    console.error(`❌ Error analyzing transaction ${signature.slice(0, 8)}:`, error)
    return null
  }
}

async function startVolumeBasedAutoSell(mint: string, wallets: Keypair[], percentage: number, slippageBps: number) {
  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  )

  console.log(`🎯 Starting simplified auto-sell monitoring for ${mint}`)
  console.log(`   Wallets: ${wallets.length}`)
  console.log(`   Sell percentage: ${percentage}%`)

  try {
    const result = await Promise.race([
      (async () => {
        const volumeData = await quickVolumeCheck(connection, mint)

        const totalVolume = volumeData.buyVolume + volumeData.sellVolume
        const hasSignificantActivity = totalVolume > 0.001
        const hasBuyActivity = volumeData.buyVolume > 0.0005

        console.log(
          `📈 Volume analysis: Total: ${totalVolume.toFixed(4)} SOL, Buy: ${volumeData.buyVolume.toFixed(4)} SOL`,
        )
        console.log(`🎯 Triggers: Significant activity: ${hasSignificantActivity}, Buy activity: ${hasBuyActivity}`)

        if (hasSignificantActivity && hasBuyActivity) {
          console.log(`🚀 Auto-sell triggered! Buy volume: ${volumeData.buyVolume.toFixed(4)} SOL detected`)

          const sellResult = await executeAutoSell(mint, wallets, percentage, slippageBps, volumeData.buyVolume)
          return {
            success: true,
            action: "sell_executed",
            volumeData,
            sellResult,
            buyVolume: volumeData.buyVolume,
            totalVolume,
            message: `Auto-sell executed: ${percentage}% of tokens sold due to ${volumeData.buyVolume.toFixed(4)} SOL buy volume`,
          }
        } else {
          return {
            success: true,
            action: "no_sell",
            volumeData,
            totalVolume,
            reason: hasSignificantActivity ? "insufficient_buy_volume" : "no_significant_activity",
            message: `No auto-sell: ${!hasSignificantActivity ? "insufficient total volume" : "insufficient buy volume"}`,
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
      connection.getSignaturesForAddress(new PublicKey(mint), { limit: 20 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Signature fetch timeout")), 6000)),
    ])) as any[]

    const recentSigs = signatures.slice(0, 10)
    console.log(`🔍 Analyzing ${recentSigs.length} recent transactions`)

    const analysisPromises = recentSigs.map(async (sigInfo) => {
      try {
        return await analyzeTransactionVolume(connection, sigInfo.signature, mint)
      } catch (error) {
        console.error(`Error analyzing ${sigInfo.signature.slice(0, 8)}:`, error)
        return null
      }
    })

    const analyses = await Promise.allSettled(analysisPromises)

    for (let i = 0; i < analyses.length; i++) {
      const result = analyses[i]
      if (result.status === "fulfilled" && result.value) {
        const analysis = result.value
        volumeData.transactions.push(recentSigs[i].signature)

        if (analysis.isBuy) {
          volumeData.buyVolume += analysis.solAmount
        } else {
          volumeData.sellVolume += analysis.solAmount
        }
      }
    }

    console.log(
      `📊 Volume analysis: Buy ${volumeData.buyVolume.toFixed(4)} SOL, Sell ${volumeData.sellVolume.toFixed(4)} SOL, Analyzed: ${volumeData.transactions.length} transactions`,
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

async function startBloXrouteStreaming(mint: string, wallets: Keypair[], percentage: number, slippageBps: number) {
  if (!BLOXROUTE_API_KEY) {
    console.error("❌ bloXroute API key not found")
    return { success: false, error: "bloXroute API key required" }
  }

  console.log(`🚀 Starting bloXroute streaming for ${mint}`)

  try {
    const ws = new WebSocket(BLOXROUTE_WS_URL)

    activeMonitoringSessions.set(mint, {
      ws,
      wallets,
      percentage,
      slippageBps,
      startTime: Date.now(),
    })

    ws.on("open", () => {
      console.log(`🔗 bloXroute WebSocket connected for ${mint}`)

      const subscribeMessage = {
        id: 1,
        method: "subscribe",
        params: [
          "newTxs",
          {
            filters: `to:${mint} OR from:${mint}`,
            include: ["tx_hash", "tx_contents"],
          },
        ],
      }

      ws.send(JSON.stringify(subscribeMessage))
      console.log(`📡 Subscribed to transactions for ${mint}`)
    })

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.method === "subscribe" && message.params) {
          const txData = message.params
          console.log(`📥 New transaction detected for ${mint}`)

          const isBuyTransaction = await analyzeBloXrouteTransaction(txData, mint)

          if (isBuyTransaction) {
            console.log(`🎯 Buy transaction detected! Executing auto-sell...`)

            const session = activeMonitoringSessions.get(mint)
            if (session) {
              const sellResult = await executeAutoSell(
                mint,
                session.wallets,
                session.percentage,
                session.slippageBps,
                0.01,
              )
              console.log(`✅ Auto-sell executed:`, sellResult)

              ws.close()
              activeMonitoringSessions.delete(mint)
            }
          }
        }
      } catch (error) {
        console.error("❌ Error processing bloXroute message:", error)
      }
    })

    ws.on("error", (error) => {
      console.error(`❌ bloXroute WebSocket error for ${mint}:`, error)
      activeMonitoringSessions.delete(mint)
    })

    ws.on("close", () => {
      console.log(`🔌 bloXroute WebSocket closed for ${mint}`)
      activeMonitoringSessions.delete(mint)
    })

    return {
      success: true,
      message: `bloXroute streaming started for ${mint}`,
      status: "streaming_active",
    }
  } catch (error) {
    console.error("❌ Failed to start bloXroute streaming:", error)
    return { success: false, error: error.message }
  }
}

async function analyzeBloXrouteTransaction(txData: any, mint: string): Promise<boolean> {
  try {
    const txContent = txData.tx_contents || txData.txContents
    if (!txContent) return false

    const hasJupiterInteraction =
      txContent.includes("JUP") || txContent.includes("Jupiter") || txContent.includes("swap")

    const hasTokenMint = txContent.includes(mint)

    if (hasJupiterInteraction && hasTokenMint) {
      console.log(`🎯 Detected Jupiter swap for ${mint}`)
      return true
    }

    return false
  } catch (error) {
    console.error("❌ Error analyzing bloXroute transaction:", error)
    return false
  }
}

async function handleNetflowMode(mint: string, privateKeys: string[], percentage: number, slippageBps: number) {
  const wallets: Keypair[] = []
  for (const pk of privateKeys) {
    try {
      const secretKey = bs58.decode(pk)
      const keypair = Keypair.fromSecretKey(secretKey)
      wallets.push(keypair)
    } catch (error) {
      console.error(`Invalid private key: ${pk}`)
      continue
    }
  }

  if (wallets.length === 0) {
    return Response.json({ error: "No valid wallets provided" }, { status: 400 })
  }

  console.log(`🚀 Starting bloXroute auto-sell monitoring for ${mint} with ${wallets.length} wallets`)

  const streamingResult = await startBloXrouteStreaming(mint, wallets, percentage, slippageBps)

  if (!streamingResult.success) {
    console.log("⚠️ bloXroute failed, falling back to RPC polling")
    startVolumeBasedAutoSell(mint, wallets, percentage, slippageBps)
      .then((result) => {
        console.log("Auto-sell completed:", result)
      })
      .catch((error) => {
        console.error("Auto-sell failed:", error)
      })
  }

  return Response.json({
    success: true,
    message: streamingResult.success
      ? `bloXroute streaming started for ${mint} with ${wallets.length} wallets`
      : `RPC monitoring started for ${mint} with ${wallets.length} wallets (bloXroute fallback)`,
    status: streamingResult.success ? "streaming_active" : "monitoring_started",
    mint,
    wallets: wallets.length,
    method: streamingResult.success ? "bloxroute_streaming" : "rpc_polling",
  })
}

interface VolumeData {
  buyVolume: number
  sellVolume: number
  transactions: string[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = BodySchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: "Invalid request body", details: parsed.error }, { status: 400 })
    }

    const { trades, mint, privateKeys, percentage = 25, slippageBps = 2000, mode = "netflow" } = parsed.data

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

      if (mode === "perbuy" && mint && privateKeys) {
        for (const trade of trades) {
          if (trade.side !== "buy" || trade.usd <= 0) continue
          if (Date.now() - lastSellAt < COOLDOWN_MS) continue

          const sellTokens = await tokensFromUsd(trade.usd * NET_FRACTION, mint)
          if (sellTokens <= BigInt(0)) continue

          const payload = {
            mint,
            privateKeys,
            percentage: 25,
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
        percentage: 25,
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

    if (!trades && mint && privateKeys) {
      return await handleNetflowMode(mint, privateKeys, percentage, slippageBps)
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
