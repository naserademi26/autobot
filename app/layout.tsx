import "./globals.css"
import type { ReactNode } from "react"
import { ErrorBoundary } from "@/components/ErrorBoundary"

export const metadata = {
  title: "Solana Auto-Sell Bot",
  description: "Market momentum auto-sell system for Solana tokens",
  generator: "v0.dev",
}

if (typeof window === "undefined") {
  // Server-side error handling
  process.on("uncaughtException", (error) => {
    console.error("Global uncaught exception:", error)
    // Don't exit in production, just log
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Global unhandled rejection at:", promise, "reason:", reason)
    // Don't exit in production, just log
  })
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  )
}
