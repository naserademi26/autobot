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
      try {
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

            const metrics = {
              buyVolumeUsd: autoSellState?.metrics?.buyVolumeUsd || 0,
              sellVolumeUsd: autoSellState?.metrics?.sellVolumeUsd || 0,
              netUsdFlow: autoSellState?.metrics?.netUsdFlow || 0,
              currentPrice: autoSellState?.metrics?.currentPrice || 0,
              currentPriceUsd: autoSellState?.metrics?.currentPriceUsd || 0,
              isRunning: autoSellState?.isRunning || false,
              timestamp: Date.now(),
            }

            const updateEvent = `event: update\ndata: ${JSON.stringify(metrics)}\n\n`
            controller.enqueue(encoder.encode(updateEvent))

            // Send keep-alive ping every 10 seconds
            if (Date.now() % 10000 < 2000) {
              const pingEvent = `event: ping\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
              controller.enqueue(encoder.encode(pingEvent))
            }
          } catch (error) {
            console.error("Stream update error:", error)
            // Don't close the stream on individual update errors
          }
        }, 2000)

        // Cleanup on close
        const cleanup = () => {
          clearInterval(interval)
          try {
            controller.close()
          } catch (e) {
            // Stream already closed
          }
        }

        req.signal.addEventListener("abort", cleanup)

        // Auto-cleanup after 5 minutes to prevent memory leaks
        setTimeout(cleanup, 5 * 60 * 1000)
      } catch (error) {
        console.error("Stream start error:", error)
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Cache-Control",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
