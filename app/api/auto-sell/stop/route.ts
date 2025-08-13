import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function POST() {
  try {
    if (!autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is not running" }, { status: 400 })
    }

    // Stop the engine
    autoSellState.isRunning = false

    if (autoSellState.bitquerySubscription) {
      autoSellState.bitquerySubscription.close()
      autoSellState.bitquerySubscription = null
    }

    // Clear all intervals
    autoSellState.intervals.forEach((interval) => clearInterval(interval))
    autoSellState.intervals = []

    // Reset state
    autoSellState.config = null
    autoSellState.wallets = []
    autoSellState.marketTrades = []
    autoSellState.metrics = {
      totalBought: 0,
      totalSold: 0,
      currentPrice: 0,
      currentPriceUsd: 0,
      solPriceUsd: 100,
      netUsdFlow: 0,
      buyVolumeUsd: 0,
      sellVolumeUsd: 0,
      lastSellTrigger: 0,
    }

    return NextResponse.json({
      success: true,
      message: "Auto-sell engine stopped successfully",
    })
  } catch (error) {
    console.error("Error stopping auto-sell:", error)
    return NextResponse.json({ error: "Failed to stop auto-sell engine" }, { status: 500 })
  }
}
