import type { NextRequest } from "next/server"
import { Keypair } from "@solana/web3.js"
import { Connection, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { POST as sellHandler } from "../sell/route"

interface VolumeData {
  buyVolume: number
  sellVolume: number
  transactions: string[]
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
      new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction timeout")), 3000)),
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
    console.error(`Error analyzing transaction ${signature}:`, error)
    return null
  }
}

async function monitorVolumeWithEarlyDecision(
  connection: Connection,
  mint: string,
): Promise<VolumeData & { earlyDecision?: boolean }> {
  console.log(`⚡ Starting fast volume monitoring for ${mint}`)

  const volumeData: VolumeData & { earlyDecision?: boolean } = {
    buyVolume: 0,
    sellVolume: 0,
    transactions: [],
  }

  const startTime = Date.now()
  const maxDuration = 10000
  let lastSignature: string | undefined
  let consecutiveErrors = 0
  let checkCount = 0

  const absoluteTimeout = setTimeout(() => {
    console.log(`⏰ Auto-sell monitoring timed out after ${maxDuration / 1000} seconds`)
  }, maxDuration + 1000)

  try {
    while (Date.now() - startTime < maxDuration && consecutiveErrors < 3) {
      try {
        const signatures = (await Promise.race([
          connection.getSignaturesForAddress(new PublicKey(mint), {
            limit: 50,
            before: lastSignature,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("getSignatures timeout")), 5000)),
        ])) as any[]

        consecutiveErrors = 0
        checkCount++

        const signaturesSlice = signatures.slice(0, 20)

        for (const sigInfo of signaturesSlice) {
          if (volumeData.transactions.includes(sigInfo.signature)) continue

          const analysis = await analyzeTransactionVolume(connection, sigInfo.signature, mint)
          if (analysis) {
            volumeData.transactions.push(sigInfo.signature)

            if (analysis.isBuy) {
              volumeData.buyVolume += analysis.solAmount
              console.log(
                `🟢 Buy: ${analysis.solAmount.toFixed(4)} SOL (Total buy: ${volumeData.buyVolume.toFixed(4)} SOL)`,
              )
            } else {
              volumeData.sellVolume += analysis.solAmount
              console.log(
                `🔴 Sell: ${analysis.solAmount.toFixed(4)} SOL (Total sell: ${volumeData.sellVolume.toFixed(4)} SOL)`,
              )
            }
          }
        }

        const elapsedTime = Date.now() - startTime
        const volumeDifference = volumeData.buyVolume - volumeData.sellVolume
        const totalVolume = volumeData.buyVolume + volumeData.sellVolume

        if (elapsedTime >= 3000 && totalVolume >= 0.05 && volumeDifference > 0.02) {
          console.log(`⚡ Early decision triggered after ${(elapsedTime / 1000).toFixed(1)}s`)
          console.log(`   Buy advantage: ${volumeDifference.toFixed(4)} SOL`)
          volumeData.earlyDecision = true
          break
        }

        if (signatures.length > 0) {
          lastSignature = signatures[signatures.length - 1].signature
        }

        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (error) {
        consecutiveErrors++
        console.error(`Error monitoring volume (attempt ${consecutiveErrors}/3):`, error)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  } finally {
    clearTimeout(absoluteTimeout)
  }

  const volumeDifference = volumeData.buyVolume - volumeData.sellVolume
  const monitoringTime = (Date.now() - startTime) / 1000

  console.log(`📈 Volume summary for ${mint} (${monitoringTime.toFixed(1)}s monitoring):`)
  console.log(`   🟢 Buy volume: ${volumeData.buyVolume.toFixed(4)} SOL`)
  console.log(`   🔴 Sell volume: ${volumeData.sellVolume.toFixed(4)} SOL`)
  console.log(`   📊 Net difference: ${volumeDifference > 0 ? "+" : ""}${volumeDifference.toFixed(4)} SOL`)
  console.log(`   📝 Total transactions analyzed: ${volumeData.transactions.length}`)
  if (volumeData.earlyDecision) {
    console.log(`   ⚡ Early decision triggered`)
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

    const mockRequest = {
      json: async () => ({
        mint,
        privateKeys,
        percentage,
        slippageBps,
        limitWallets: Math.min(wallets.length, 20),
      }),
    } as NextRequest

    console.log(`🔗 Calling sell handler for ${mint} to sell ${percentage}% of tokens`)

    const response = (await Promise.race([
      sellHandler(mockRequest),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auto-sell timeout")), 30000)),
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

async function startVolumeBasedAutoSell(mint: string, wallets: Keypair[], percentage: number, slippageBps: number) {
  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  )

  console.log(`🎯 Starting fast volume-based auto-sell monitoring for ${mint}`)
  console.log(`   Wallets: ${wallets.length}`)
  console.log(`   Sell percentage: ${percentage}% of detected buy volume`)
  console.log(`   Slippage: ${slippageBps} bps`)

  try {
    const result = await Promise.race([
      (async () => {
        const volumeData = await monitorVolumeWithEarlyDecision(connection, mint)

        if (volumeData.buyVolume > volumeData.sellVolume) {
          const volumeDifference = volumeData.buyVolume - volumeData.sellVolume
          const decisionType = volumeData.earlyDecision ? "Early decision" : "Full monitoring"

          console.log(
            `🚀 ${decisionType}: Buy volume (${volumeData.buyVolume.toFixed(4)} SOL) exceeds sell volume (${volumeData.sellVolume.toFixed(4)} SOL) by ${volumeDifference.toFixed(4)} SOL`,
          )
          console.log(
            `🎯 Triggering auto-sell of ${percentage}% of the net buy volume (${volumeDifference.toFixed(4)} SOL)`,
          )

          const sellResult = await executeAutoSell(mint, wallets, percentage, slippageBps, volumeDifference)
          return {
            success: true,
            action: "sell_executed",
            volumeData,
            sellResult,
            earlyDecision: volumeData.earlyDecision,
            netBuyVolume: volumeDifference,
            message: `Auto-sell executed: ${percentage}% of ${volumeDifference.toFixed(4)} SOL net buy volume = ${((volumeDifference * percentage) / 100).toFixed(4)} SOL worth of tokens sold`,
          }
        } else {
          console.log(
            `📉 Sell volume (${volumeData.sellVolume.toFixed(4)} SOL) >= buy volume (${volumeData.buyVolume.toFixed(4)} SOL)`,
          )
          console.log(`⏸️ No auto-sell triggered`)

          return {
            success: true,
            action: "no_sell",
            volumeData,
            message: `No auto-sell: sell volume (${volumeData.sellVolume.toFixed(4)} SOL) >= buy volume (${volumeData.buyVolume.toFixed(4)} SOL)`,
          }
        }
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Auto-sell process timeout after 45 seconds")), 45000),
      ),
    ])

    return result
  } catch (error) {
    console.error("❌ Volume-based auto-sell error:", error)
    return {
      success: false,
      error: error.message,
      message: "Failed to monitor volume or execute auto-sell",
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { mint, privateKeys, percentage = 50, slippageBps = 2000 } = body

    if (!mint || !privateKeys || !Array.isArray(privateKeys)) {
      return Response.json({ error: "Missing required fields: mint, privateKeys" }, { status: 400 })
    }

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

    const result = await startVolumeBasedAutoSell(mint, wallets, percentage, slippageBps)

    return Response.json(result)
  } catch (error) {
    console.error("Auto-sell API error:", error)
    return Response.json({ error: "Internal server error", details: error.message }, { status: 500 })
  }
}
