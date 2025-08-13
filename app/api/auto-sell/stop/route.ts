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
    autoSellState.buyTransactions = []
    autoSellState.metrics = { totalBought: 0, totalSold: 0, avgBuyPrice: 0, currentPrice: 0, unrealizedPnL: 0 }

    return NextResponse.json({
      success: true,
      message: "Auto-sell engine stopped successfully",
    })
  } catch (error) {
    console.error("Error stopping auto-sell:", error)
    return NextResponse.json({ error: "Failed to stop auto-sell engine" }, { status: 500 })
  }
}
