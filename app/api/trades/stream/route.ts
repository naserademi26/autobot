export const runtime = "edge"

import { type NextRequest, NextResponse } from "next/server"

const enc = (s: string) => new TextEncoder().encode(s)
const cors = (origin?: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
})

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { headers: cors(req.headers.get("origin")) })
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const mint = req.nextUrl.searchParams.get("mint")
  if (!mint) {
    return NextResponse.json({ ok: false, error: "mint required" }, { status: 400, headers: cors(origin) })
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  let redis: any = null

  if (redisUrl && redisToken) {
    try {
      const { Redis } = await import("@upstash/redis")
      redis = new Redis({ url: redisUrl, token: redisToken })
    } catch (error) {
      console.warn("Redis not available, using fallback:", error)
    }
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        controller.enqueue(
          enc(`event: connected\ndata: ${JSON.stringify({ status: "connected", mint, timestamp: Date.now() })}\n\n`),
        )

        let initialTrades: any[] = []
        if (redis) {
          try {
            const key = `trades:${mint}`
            const recent = await redis.lrange<string>(key, 0, 199)
            initialTrades = recent.map((t: string) => JSON.parse(t))
          } catch (error) {
            console.warn("Redis read failed, using empty snapshot:", error)
          }
        }

        controller.enqueue(enc(`event: snapshot\ndata: ${JSON.stringify(initialTrades)}\n\n`))

        let seen = initialTrades.length
        let lastPing = Date.now()

        const loop = async () => {
          try {
            while (true) {
              if (redis) {
                try {
                  const key = `trades:${mint}`
                  const next = await redis.lrange<string>(key, 0, 99)
                  if (next.length > seen) {
                    const diff = next.slice(0, next.length - seen).map((t: string) => JSON.parse(t))
                    controller.enqueue(enc(`event: trades\ndata: ${JSON.stringify(diff)}\n\n`))
                    seen = next.length
                  }
                } catch (error) {
                  console.warn("Redis polling error:", error)
                }
              }

              const now = Date.now()
              if (now - lastPing > 15000) {
                controller.enqueue(enc(`: ping ${now}\n\n`)) // keep-alive
                lastPing = now
              }
              await new Promise((r) => setTimeout(r, 900))
            }
          } catch (error) {
            console.error("Stream loop error:", error)
            controller.close()
          }
        }

        loop()
      } catch (error) {
        console.error("Stream start error:", error)
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
      ...cors(origin),
    },
  })
}
