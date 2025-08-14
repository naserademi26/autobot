export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"

function encoder(s: string) {
  return new TextEncoder().encode(s)
}

let redis: any = null
async function getRedis() {
  if (!redis) {
    try {
      const { Redis } = await import("@upstash/redis")
      redis = Redis.fromEnv()
    } catch (error) {
      console.warn("Redis not available:", error)
      return null
    }
  }
  return redis
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || process.env.TOKEN_MINT!
  const redisClient = await getRedis()

  const stream = new ReadableStream({
    start: async (controller) => {
      if (redisClient) {
        try {
          const recentTrades = await redisClient.lrange(`trades:${mint}`, 0, 19) // Last 20 trades
          const trades = recentTrades.map((trade: string) => JSON.parse(trade))

          controller.enqueue(encoder(`event: trades\ndata: ${JSON.stringify(trades)}\n\n`))
        } catch (error) {
          console.warn("Failed to fetch recent trades:", error)
        }
      }

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

      const interval = setInterval(async () => {
        // Send updated metrics
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

        if (redisClient) {
          try {
            const latestTrades = await redisClient.lrange(`trades:${mint}`, 0, 4) // Last 5 trades
            if (latestTrades.length > 0) {
              const trades = latestTrades.map((trade: string) => JSON.parse(trade))
              controller.enqueue(encoder(`event: newTrades\ndata: ${JSON.stringify(trades)}\n\n`))
            }
          } catch (error) {
            console.warn("Failed to fetch latest trades:", error)
          }
        }

        // Keepalive ping
        controller.enqueue(encoder(`: ping ${Date.now()}\n\n`))
      }, 1000) // Reduced interval to 1 second for more responsive updates

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
