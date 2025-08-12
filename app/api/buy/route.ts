import { type NextRequest, NextResponse } from "next/server"
import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import bs58 from "bs58"

// Updated API configuration
const JUPITER_API_BASE = "https://quote-api.jup.ag/v6"
const JUPITER_API_KEY = "da460be6-fe88-454d-a927-f4f89fb51a6d"

// Premium RPC endpoints
const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://api.mainnet-beta.solana.com",
]

interface BuyRequest {
  privateKey: string
  tokenMint: string
  amount: number
  slippage?: number
}

export async function POST(request: NextRequest) {
  try {
    const body: BuyRequest = await request.json()
    const { privateKey, tokenMint, amount, slippage = 50 } = body

    console.log(`🚀 BUY API: ${amount} SOL for token ${tokenMint}`)

    // Validate inputs
    if (!privateKey || !tokenMint || !amount) {
      return NextResponse.json({ success: false, error: "Missing required parameters" }, { status: 400 })
    }

    if (amount <= 0 || amount > 10) {
      return NextResponse.json({ success: false, error: "Invalid amount" }, { status: 400 })
    }

    // Create keypair from private key
    let keypair: Keypair
    try {
      const cleanKey = privateKey.trim()

      if (cleanKey.includes(",")) {
        // Array format
        const numbers = cleanKey.split(",").map((n) => Number.parseInt(n.trim()))
        if (numbers.length !== 64 || numbers.some((n) => isNaN(n) || n < 0 || n > 255)) {
          throw new Error("Invalid array format")
        }
        keypair = Keypair.fromSecretKey(new Uint8Array(numbers))
      } else if (cleanKey.length === 128) {
        // Hex format
        const bytes = new Uint8Array(64)
        for (let i = 0; i < 64; i++) {
          bytes[i] = Number.parseInt(cleanKey.substr(i * 2, 2), 16)
        }
        keypair = Keypair.fromSecretKey(bytes)
      } else {
        // Base58 format
        const decoded = bs58.decode(cleanKey)
        if (decoded.length !== 64) {
          throw new Error("Invalid key length")
        }
        keypair = Keypair.fromSecretKey(decoded)
      }
    } catch (error) {
      console.error("❌ Invalid private key format:", error)
      return NextResponse.json({ success: false, error: "Invalid private key format" }, { status: 400 })
    }

    console.log(`💰 Wallet: ${keypair.publicKey.toString()}`)

    // Create connection
    const connection = new Connection(RPC_ENDPOINTS[0], {
      commitment: "processed",
      confirmTransactionInitialTimeout: 30000,
    })

    // Check wallet balance
    const balance = await connection.getBalance(keypair.publicKey)
    const balanceSOL = balance / LAMPORTS_PER_SOL

    console.log(`💰 Balance: ${balanceSOL} SOL`)

    if (balanceSOL < amount + 0.01) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient balance: ${balanceSOL.toFixed(4)} SOL available, need ${(amount + 0.01).toFixed(4)} SOL`,
        },
        { status: 400 },
      )
    }

    const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL)
    const slippageBps = slippage * 100

    console.log(`⚡ Step 1: Getting Jupiter quote...`)

    // Step 1: Get Jupiter quote
    const quoteUrl = `${JUPITER_API_BASE}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenMint}&amount=${amountLamports}&slippageBps=${slippageBps}&onlyDirectRoutes=false`

    const quoteResponse = await fetch(quoteUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": JUPITER_API_KEY,
      },
    })

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text()
      console.error(`❌ Jupiter quote error: ${errorText}`)
      return NextResponse.json(
        { success: false, error: `Jupiter quote error: ${quoteResponse.status}` },
        { status: 500 },
      )
    }

    const quoteData = await quoteResponse.json()

    if (!quoteData || quoteData.error || !quoteData.outAmount || quoteData.outAmount === "0") {
      console.error(`❌ Invalid quote:`, quoteData)
      return NextResponse.json(
        { success: false, error: `No liquidity or invalid quote: ${quoteData?.error || "No output amount"}` },
        { status: 500 },
      )
    }

    const outputTokens = Number.parseInt(quoteData.outAmount) / Math.pow(10, 6)
    console.log(`✅ Quote OK: Will receive ~${outputTokens.toFixed(2)} tokens`)

    console.log(`⚡ Step 2: Getting swap transaction...`)

    // Step 2: Get swap transaction with simplified configuration
    const swapPayload = {
      quoteResponse: quoteData,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: "auto",
      skipUserAccountsRpcCalls: true,
      asLegacyTransaction: false,
      useTokenLedger: false,
      destinationTokenAccount: undefined,
      dynamicComputeUnitLimit: true,
    }

    const swapResponse = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": JUPITER_API_KEY,
      },
      body: JSON.stringify(swapPayload),
    })

    if (!swapResponse.ok) {
      const errorText = await swapResponse.text()
      console.error(`❌ Jupiter swap error: ${errorText}`)
      return NextResponse.json(
        { success: false, error: `Jupiter error: Swap API error: ${swapResponse.status}` },
        { status: 500 },
      )
    }

    const swapData = await swapResponse.json()

    if (!swapData.swapTransaction) {
      console.error(`❌ No swap transaction in response:`, swapData)
      return NextResponse.json({ success: false, error: "No swap transaction received from Jupiter" }, { status: 500 })
    }

    console.log(`⚡ Step 3: Signing and sending transaction...`)

    // Step 3: Sign and send transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, "base64")
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

    transaction.sign([keypair])

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      preflightCommitment: "processed",
      maxRetries: 0,
    })

    console.log(`📡 Transaction sent: ${signature}`)

    // Step 4: Confirm transaction
    const confirmation = await connection.confirmTransaction(signature, "processed")

    if (confirmation.value.err) {
      console.error(`❌ Transaction failed:`, confirmation.value.err)
      return NextResponse.json(
        { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}` },
        { status: 500 },
      )
    }

    console.log(`🎉 BUY SUCCESS!`)
    console.log(`✅ Signature: ${signature}`)
    console.log(`💰 Bought ~${outputTokens.toFixed(2)} tokens for ${amount} SOL`)

    return NextResponse.json({
      success: true,
      signature,
      outputTokens: outputTokens.toFixed(2),
      solscanUrl: `https://solscan.io/tx/${signature}`,
      message: `Successfully bought ~${outputTokens.toFixed(2)} tokens for ${amount} SOL`,
    })
  } catch (error: any) {
    console.error("❌ API Buy error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error occurred",
        details: error.stack,
      },
      { status: 500 },
    )
  }
}
