import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { walletId, walletName, privateKey, tokenMint, amount } = await request.json()

    console.log(`🚀 Simple Buy: ${walletName} buying ${amount} SOL of ${tokenMint.slice(0, 8)}...`)

    // Validate inputs
    if (!privateKey || !tokenMint || !amount) {
      return NextResponse.json({
        success: false,
        error: "Missing required data",
      })
    }

    // Simulate buy process with realistic delay
    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000))

    // Simulate success/failure (80% success rate)
    const success = Math.random() > 0.2

    if (success) {
      const signature = `buy_${walletId}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`

      console.log(`✅ ${walletName}: Buy successful - ${signature}`)

      return NextResponse.json({
        success: true,
        signature,
        message: `Successfully bought ${amount} SOL worth of tokens`,
        walletName,
        amount,
      })
    } else {
      const errors = [
        "Insufficient SOL balance",
        "Token not found",
        "Slippage too high",
        "Network congestion",
        "RPC timeout",
      ]
      const error = errors[Math.floor(Math.random() * errors.length)]

      console.log(`❌ ${walletName}: Buy failed - ${error}`)

      return NextResponse.json({
        success: false,
        error,
        walletName,
      })
    }
  } catch (error) {
    console.error("Simple buy API error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 },
    )
  }
}
