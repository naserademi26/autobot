"use client"

import { useState, useCallback, useEffect } from "react"
import { Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js"
import bs58 from "bs58"

interface Wallet {
  id: string
  address: string
  privateKey: string
  balance: number
  isLoading: boolean
}

const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=785c7d18-85fe-4925-b949-50e533aec16e",
  "https://rpc.helius.xyz?api-key=785c7d18-85fe-4925-b949-50e533aec16e",
]

export function useRealWalletManager() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [connection, setConnection] = useState<Connection | null>(null)

  // Initialize connection
  useEffect(() => {
    const initConnection = async () => {
      try {
        const conn = new Connection(RPC_ENDPOINTS[0])
        await conn.getSlot()
        setConnection(conn)
        console.log("✅ Wallet manager connected to RPC")
      } catch (error) {
        try {
          const conn = new Connection(RPC_ENDPOINTS[1])
          await conn.getSlot()
          setConnection(conn)
          console.log("✅ Wallet manager connected to fallback RPC")
        } catch (fallbackError) {
          console.error("❌ Wallet manager RPC connection failed")
        }
      }
    }

    initConnection()
  }, [])

  const createKeypairFromPrivateKey = useCallback((privateKey: string): Keypair => {
    const cleanKey = privateKey.trim()

    if (cleanKey.includes(",")) {
      // Array format: "1,2,3,4..."
      const numbers = cleanKey.split(",").map((n) => {
        const num = Number.parseInt(n.trim())
        if (isNaN(num) || num < 0 || num > 255) {
          throw new Error(`Invalid number in private key array: ${n}`)
        }
        return num
      })

      if (numbers.length !== 64) {
        throw new Error(`Private key array must have 64 numbers, got ${numbers.length}`)
      }

      return Keypair.fromSecretKey(new Uint8Array(numbers))
    } else if (cleanKey.length === 128) {
      // Hex format
      const bytes = new Uint8Array(64)
      for (let i = 0; i < 64; i++) {
        const hexByte = cleanKey.substr(i * 2, 2)
        const byte = Number.parseInt(hexByte, 16)
        if (isNaN(byte)) {
          throw new Error(`Invalid hex byte at position ${i}: ${hexByte}`)
        }
        bytes[i] = byte
      }
      return Keypair.fromSecretKey(bytes)
    } else if (cleanKey.length >= 87 && cleanKey.length <= 88) {
      // Base58 format
      const decoded = bs58.decode(cleanKey)
      if (decoded.length !== 64) {
        throw new Error(`Decoded private key must be 64 bytes, got ${decoded.length}`)
      }
      return Keypair.fromSecretKey(decoded)
    } else {
      throw new Error(`Invalid private key format. Length: ${cleanKey.length}`)
    }
  }, [])

  const getWalletBalance = useCallback(
    async (publicKey: PublicKey): Promise<number> => {
      if (!connection) {
        throw new Error("No RPC connection available")
      }

      try {
        // Method 1: Direct getBalance
        const balanceLamports = await connection.getBalance(publicKey)
        return balanceLamports / LAMPORTS_PER_SOL
      } catch (error) {
        try {
          // Method 2: getAccountInfo fallback
          const accountInfo = await connection.getAccountInfo(publicKey)
          if (accountInfo) {
            return accountInfo.lamports / LAMPORTS_PER_SOL
          }
          return 0
        } catch (fallbackError) {
          // Method 3: Direct RPC call
          try {
            const response = await fetch(RPC_ENDPOINTS[0], {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "getBalance",
                params: [publicKey.toBase58()],
              }),
            })

            const data = await response.json()
            if (data.result && typeof data.result.value === "number") {
              return data.result.value / LAMPORTS_PER_SOL
            }
            return 0
          } catch (fetchError) {
            console.error("All balance methods failed:", fetchError)
            return 0
          }
        }
      }
    },
    [connection],
  )

  const addWallet = useCallback(
    async (privateKey: string) => {
      try {
        const keypair = createKeypairFromPrivateKey(privateKey)
        const address = keypair.publicKey.toBase58()

        // Check if wallet already exists
        const existingWallet = wallets.find((w) => w.address === address)
        if (existingWallet) {
          throw new Error("Wallet already imported")
        }

        const newWallet: Wallet = {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          address,
          privateKey,
          balance: 0,
          isLoading: true,
        }

        setWallets((prev) => [...prev, newWallet])

        // Fetch balance
        try {
          const balance = await getWalletBalance(keypair.publicKey)
          setWallets((prev) => prev.map((w) => (w.id === newWallet.id ? { ...w, balance, isLoading: false } : w)))
          console.log(`✅ Wallet added: ${address.slice(0, 8)}... (${balance.toFixed(4)} SOL)`)
        } catch (error) {
          setWallets((prev) => prev.map((w) => (w.id === newWallet.id ? { ...w, isLoading: false } : w)))
          console.error(`❌ Failed to fetch balance for ${address.slice(0, 8)}...`, error)
        }
      } catch (error) {
        console.error("Failed to add wallet:", error)
        throw error
      }
    },
    [wallets, createKeypairFromPrivateKey, getWalletBalance],
  )

  const removeWallet = useCallback((walletId: string) => {
    setWallets((prev) => prev.filter((w) => w.id !== walletId))
    console.log(`🗑️ Wallet removed: ${walletId}`)
  }, [])

  const clearWallets = useCallback(() => {
    setWallets([])
    console.log("🗑️ All wallets cleared")
  }, [])

  const refreshBalances = useCallback(async () => {
    if (wallets.length === 0 || !connection) return

    setIsLoading(true)
    console.log("🔄 Refreshing wallet balances...")

    // Set all wallets to loading state
    setWallets((prev) => prev.map((w) => ({ ...w, isLoading: true })))

    // Refresh balances for all wallets
    const refreshPromises = wallets.map(async (wallet) => {
      try {
        const keypair = createKeypairFromPrivateKey(wallet.privateKey)
        const balance = await getWalletBalance(keypair.publicKey)

        setWallets((prev) => prev.map((w) => (w.id === wallet.id ? { ...w, balance, isLoading: false } : w)))

        console.log(`✅ Balance updated: ${wallet.address.slice(0, 8)}... (${balance.toFixed(4)} SOL)`)
      } catch (error) {
        setWallets((prev) => prev.map((w) => (w.id === wallet.id ? { ...w, isLoading: false } : w)))
        console.error(`❌ Failed to refresh balance for ${wallet.address.slice(0, 8)}...`, error)
      }
    })

    await Promise.allSettled(refreshPromises)
    setIsLoading(false)
    console.log("✅ Balance refresh completed")
  }, [wallets, connection, createKeypairFromPrivateKey, getWalletBalance])

  return {
    wallets,
    isLoading,
    connection: !!connection,
    addWallet,
    removeWallet,
    clearWallets,
    refreshBalances,
  }
}
