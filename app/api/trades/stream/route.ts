export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"

function encoder(s: string) {
  return new TextEncoder().encode(s)
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || process.env.TOKEN_MINT!

  const stream = new ReadableStream({
    start: async (controller) => {
      // Send current auto-sell state as snapshot
      if (global.autoSellState) {
        controller.enqueue(
          encoder(
            `event: snapshot\ndata: ${JSON.stringify({
              buyVolumeUsd: global.autoSellState.metrics.buyVolumeUsd,
              sellVolumeUsd: global.autoSellState.metrics.sellVolumeUsd,
              netUsdFlow: global.autoSellState.metrics.netUsdFlow,
              currentPrice: global.autoSellState.metrics.currentPrice,
              isRunning: global.autoSellState.isRunning,
              transactionHistory: global.autoSellState.transactionHistory || [],
            })}\n\n`,
          ),
        )
      }

      // Keep connection alive and send updates
      const interval = setInterval(() => {
        if (global.autoSellState) {
          controller.enqueue(
            encoder(
              `event: update\ndata: ${JSON.stringify({
                buyVolumeUsd: global.autoSellState.metrics.buyVolumeUsd,
                sellVolumeUsd: global.autoSellState.metrics.sellVolumeUsd,
                netUsdFlow: global.autoSellState.metrics.netUsdFlow,
                currentPrice: global.autoSellState.metrics.currentPrice,
                lastSellTime: global.autoSellState.metrics.lastSellTime,
                totalSold: global.autoSellState.metrics.totalSold,
              })}\n\n`,
            ),
          )
        }

        // Keepalive ping
        controller.enqueue(encoder(`: ping ${Date.now()}\n\n`))
      }, 2000)

      return () => clearInterval(interval)
    },
    cancel() {},
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
