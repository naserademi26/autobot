import { type NextRequest, NextResponse } from "next/server"
import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e"

const BXR_RAW_KEY = process.env.BLOXROUTE_API_KEY || process.env.NEXT_PUBLIC_BLOXROUTE_API_KEY || ""
const BXR_AUTH = BXR_RAW_KEY ? `Basic ${Buffer.from(`${BXR_RAW_KEY}:`).toString("base64")}` : ""

const BXR_REGION = process.env.BLOXROUTE_REGION_URL || "https://ny.solana.dex.blxrbdn.com"
const BXR_SUBMIT = process.env.BLOXROUTE_SUBMIT_URL || "https://global.solana.dex.blxrbdn.com"

const JUP_BASE = "https://quote-api.jup.ag"
const JUP_API_KEY =
  process.env.JUP_API_KEY ||
  process.env.JUPITER_API_KEY ||
  process.env.NEXT_PUBLIC_JUP_API_KEY ||
  process.env.NEXT_PUBLIC_JUPITER_API_KEY ||
  ""

interface SellRequest {
  mint: string
  privateKeys: string[]
  limitWallets?: number
  percentage: number
  slippageBps?: number
}

interface WalletResult {
  wallet: string
  success: boolean
  signature?: string
  soldTokens?: string
  receivedSOL?: string
  error?: string
  solscanUrl?: string
  bxrSwapStatus?: number
  bxrSwapError?: string
  jupQuoteStatus?: number
  jupQuoteError?: string
  jupSwapStatus?: number
  jupSwapError?: string
  path?: string
}

function parsePrivateKey(privateKey: string): Keypair {
  const cleanKey = privateKey.trim()

  if (cleanKey.startsWith("[") && cleanKey.endsWith("]")) {
    const arr = JSON.parse(cleanKey)
    return Keypair.fromSecretKey(new Uint8Array(arr))
  }

  if (cleanKey.includes(",")) {
    const numbers = cleanKey.split(",").map((n) => Number.parseInt(n.trim()))
    return Keypair.fromSecretKey(new Uint8Array(numbers))
  }

  return Keypair.fromSecretKey(bs58.decode(cleanKey))
}

function extractBase64Tx(swapJson: any): string | null {
  if (!swapJson) return null
  if (typeof swapJson === "string") return swapJson
  if (typeof swapJson.swapTransaction === "string") return swapJson.swapTransaction
  if (typeof swapJson.transaction === "string") return swapJson.transaction
  if (typeof swapJson.tx === "string") return swapJson.tx
  if (typeof swapJson?.data?.swapTransaction === "string") return swapJson.data.swapTransaction

  const txs = swapJson.transactions
  if (Array.isArray(txs) && txs.length > 0) {
    const first = txs[0]
    if (typeof first === "string") return first
    if (typeof first?.content === "string") return first.content
    if (typeof first?.transaction === "string") return first.transaction
    if (typeof first?.base64 === "string") return first.base64
  }
  return null
}

