"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { Connection } from "@solana/web3.js"

// Premium Helius RPC endpoints with updated API key
export const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://rpc.helius.xyz/?api-key=13b641b3-c9e5-4c63-98ae-5def3800fa0e",
  "https://api.mainnet-beta.solana.com",
  "https://solana-api.projectserum.com",
  "https://rpc.ankr.com/solana",
]

interface WalletContextType {
  connection: Connection
  currentRPC: string
  switchRPC: (rpcUrl: string) => void
  getFastestConnection: () => Connection
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [currentRPC, setCurrentRPC] = useState(RPC_ENDPOINTS[0])
  const [connection, setConnection] = useState(
    () =>
      new Connection(RPC_ENDPOINTS[0], {
        commitment: "processed",
        confirmTransactionInitialTimeout: 8000,
        wsEndpoint: undefined,
        disableRetryOnRateLimit: false,
        httpHeaders: {
          "Content-Type": "application/json",
          "User-Agent": "PumpFunSniperBot/4.0",
          "Cache-Control": "no-cache",
        },
      }),
  )

  const switchRPC = useCallback((rpcUrl: string) => {
    console.log(`🔄 Switching to RPC: ${rpcUrl}`)
    const newConnection = new Connection(rpcUrl, {
      commitment: "processed",
      confirmTransactionInitialTimeout: 8000,
      wsEndpoint: undefined,
      disableRetryOnRateLimit: false,
      httpHeaders: {
        "Content-Type": "application/json",
        "User-Agent": "PumpFunSniperBot/4.0",
        "Cache-Control": "no-cache",
      },
    })
    setConnection(newConnection)
    setCurrentRPC(rpcUrl)
  }, [])

  const getFastestConnection = useCallback(() => {
    return new Connection(RPC_ENDPOINTS[0], {
      commitment: "processed",
      confirmTransactionInitialTimeout: 6000,
      wsEndpoint: undefined,
      disableRetryOnRateLimit: false,
      httpHeaders: {
        "Content-Type": "application/json",
        "User-Agent": "PumpFunSniperBot/4.0",
        "Cache-Control": "no-cache",
      },
    })
  }, [])

  return (
    <WalletContext.Provider value={{ connection, currentRPC, switchRPC, getFastestConnection }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
