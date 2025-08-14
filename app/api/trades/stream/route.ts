export const runtime = "nodejs"

import type { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint")

  if (!mint) {
    return new Response("mint parameter required", { status: 400 })
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const send = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(new TextEncoder().encode(message))
      }

      // Send connection confirmation
      send("connected", {
        status: "connected",
        mint,
        timestamp: Date.now(),
      })

      // Send empty initial snapshot
      send("snapshot", [])

      // Send periodic updates with mock data for testing
      const interval = setInterval(() => {
        try {
          send("update", {
            buyVolume: 0,
            sellVolume: 0,
            netFlow: 0,
            timestamp: Date.now(),
          })
        } catch (error) {
          console.error("Stream update error:", error)
          clearInterval(interval)
          controller.close()
        }
      }, 2000)

      // Cleanup on close
      return () => {
        clearInterval(interval)
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
