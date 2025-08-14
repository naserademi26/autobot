"use client"
import { useEffect, useState } from "react"

export type Trade = {
  sig: string
  ts: number
  side: "buy" | "sell"
  tokenAmount: number
  usd: number
  wallet?: string
  mint: string
}

export function useTradeStream(mint: string) {
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    if (!mint) return

    const es = new EventSource(`/api/trades/stream?mint=${mint}`)

    es.addEventListener("snapshot", (e: MessageEvent) => {
      setTrades(JSON.parse(e.data))
    })

    es.addEventListener("trades", (e: MessageEvent) => {
      const arr: Trade[] = JSON.parse(e.data)
      setTrades((prev) => [...arr, ...prev].slice(0, 500))
    })

    es.onerror = () => es.close()
    return () => es.close()
  }, [mint])

  return trades
}
