import { type NextRequest, NextResponse } from "next/server"
import { Connection, PublicKey } from "@solana/web3.js"
import { getAssociatedTokenAddress } from "@solana/spl-token"

const connection = new Connection(
  process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
    "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  { commitment: "confirmed" },
)

export async function POST(request: NextRequest) {
  try {
    const { mint, wallets } = await request.json()

    if (!mint || !wallets?.length) {
      return NextResponse.json({ error: "Missing mint or wallets" }, { status: 400 })
    }

    const balances: Record<string, number> = {}
    const mintPubkey = new PublicKey(mint)

    // Process wallets in chunks to avoid rate limits
    const chunkSize = 50
    for (let i = 0; i < wallets.length; i += chunkSize) {
      const chunk = wallets.slice(i, i + chunkSize)

      const promises = chunk.map(async (wallet: string) => {
        try {
          const walletPubkey = new PublicKey(wallet)
          const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey)
          const balance = await connection.getTokenAccountBalance(ata)
          return { wallet, balance: balance.value.uiAmount || 0 }
        } catch {
          return { wallet, balance: 0 }
        }
      })

      const results = await Promise.all(promises)
      results.forEach(({ wallet, balance }) => {
        balances[wallet] = balance
      })
    }

    return NextResponse.json({ balances })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
