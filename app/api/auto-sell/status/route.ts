import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function GET() {
  try {
    return NextResponse.json({
      isRunning: autoSellState.isRunning,
      config: autoSellState.config,
      metrics: autoSellState.metrics,
      recentMarketActivity: autoSellState.marketTrades?.slice(-20) || [], // Last 20 market trades
      walletStatus:
        autoSellState.wallets?.map((wallet) => ({
          name: wallet.name,
          publicKey: wallet.publicKey,
          balance: wallet.balance || 0,
          tokenBalance: wallet.tokenBalance || 0,
          cooldownUntil: wallet.cooldownUntil || 0,
          lastTransactionSignature: wallet.lastTransactionSignature || "",
          totalBought: wallet.totalBought || 0,
          totalSold: wallet.totalSold || 0,
          avgBuyPrice: wallet.avgBuyPrice || 0,
          buyTransactionCount: wallet.buyHistory?.length || 0,
        })) || [],
    })
  } catch (error) {
    console.error("Error getting auto-sell status:", error)
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}
