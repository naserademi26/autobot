import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function POST() {
  try {
    if (!autoSellState.isRunning) {
      return NextResponse.json({ error: "Auto-sell engine is not running" }, { status: 400 })
    }

    // Stop the engine
    autoSellState.isRunning = false

    autoSellState.intervals.forEach((interval) => {
      try {
        clearInterval(interval)
        autoSellState.intervalIds?.delete(interval)
      } catch (e) {
        console.warn("Error clearing interval:", e)
      }
    })
    autoSellState.intervals = []
    if (autoSellState.intervalIds) {
      autoSellState.intervalIds.clear()
    }

    autoSellState.config = null
    autoSellState.wallets = []
    autoSellState.marketTrades = [] // Fixed: use marketTrades instead of buyTransactions
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
      analysisWindowStart: 0,
      windowCompleted: false,
    }
    autoSellState.lastError = null
    autoSellState.errorCount = 0

    console.log("[ENGINE] Auto-sell engine stopped and state reset")

    return NextResponse.json({
      success: true,
      message: "Auto-sell engine stopped successfully",
    })
  } catch (error) {
    console.error("Error stopping auto-sell:", error)
    return NextResponse.json({ error: "Failed to stop auto-sell engine" }, { status: 500 })
  }
}
