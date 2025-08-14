import "./globals.css"
import type { ReactNode } from "react"

export const metadata = {
  title: "Solana Sniper 65",
  description: "Multi-wallet sniper with smooth UI",
    generator: 'v0.dev'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
