"use client"

import { useState, useCallback } from "react"
import { Connection, PublicKey } from "@solana/web3.js"

export interface TokenMetadata {
  mint: string
  name?: string
  symbol?: string
  description?: string
  image?: string
  decimals: number
  supply: number
  freezeAuthority?: string
  mintAuthority?: string
  updateAuthority?: string
}

export function useTokenMetadata() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getTokenMetadata = useCallback(async (mint: string): Promise<TokenMetadata | null> => {
    setLoading(true)
    setError(null)

    try {
      // Create connection with fallback RPC endpoints
      const rpcEndpoints = [
        process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
        "https://rpc.helius.xyz/?api-key=demo",
        "https://solana-mainnet.g.alchemy.com/v2/demo",
        "https://rpc.ankr.com/solana",
      ]

      let connection: Connection | null = null
      for (const endpoint of rpcEndpoints) {
        try {
          connection = new Connection(endpoint, { commitment: "confirmed" })
          await connection.getSlot() // Test connection
          break
        } catch (error) {
          continue
        }
      }

      if (!connection) {
        throw new Error("All RPC endpoints failed")
      }

      const mintPublicKey = new PublicKey(mint)

      // Get mint info
      const mintInfo = await connection.getParsedAccountInfo(mintPublicKey)

      if (!mintInfo.value) {
        throw new Error("Token mint not found")
      }

      const parsedData = mintInfo.value.data as any
      const decimals = parsedData.parsed?.info?.decimals || 0
      const supply = parsedData.parsed?.info?.supply || 0
      const freezeAuthority = parsedData.parsed?.info?.freezeAuthority
      const mintAuthority = parsedData.parsed?.info?.mintAuthority

      // Try to get metadata from multiple sources
      let metadata: any = null

      // Try Metaplex metadata
      try {
        const metadataResponse = await fetch(`https://api.metaplex.com/v1/metadata/${mint}`)
        if (metadataResponse.ok) {
          metadata = await metadataResponse.json()
        }
      } catch (err) {
        // Continue to next source
      }

      // Try Jupiter metadata API
      if (!metadata) {
        try {
          const jupiterResponse = await fetch(`https://token.jup.ag/strict/${mint}`)
          if (jupiterResponse.ok) {
            metadata = await jupiterResponse.json()
          }
        } catch (err) {
          // Continue to next source
        }
      }

      // Try Solana token list
      if (!metadata) {
        try {
          const tokenListResponse = await fetch(
            "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json",
          )
          if (tokenListResponse.ok) {
            const tokenList = await tokenListResponse.json()
            metadata = tokenList.tokens.find((token: any) => token.address === mint)
          }
        } catch (err) {
          // Continue
        }
      }

      return {
        mint,
        name: metadata?.name || metadata?.symbol || "Unknown Token",
        symbol: metadata?.symbol || "UNKNOWN",
        description: metadata?.description,
        image: metadata?.logoURI || metadata?.image,
        decimals,
        supply: supply / Math.pow(10, decimals),
        freezeAuthority,
        mintAuthority,
        updateAuthority: metadata?.updateAuthority,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch token metadata"
      setError(errorMessage)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getTokenMetadata,
  }
}
