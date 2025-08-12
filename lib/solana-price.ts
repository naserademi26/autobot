import { Connection, PublicKey } from "@solana/web3.js"
import { getMint } from "@solana/spl-token"

const JUP_URL = "https://quote-api.jup.ag/v6/quote"
const QUOTE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC

export function getConnection(): Connection {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com"
  return new Connection(rpc, "confirmed")
}

export async function getMintDecimals(mintAddress: string): Promise<number> {
  const conn = getConnection()
  const mint = await getMint(conn, new PublicKey(mintAddress))
  return mint.decimals
}

export async function getTokenUsdPrice(mintAddress: string): Promise<number> {
  try {
    const decimals = await getMintDecimals(mintAddress)
    const inAmount = 1 * 10 ** decimals // 1 whole token

    const url = `${JUP_URL}?inputMint=${mintAddress}&outputMint=${QUOTE_MINT}&amount=${inAmount}&slippageBps=50`
    const res = await fetch(url, { cache: "no-store" })

    if (!res.ok) return 0

    const data = await res.json()
    const route = data?.data?.[0]
    if (!route) return 0

    const outAmount = Number(route.outAmount)
    const price = outAmount / 1_000_000 // USDC has 6 decimals
    return price
  } catch (error) {
    console.error("Error fetching token price:", error)
    return 0
  }
}