async function sellTokensForWallet(
  keypair: Keypair,
  tokenMint: string,
  percentage: number,
  slippageBps: number,
  connection: Connection,
): Promise<WalletResult> {
  const wallet = keypair.publicKey.toBase58()

  try {
    await connection.getLatestBlockhash("processed")

    // Get token balance with better error handling
    let tokenAccounts
    try {
      tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
        mint: new PublicKey(tokenMint),
      })
    } catch (error) {
      return { wallet, success: false, error: `Failed to get token accounts: ${error}` }
    }

    if (tokenAccounts.value.length === 0) {
      return { wallet, success: false, error: "No token accounts found for this mint" }
    }

    const tokenAccount = tokenAccounts.value[0]
    const tokenBalance = tokenAccount.account.data.parsed.info.tokenAmount
    const rawBalance = tokenBalance.amount
    const uiBalance = tokenBalance.uiAmount

    if (!uiBalance || uiBalance <= 0) {
      return { wallet, success: false, error: `No tokens to sell (balance: ${uiBalance})` }
    }

    const sellAmountRaw = Math.floor((Number.parseInt(rawBalance) * percentage) / 100)
    const sellAmountUI = (uiBalance * percentage) / 100

    if (sellAmountRaw <= 0) {
      return { wallet, success: false, error: `Sell amount too small (${sellAmountRaw} raw, ${sellAmountUI} UI)` }
    }

    if (sellAmountUI < 0.000001) {
      return { wallet, success: false, error: "Sell amount too small (minimum 0.000001 tokens)" }
    }

    console.log(
      `Wallet ${wallet}: Balance=${uiBalance}, Selling ${percentage}% = ${sellAmountUI} tokens (${sellAmountRaw} raw)`,
    )

    // Try bloXroute first, then Jupiter fallback with improved error handling
    let swapTransaction: string | null = null
    let expectedSOL = 0
    let bxrSwapStatus = 0
    let bxrSwapError = ""
    let jupQuoteStatus = 0
    let jupQuoteError = ""
    let jupSwapStatus = 0
    let jupSwapError = ""

    if (BXR_AUTH) {
      try {
        const bxrSwapRes = (await Promise.race([
          fetch(`${BXR_REGION}/api/v2/jupiter/swap`, {
            method: "POST",
            headers: {
              Authorization: BXR_AUTH,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              ownerAddress: wallet,
              inToken: tokenMint,
              outToken: "SOL",
              inAmount: sellAmountRaw,
              slippage: slippageBps / 100,
              computePrice: 8_000_000, // Reduced compute price
            }),
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("bloXroute timeout")), 12000)),
        ])) as Response

        bxrSwapStatus = bxrSwapRes.status
        if (bxrSwapRes.ok) {
          const bxrSwap = await bxrSwapRes.json()
          const extractedTx = extractBase64Tx(bxrSwap)
          if (extractedTx && typeof extractedTx === "string" && extractedTx.length > 0) {
            swapTransaction = extractedTx
            console.log(`bloXroute swap success for ${wallet}`)
          }
        } else {
          bxrSwapError = await bxrSwapRes.text()
          console.log(`bloXroute swap failed for ${wallet}: ${bxrSwapStatus} ${bxrSwapError}`)
        }
      } catch (e: any) {
        bxrSwapError = e.message
        console.log(`bloXroute sell failed for ${wallet}: ${e.message}`)
      }
    }

    if (!swapTransaction) {
      const jupHeaders: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "PumpFun-Sniper/1.0",
      }
      if (JUP_API_KEY) {
        jupHeaders["X-API-Key"] = JUP_API_KEY
      }

      try {
        const quoteUrl = `${JUP_BASE}/v6/quote?inputMint=${tokenMint}&outputMint=So11111111111111111111111111111111111111112&amount=${sellAmountRaw}&slippageBps=${slippageBps}&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=64`

        const jupQuoteRes = (await Promise.race([
          fetch(quoteUrl, {
            headers: jupHeaders,
            cache: "no-store",
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Jupiter quote timeout")), 12000)),
        ])) as Response

        jupQuoteStatus = jupQuoteRes.status
        if (!jupQuoteRes.ok) {
          jupQuoteError = await jupQuoteRes.text()

          if (jupQuoteError.includes("TOKEN_NOT_TRADABLE")) {
            return {
              wallet,
              success: false,
              error: `Token ${tokenMint} is not tradable on Jupiter - try a different token`,
              bxrSwapStatus,
              bxrSwapError,
              jupQuoteStatus,
              jupQuoteError,
            }
          } else if (jupQuoteError.includes("No routes found")) {
            return {
              wallet,
              success: false,
              error: `No trading routes found for token ${tokenMint} - insufficient liquidity`,
              bxrSwapStatus,
              bxrSwapError,
              jupQuoteStatus,
              jupQuoteError,
            }
          }

          return {
            wallet,
            success: false,
            error: `Jupiter quote failed: ${jupQuoteStatus} - ${jupQuoteError.slice(0, 100)}`,
            bxrSwapStatus,
            bxrSwapError,
            jupQuoteStatus,
            jupQuoteError,
          }
        }

        const jupQuote = await jupQuoteRes.json()
        if (!jupQuote || jupQuote.error || !jupQuote.outAmount) {
          jupQuoteError = jupQuote?.error || "no route found"
          return {
            wallet,
            success: false,
            error: `Jupiter quote error: ${jupQuoteError}`,
            bxrSwapStatus,
            bxrSwapError,
            jupQuoteStatus,
            jupQuoteError,
          }
        }

        expectedSOL = Number.parseInt(jupQuote.outAmount || "0") / LAMPORTS_PER_SOL

        if (expectedSOL <= 0) {
          jupQuoteError = "quote returned zero SOL"
          return {
            wallet,
            success: false,
            error: jupQuoteError,
            bxrSwapStatus,
            bxrSwapError,
            jupQuoteStatus,
            jupQuoteError,
          }
        }

        const swapHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "PumpFun-Sniper/1.0",
        }
        if (JUP_API_KEY) {
          swapHeaders["X-API-Key"] = JUP_API_KEY
        }

        const jupSwapRes = (await Promise.race([
          fetch(`${JUP_BASE}/v6/swap`, {
            method: "POST",
            headers: swapHeaders,
            body: JSON.stringify({
              quoteResponse: jupQuote,
              userPublicKey: wallet,
              wrapAndUnwrapSol: true,
              asLegacyTransaction: false,
              prioritizationFeeLamports: 30000, // Reduced priority fee
              dynamicComputeUnitLimit: true,
              skipUserAccountsRpcCalls: true,
            }),
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Jupiter swap timeout")), 12000)),
        ])) as Response

        jupSwapStatus = jupSwapRes.status
        if (!jupSwapRes.ok) {
          jupSwapError = await jupSwapRes.text()
          return {
            wallet,
            success: false,
            error: `Jupiter swap failed: ${jupSwapStatus} - ${jupSwapError.slice(0, 100)}`,
            bxrSwapStatus,
            bxrSwapError,
            jupQuoteStatus,
            jupQuoteError,
            jupSwapStatus,
            jupSwapError,
          }
        }

        const jupSwap = await jupSwapRes.json()
        const extractedTx = extractBase64Tx(jupSwap)
        if (extractedTx && typeof extractedTx === "string" && extractedTx.length > 0) {
          swapTransaction = extractedTx
          console.log(`Jupiter swap success for ${wallet}`)
        } else {
          jupSwapError = `invalid transaction format: ${typeof extractedTx}, length: ${extractedTx?.length || 0}`
          return {
            wallet,
            success: false,
            error: jupSwapError,
            bxrSwapStatus,
            bxrSwapError,
            jupQuoteStatus,
            jupQuoteError,
            jupSwapStatus,
            jupSwapError,
          }
        }
      } catch (e: any) {
        jupSwapError = e.message
        return {
          wallet,
          success: false,
          error: `Jupiter API error: ${e.message}`,
          bxrSwapStatus,
          bxrSwapError,
          jupQuoteStatus,
          jupQuoteError,
          jupSwapStatus,
          jupSwapError,
        }
      }
    }

    if (!swapTransaction || typeof swapTransaction !== "string" || swapTransaction.length === 0) {
      return {
        wallet,
        success: false,
        error: `No valid swap transaction generated (type: ${typeof swapTransaction}, length: ${swapTransaction?.length || 0})`,
        bxrSwapStatus,
        bxrSwapError,
        jupQuoteStatus,
        jupQuoteError,
        jupSwapStatus,
        jupSwapError,
        path: bxrSwapStatus === 200 ? "bxr" : "jup",
      }
    }

    const txBuf = Buffer.from(swapTransaction, "base64")
    const tx = VersionedTransaction.deserialize(txBuf)
    tx.sign([keypair])
    const serializedTx = tx.serialize()

    const submitPromises = []

    // bloXroute submit with timeout
    if (BXR_AUTH) {
      submitPromises.push(
        Promise.race([
          fetch(`${BXR_SUBMIT}/api/v2/submit`, {
            method: "POST",
            headers: {
              Authorization: BXR_AUTH,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              transaction: { content: Buffer.from(serializedTx).toString("base64") },
              skipPreFlight: true,
              submitProtection: "SP_LOW", // Reduced protection for faster submission
            }),
          }).then((r) => (r.ok ? r.json().then((j) => j.signature || j?.signatures?.[0] || "submitted") : null)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("bloXroute submit timeout")), 8000)),
        ]),
      )
    }

    // Direct RPC submit with retry
    submitPromises.push(
      Promise.race([
        connection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 2, // Added retries
          preflightCommitment: "processed",
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("RPC submit timeout")), 8000)),
      ]),
    )

    const results = await Promise.allSettled(submitPromises.filter(Boolean))
    let signature = null

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        signature = result.value
        break
      }
    }

    if (!signature) {
      const errors = results
        .filter((r) => r.status === "rejected")
        .map((r: any) => r.reason?.message || String(r.reason))
      return {
        wallet,
        success: false,
        error: `Transaction broadcast failed: ${errors.join(" | ")}`,
      }
    }

    return {
      wallet,
      success: true,
      signature,
      soldTokens: sellAmountUI.toFixed(6),
      receivedSOL: expectedSOL.toFixed(6),
      solscanUrl: `https://solscan.io/tx/${signature}`,
    }
  } catch (error: any) {
    return {
      wallet,
      success: false,
      error: error.message || "Unknown error",
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SellRequest = await request.json()
    const { mint, privateKeys, limitWallets = 65, percentage, slippageBps = 2000 } = body

    if (!mint || !privateKeys || !Array.isArray(privateKeys) || privateKeys.length === 0) {
      return NextResponse.json({ success: false, error: "Invalid request parameters" }, { status: 400 })
    }

    if (percentage <= 0 || percentage > 100) {
      return NextResponse.json({ success: false, error: "Invalid percentage" }, { status: 400 })
    }

    const connection = new Connection(HELIUS_RPC_URL, { commitment: "processed" })
    const walletLimit = Math.min(privateKeys.length, limitWallets)
    const tasks: Promise<WalletResult>[] = []

    // Process all wallets in parallel
    for (let i = 0; i < walletLimit; i++) {
      try {
        const keypair = parsePrivateKey(privateKeys[i])
        tasks.push(sellTokensForWallet(keypair, mint, percentage, slippageBps, connection))
      } catch (error) {
        tasks.push(
          Promise.resolve({
            wallet: "invalid",
            success: false,
            error: "Invalid private key format",
          }),
        )
      }
    }

    const results = await Promise.allSettled(tasks)
    const walletResults: WalletResult[] = results.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : {
            wallet: "error",
            success: false,
            error: "Task execution failed",
          },
    )

    const successful = walletResults.filter((r) => r.success)
    const failed = walletResults.filter((r) => !r.success)

    const totalSoldTokens = successful.reduce((sum, r) => sum + Number.parseFloat(r.soldTokens || "0"), 0)
    const totalReceivedSOL = successful.reduce((sum, r) => sum + Number.parseFloat(r.receivedSOL || "0"), 0)

    return NextResponse.json({
      success: true,
      summary: {
        totalWallets: walletLimit,
        successful: successful.length,
        failed: failed.length,
        totalSoldTokens: totalSoldTokens.toFixed(6),
        totalReceivedSOL: totalReceivedSOL.toFixed(6),
      },
      results: walletResults,
    })
  } catch (error: any) {
    console.error("Sell API error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error occurred",
      },
      { status: 500 },
    )
  }
}
