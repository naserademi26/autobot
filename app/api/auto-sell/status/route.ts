import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function GET() {
  try {
    return NextResponse.json({
      isRunning: autoSellState.isRunning,
      config: autoSellState.config,
      metrics: autoSellState.metrics,
      recentTrades: autoSellState.window.trades.slice(-20), // Last 20 trades
      walletStatus: autoSellState.wallets.map((wallet) => ({
        name: wallet.name,
        publicKey: wallet.publicKey,
        balance: wallet.balance || 0,
        tokenBalance: wallet.tokenBalance || 0,
        cooldownUntil: wallet.cooldownUntil || 0,
        lastSig: wallet.lastSig || "",
      })),
    })
  } catch (error) {
    console.error("Error getting auto-sell status:", error)
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}
