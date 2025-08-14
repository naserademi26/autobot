export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint")

  if (!mint) {
    return NextResponse.json({ error: "mint parameter required" }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connectEvent = `event: connected\ndata: ${JSON.stringify({ status: "connected", mint })}\n\n`
      controller.enqueue(encoder.encode(connectEvent))

      // Send initial snapshot
      const snapshotEvent = `event: snapshot\ndata: ${JSON.stringify([])}\n\n`
      controller.enqueue(encoder.encode(snapshotEvent))

      // Send periodic updates
      const interval = setInterval(() => {
        try {
          // Get current auto-sell state if available
          const autoSellState = (global as any).autoSellState

          if (autoSellState && autoSellState.metrics) {
            const updateEvent = `event: update\ndata: ${JSON.stringify({
              buyVolumeUsd: autoSellState.metrics.buyVolumeUsd || 0,
              sellVolumeUsd: autoSellState.metrics.sellVolumeUsd || 0,
              netUsdFlow: autoSellState.metrics.netUsdFlow || 0,
              currentPrice: autoSellState.metrics.currentPrice || 0,
              currentPriceUsd: autoSellState.metrics.currentPriceUsd || 0,
              isRunning: autoSellState.isRunning || false,
              timestamp: Date.now(),
            })}\n\n`
            controller.enqueue(encoder.encode(updateEvent))
          }

          // Send keep-alive ping
          const pingEvent = `event: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
          controller.enqueue(encoder.encode(pingEvent))
        } catch (error) {
          console.error("Stream error:", error)
        }
      }, 2000)

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  })
}
