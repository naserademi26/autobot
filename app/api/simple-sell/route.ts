import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { walletId, walletName, privateKey, tokenMint, percentage } = await request.json()

    console.log(`🔥 Simple Sell: ${walletName} selling ${percentage}% of ${tokenMint.slice(0, 8)}...`)

    // Validate inputs
    if (!privateKey || !tokenMint || !percentage) {
      return NextResponse.json({
        success: false,
        error: "Missing required data",
      })
    }

    // Simulate sell process with faster execution
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000))

    // Simulate success/failure (85% success rate for sells)
    const success = Math.random() > 0.15

    if (success) {
      const signature = `sell_${walletId}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
      const solReceived = (Math.random() * 0.5 + 0.1).toFixed(4) // Random SOL amount

      console.log(`✅ ${walletName}: Sell successful - ${signature} - Received ${solReceived} SOL`)

      return NextResponse.json({
        success: true,
        signature,
        message: `Successfully sold ${percentage}% for ${solReceived} SOL`,
        walletName,
        percentage,
        solReceived,
      })
    } else {
      const errors = [
        "No tokens to sell",
        "Insufficient token balance",
        "Market closed",
        "Slippage too high",
        "Network error",
      ]
      const error = errors[Math.floor(Math.random() * errors.length)]

      console.log(`❌ ${walletName}: Sell failed - ${error}`)

      return NextResponse.json({
        success: false,
        error,
        walletName,
      })
    }
  } catch (error) {
    console.error("Simple sell API error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 },
    )
  }
}
