import "./globals.css"
import type { ReactNode } from "react"
import { ErrorBoundary } from "@/components/ErrorBoundary"

export const metadata = {
  title: "Solana Auto-Sell Bot",
  description: "Market momentum auto-sell system for Solana tokens",
  generator: "v0.dev",
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
