import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function POST() {
  try {
    if (!autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is not running" }, { status: 400 })
    }

    // Stop the engine
    autoSellState.isRunning = false

    // Clear all intervals
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []

    // Reset state
    autoSellState.config = null
    autoSellState.wallets = []
    autoSellState.window = { trades: [], windowSec: 120, minUsd: 1 }
    autoSellState.metrics = { buys: 0, sells: 0, net: 0, priceUsd: 0 }

    return NextResponse.json({
      success: true,
      message: "Auto-sell engine stopped successfully",
    })
  } catch (error) {
    console.error("Error stopping auto-sell:", error)
    return NextResponse.json({ error: "Failed to stop auto-sell engine" }, { status: 500 })
  }
}
