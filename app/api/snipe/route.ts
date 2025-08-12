import { type NextRequest, NextResponse } from "next/server"
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// RPC and services
const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
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

// Extract base58 mint (URL-safe)
function sanitizeMint(input: string): string {
  const s = (input ?? "").trim()
  if (!s) return ""
  try {
    if (s.startsWith("http")) {
      const url = new URL(s)
      const mintParam = url.searchParams.get("mint")
      if (mintParam) return sanitizeMint(mintParam)
      const parts = url.pathname.split("/").filter(Boolean)
      const idx = parts.findIndex((p) => p.toLowerCase() === "coins")
      if (idx >= 0 && parts[idx + 1]) return sanitizeMint(parts[idx + 1])
    }
  } catch {}
  // keep only base58 characters
  return s.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "")
}

function decodeKey(line: string): Keypair | null {
  try {
    const t = line.trim()
    if (!t) return null
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)))
    return Keypair.fromSecretKey(bs58.decode(t))
  } catch {
    return null
  }
}

// Extract base64 tx content from various Jupiter/bloXroute responses
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

// Timeout helper
function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

async function submitViaBXR(signedB64: string) {
  if (!BXR_AUTH) throw new Error("bloXroute auth missing")
  const res = await fetch(`${BXR_SUBMIT}/api/v2/submit`, {
    method: "POST",
    headers: {
      Authorization: BXR_AUTH, // Now uses proper Basic auth format
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      transaction: { content: signedB64 },
      skipPreFlight: true,
      submitProtection: "SP_MEDIUM",
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`bloXroute submit ${res.status}: ${t.slice(0, 300)}`)
  }
  const j = await res.json()
  return j?.signature || j?.signatures?.[0] || "submitted"
}

// Race broadcast paths: whichever returns a signature first wins
async function raceBroadcast(connection: Connection, signedB64: string): Promise<{ sig: string; via: string }> {
  const raw = Buffer.from(signedB64, "base64")

  const candidates: Promise<{ sig: string; via: string }>[] = []

  // bloXroute with better error handling
  if (BXR_AUTH) {
    candidates.push(
      withTimeout(
        submitViaBXR(signedB64).then((sig) => ({ sig, via: "bloxroute" })),
        8000, // Increased timeout
        "bloxroute-submit",
      ).catch((e) => {
        console.log(`bloXroute submit failed: ${e.message}`)
        throw e
      }),
    )
  }

  // RPC direct with retry logic
  candidates.push(
    withTimeout(
      (async () => {
        try {
          const sig = await connection.sendRawTransaction(raw, {
            skipPreflight: true,
            maxRetries: 2, // Added retries for RPC
            preflightCommitment: "processed",
          })
          return { sig, via: "rpc" }
        } catch (e) {
          console.log(`RPC submit failed: ${e.message}`)
          throw e
        }
      })(),
      8000, // Increased timeout
      "rpc-send",
    ),
  )

  const results = await Promise.allSettled(candidates)

  // Return first successful result
  for (const result of results) {
    if (result.status === "fulfilled") {
      return result.value
    }
  }

  // If all failed, throw combined error
  const errors = results.filter((r) => r.status === "rejected").map((r: any) => r.reason?.message || String(r.reason))

  throw new Error(`All broadcast methods failed: ${errors.join(" | ")}`)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const mintRaw: string = body.mint
    const privateKeys: string[] = body.privateKeys
    const limitWallets: number = body.limitWallets ?? 65
    const percentage: number = body.percentage ?? 50
    const slippageBps: number = body.slippageBps ?? 1500 // Reduced default slippage to prevent excessive fees

    const mint = sanitizeMint(mintRaw)
    if (!mint) return NextResponse.json({ error: "invalid mint input", sanitized: mint }, { status: 400 })
    try {
      // eslint-disable-next-line no-new
      new PublicKey(mint)
    } catch {
      return NextResponse.json({ error: "invalid mint address format", sanitized: mint }, { status: 400 })
    }

    if (!Array.isArray(privateKeys)) {
      return NextResponse.json({ error: "privateKeys required (string[])" }, { status: 400 })
    }

    const keys = privateKeys.slice(0, Math.min(limitWallets, 65)).map(decodeKey).filter(Boolean) as Keypair[]
    if (keys.length === 0) return NextResponse.json({ error: "no valid keys" }, { status: 400 })

    const connection = new Connection(HELIUS_RPC_URL, { commitment: "confirmed" })

    try {
      await withTimeout(connection.getLatestBlockhash("processed"), 5000, "connection-test")
    } catch (e) {
      return NextResponse.json({ error: "RPC connection failed", details: e.message }, { status: 500 })
    }

    const balances = await Promise.all(keys.map((k) => connection.getBalance(k.publicKey, "processed")))
    const feeReserve = 300_000 // Reduced fee reserve to minimize locked funds

    const start = Date.now()

    // Execute all wallets in parallel with improved error handling
    const tasks = keys.map(async (kp, i) => {
      const pub = kp.publicKey.toBase58()
      const out: any = { wallet: pub }
      let path: "bxr" | "jup" = "bxr"

      try {
        const lam = balances[i] || 0
        const spendLam = Math.max(0, Math.floor(lam * (percentage / 100)) - feeReserve)
        if (spendLam <= 0) {
          out.error = "insufficient balance after fee reserve"
          return out
        }

        if (spendLam < 10000) {
          // 0.00001 SOL minimum
          out.error = "spend amount too small (minimum 0.00001 SOL)"
          return out
        }

        // 1) Try bloXroute Jupiter proxy first (fast path)
        let unsignedB64: string | null = null
        try {
          if (BXR_AUTH) {
            const br = await withTimeout(
              fetch(`${BXR_REGION}/api/v2/jupiter/swap`, {
                method: "POST",
                headers: {
                  Authorization: BXR_AUTH, // Now uses proper Basic auth format
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  ownerAddress: pub,
                  inToken: "SOL",
                  outToken: mint,
                  inAmount: spendLam / 1e9,
                  slippage: slippageBps / 100,
                  computePrice: 10_000_000,
                }),
              }),
              12000,
              "bloxroute-swap",
            )

            out.bxrSwapStatus = br.status
            if (br.ok) {
              const j = await br.json()
              const extractedTx = extractBase64Tx(j)
              if (extractedTx && typeof extractedTx === "string" && extractedTx.length > 0) {
                unsignedB64 = extractedTx
              } else {
                out.bxrSwapError = `invalid transaction format: ${typeof extractedTx}, length: ${extractedTx?.length || 0}`
              }
            } else {
              const errorText = await br.text()
              out.bxrSwapError = errorText.slice(0, 300)
            }
          } else {
            out.bxrSwapError = "no bloXroute auth configured"
          }
        } catch (e: any) {
          out.bxrSwapError = e?.message || String(e)
        }

        // 2) Fallback to Jupiter v6 with improved error handling
        if (!unsignedB64) {
          path = "jup"
          try {
            const quoteUrl = `${JUP_BASE}/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${spendLam}&slippageBps=${slippageBps}&onlyDirectRoutes=false&asLegacyTransaction=false&maxAccounts=64`

            const jupHeaders: Record<string, string> = {
              Accept: "application/json",
              "User-Agent": "PumpFun-Sniper/1.0",
            }
            if (JUP_API_KEY) {
              jupHeaders["X-API-Key"] = JUP_API_KEY
            }

            const qRes = await withTimeout(
              fetch(quoteUrl, {
                headers: jupHeaders,
                cache: "no-store",
              }),
              12000,
              "jupiter-quote",
            )

            out.jupQuoteStatus = qRes.status
            if (!qRes.ok) {
              const errorText = await qRes.text()
              out.jupQuoteError = errorText.slice(0, 300)

              if (errorText.includes("TOKEN_NOT_TRADABLE")) {
                throw new Error(`Token ${mint} is not tradable on Jupiter - try a different token`)
              } else if (errorText.includes("No routes found")) {
                throw new Error(`No trading routes found for token ${mint} - insufficient liquidity`)
              } else {
                throw new Error(`Jupiter quote failed: ${qRes.status} - ${errorText.slice(0, 100)}`)
              }
            }

            const quote = await qRes.json()
            if (!quote || quote.error || !quote.outAmount) {
              out.jupQuoteError = quote?.error || "no route found"
              throw new Error(`Jupiter quote error: ${out.jupQuoteError}`)
            }

            const expectedTokens = Number.parseInt(quote.outAmount || "0")
            if (expectedTokens <= 0) {
              out.jupQuoteError = "quote returned zero tokens"
              throw new Error(out.jupQuoteError)
            }

            const swapHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": "PumpFun-Sniper/1.0",
            }
            if (JUP_API_KEY) {
              swapHeaders["X-API-Key"] = JUP_API_KEY
            }

            const swapRes = await withTimeout(
              fetch(`${JUP_BASE}/v6/swap`, {
                method: "POST",
                headers: swapHeaders,
                body: JSON.stringify({
                  quoteResponse: quote,
                  userPublicKey: pub,
                  wrapAndUnwrapSol: true,
                  asLegacyTransaction: false,
                  prioritizationFeeLamports: 50000, // Reduced priority fee
                  dynamicComputeUnitLimit: true,
                  skipUserAccountsRpcCalls: true,
                }),
              }),
              12000,
              "jupiter-swap",
            )

            out.jupSwapStatus = swapRes.status
            if (!swapRes.ok) {
              const errorText = await swapRes.text()
              out.jupSwapError = errorText.slice(0, 300)
              throw new Error(`Jupiter swap failed: ${swapRes.status} - ${errorText.slice(0, 100)}`)
            }

            const swapJson = await swapRes.json()
            const extractedTx = extractBase64Tx(swapJson)
            if (extractedTx && typeof extractedTx === "string" && extractedTx.length > 0) {
              unsignedB64 = extractedTx
            } else {
              out.jupSwapError = `invalid transaction format: ${typeof extractedTx}, length: ${extractedTx?.length || 0}`
              throw new Error(out.jupSwapError)
            }
          } catch (e: any) {
            out.jupSwapError = e?.message || String(e)
          }
        }

        if (!unsignedB64 || typeof unsignedB64 !== "string" || unsignedB64.length === 0) {
          out.error = `no valid unsigned transaction generated (type: ${typeof unsignedB64}, length: ${unsignedB64?.length || 0})`
          out.path = path
          return out
        }

        // 3) Sign transaction
        const tx = VersionedTransaction.deserialize(Buffer.from(unsignedB64, "base64"))
        tx.sign([kp])
        const signedB64 = Buffer.from(tx.serialize()).toString("base64")

        // 4) Broadcast with improved error handling
        const { sig, via } = await raceBroadcast(connection, signedB64)
        out.signature = sig
        out.path = path
        out.via = via
        return out
      } catch (e: any) {
        out.error = e?.message || String(e)
        out.path = path
        return out
      }
    })

    const results = await Promise.allSettled(tasks)
    const seconds = ((Date.now() - start) / 1000).toFixed(2)

    const ok = results.filter((r) => r.status === "fulfilled" && (r as any).value?.signature).map((r: any) => r.value)
    const fail = results
      .filter((r) => r.status === "fulfilled" && (r as any).value?.error)
      .map((r: any) => r.value)
      .concat(
        results
          .filter((r) => r.status === "rejected")
          .map((r: any) => ({ wallet: "unknown", error: r.reason?.message || String(r.reason) })),
      )

    return NextResponse.json({
      mint,
      wallets: results.length,
      seconds,
      success: ok.length,
      failures: fail.length,
      ok,
      fail,
      hints: {
        rpc: Boolean(HELIUS_RPC_URL),
        bxrAuth: Boolean(BXR_AUTH),
        jupKey: Boolean(JUP_API_KEY),
        bxrRawKey: Boolean(BXR_RAW_KEY),
        bxrAuthHeader: Boolean(BXR_AUTH), // Updated to reflect actual auth used
      },
    })
  } catch (e: any) {
    console.error("Snipe API error:", e)
    return NextResponse.json({ error: e?.message || "internal server error" }, { status: 500 })
  }
}
