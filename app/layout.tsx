import "./globals.css"
import type { ReactNode } from "react"

if (typeof process !== "undefined") {
  process.on("uncaughtException", (err: any) => {
    if (err?.code === "ECONNRESET" || err?.name === "AbortError" || err?.code === "ENOTFOUND") {
      console.log(`[IGNORED] ${err?.code || err?.name}: ${err?.message || "Network error"}`)
      return
    }
    console.error("[uncaughtException]", err?.message || err)
  })

  process.on("unhandledRejection", (err: any) => {
    const e: any = err
    if (e?.code === "ECONNRESET" || e?.name === "AbortError" || e?.code === "ENOTFOUND") {
      console.log(`[IGNORED] ${e?.code || e?.name}: ${e?.message || "Network error"}`)
      return
    }
    console.error("[unhandledRejection]", err?.message || err)
  })

  process.on("SIGTERM", () => {
    console.log("[SIGTERM] Graceful shutdown initiated")
    // Clear any global intervals
    if ((global as any).autoSellState?.intervals) {
      ;(global as any).autoSellState.intervals.forEach((interval: NodeJS.Timeout) => clearInterval(interval))
    }
    process.exit(0)
  })
}

export const metadata = {
  title: "Solana Auto-Sell Bot",
  description: "Real-time Solana trading bot with auto-sell functionality",
  generator: "v0.dev",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
