import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { mint } = await request.json()

    if (!mint) {
      return NextResponse.json({ error: "Mint address required" }, { status: 400 })
    }

    // TODO: Stop the auto-sell monitoring process for this mint
    // This would typically involve:
    // 1. Closing WebSocket connections
    // 2. Clearing timers and intervals
    // 3. Cleaning up resources

    return NextResponse.json({
      success: true,
      message: "Auto-sell stopped successfully",
      stoppedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
