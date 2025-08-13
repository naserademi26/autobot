import { NextResponse } from "next/server"
import { autoSellState } from "../start/route"

export async function GET() {
  try {
    const isActuallyRunning =
      autoSellState.isRunning &&
      autoSellState.analysisInterval !== null &&
      autoSellState.wallets &&
      autoSellState.wallets.length > 0

    return NextResponse.json({
      isRunning: isActuallyRunning,
      config: autoSellState.config,
      metrics: autoSellState.metrics,
      recentMarketActivity: autoSellState.marketTrades?.slice(-20) || [],
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
      debug: {
        hasAnalysisInterval: autoSellState.analysisInterval !== null,
        walletCount: autoSellState.wallets?.length || 0,
        lastActivity: autoSellState.lastActivityTime || null,
        engineStartTime: autoSellState.engineStartTime || null,
      },
    })
  } catch (error) {
    console.error("Error getting auto-sell status:", error)
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}
