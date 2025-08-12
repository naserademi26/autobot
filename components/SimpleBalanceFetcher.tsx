"use client"

import { useState } from "react"
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Wallet } from "lucide-react"

export function SimpleBalanceFetcher() {
  const [address, setAddress] = useState("")
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const fetchBalance = async () => {
    if (!address) return

    setLoading(true)
    setError("")
    setBalance(null)

    try {
      const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com")
      const publicKey = new PublicKey(address)
      const balanceInLamports = await connection.getBalance(publicKey)
      const balanceInSol = balanceInLamports / LAMPORTS_PER_SOL
      setBalance(balanceInSol)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch balance")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          Balance Checker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter wallet address..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="bg-white/10 border-gray-600 text-white"
          />
          <Button onClick={fetchBalance} disabled={loading || !address} className="bg-blue-600 hover:bg-blue-700">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
          </Button>
        </div>

        {balance !== null && <div className="text-green-400 font-mono">Balance: {balance.toFixed(4)} SOL</div>}

        {error && <div className="text-red-400 text-sm">Error: {error}</div>}
      </CardContent>
    </Card>
  )
}
