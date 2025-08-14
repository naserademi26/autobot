import "./globals.css"
import type { ReactNode } from "react"

if (typeof process !== "undefined") {
  process.on("uncaughtException", (err: any) => {
    if (err?.code === "ECONNRESET" || err?.name === "AbortError") {
      // Ignore harmless connection resets common in serverless environments
      return
    }
    console.error("[uncaughtException]", err)
  })

  process.on("unhandledRejection", (err: any) => {
    const e: any = err
    if (e?.code === "ECONNRESET" || e?.name === "AbortError") {
      // Ignore harmless connection resets
      return
    }
    console.error("[unhandledRejection]", err)
  })
}

export const metadata = {
  title: "Solana Sniper 65",
  description: "Multi-wallet sniper with smooth UI",
  generator: "v0.dev",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
