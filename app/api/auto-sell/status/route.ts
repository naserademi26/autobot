import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const mint = searchParams.get("mint")

    if (!mint) {
      return NextResponse.json({ error: "Mint address required" }, { status: 400 })
    }

    // TODO: Get real-time auto-sell status from monitoring system
    // This would typically query:
    // 1. Current sliding window data
    // 2. Recent sell transactions
    // 3. System health metrics

    // Mock data for now
    const status = {
      window: {
        buys: Math.random() * 1000,
        sells: Math.random() * 500,
        net: Math.random() * 500,
        priceUsd: Math.random() * 0.01,
      },
      lastActivity: new Date().toLocaleTimeString(),
      totalSells: Math.floor(Math.random() * 10),
      isHealthy: true,
    }

    return NextResponse.json(status)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
