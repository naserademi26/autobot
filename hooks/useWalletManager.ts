"use client"

import { useState, useCallback, useEffect } from "react"
import { Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { useToast } from "@/hooks/use-toast"

export interface WalletData {
  id: string
  name: string
  publicKey: string
  privateKey: string
  balance: number
  tokenBalance: number
  connected: boolean
  isLoading: boolean
}

export interface ImportProgress {
  current: number
  total: number
  status: "idle" | "importing" | "complete"
}

const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=785c7d18-85fe-4925-b949-50e533aec16e",
  "https://rpc.helius.xyz?api-key=785c7d18-85fe-4925-b949-50e533aec16e",
  "https://api.mainnet-beta.solana.com",
]

export function useWalletManager() {
  const [wallets, setWallets] = useState<WalletData[]>([])
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [connection, setConnection] = useState<Connection | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    current: 0,
    total: 0,
    status: "idle",
  })
  const { toast } = useToast()

  // Initialize connection
  useEffect(() => {
    const initConnection = async () => {
      try {
        const conn = new Connection(RPC_ENDPOINTS[0], {
          commitment: "processed",
          confirmTransactionInitialTimeout: 30000,
        })
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
        const balanceLamports = await connection.getBalance(publicKey)
        return balanceLamports / LAMPORTS_PER_SOL
      } catch (error) {
        console.error("Balance fetch failed:", error)
        return 0
      }
    },
    [connection],
  )

  const addWallet = useCallback(
    async (privateKey: string, customName?: string) => {
      try {
        const keypair = createKeypairFromPrivateKey(privateKey)
        const publicKey = keypair.publicKey.toBase58()

        // Check if wallet already exists
        const existingWallet = wallets.find((w) => w.publicKey === publicKey)
        if (existingWallet) {
          throw new Error("Wallet already imported")
        }

        const walletId = `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const walletName = customName || `Wallet ${wallets.length + 1}`

        const newWallet: WalletData = {
          id: walletId,
          name: walletName,
          publicKey,
          privateKey,
          balance: 0,
          tokenBalance: 0,
          connected: true,
          isLoading: true,
        }

        setWallets((prev) => [...prev, newWallet])

        // Fetch balance
        try {
          const balance = await getWalletBalance(keypair.publicKey)
          setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, balance, isLoading: false } : w)))
          console.log(`✅ Wallet added: ${publicKey.slice(0, 8)}... (${balance.toFixed(4)} SOL)`)
        } catch (error) {
          setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, isLoading: false } : w)))
          console.error(`❌ Failed to fetch balance for ${publicKey.slice(0, 8)}...`, error)
        }

        return walletId
      } catch (error) {
        console.error("Failed to add wallet:", error)
        throw error
      }
    },
    [wallets, createKeypairFromPrivateKey, getWalletBalance],
  )

  const importMultipleWallets = useCallback(
    async (privateKeys: string[]) => {
      if (privateKeys.length === 0) return

      console.log(`🚀 INSTANT IMPORT: Starting ${privateKeys.length} wallets simultaneously`)
      setImportProgress({ current: 0, total: privateKeys.length, status: "importing" })

      const startTime = Date.now()

      try {
        // Process ALL wallets simultaneously with Promise.all()
        const importPromises = privateKeys.map(async (privateKey, index) => {
          try {
            const keypair = createKeypairFromPrivateKey(privateKey.trim())
            const publicKey = keypair.publicKey.toBase58()

            // Check if wallet already exists
            const existingWallet = wallets.find((w) => w.publicKey === publicKey)
            if (existingWallet) {
              console.log(`⚠️ Wallet ${index + 1}/${privateKeys.length}: Already exists`)
              return null
            }

            const walletId = `wallet-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`
            const walletName = `Wallet ${index + 1}`

            // Get balance simultaneously
            let balance = 0
            try {
              if (connection) {
                balance = await getWalletBalance(keypair.publicKey)
              }
            } catch (error) {
              console.error(`❌ Balance fetch failed for wallet ${index + 1}`)
            }

            const newWallet: WalletData = {
              id: walletId,
              name: walletName,
              publicKey,
              privateKey: privateKey.trim(),
              balance,
              tokenBalance: 0,
              connected: true,
              isLoading: false,
            }

            console.log(
              `✅ Wallet ${index + 1}/${privateKeys.length}: ${publicKey.slice(0, 8)}... (${balance.toFixed(4)} SOL)`,
            )
            return newWallet
          } catch (error) {
            console.error(`❌ Wallet ${index + 1}/${privateKeys.length}: Import failed -`, error)
            return null
          }
        })

        // Execute ALL imports simultaneously
        const importedWallets = await Promise.all(importPromises)
        const validWallets = importedWallets.filter((wallet): wallet is WalletData => wallet !== null)

        // Add all valid wallets at once
        setWallets((prev) => [...prev, ...validWallets])

        // Auto-select all newly imported wallets
        const newWalletIds = validWallets.map((w) => w.id)
        setSelectedWallets((prev) => [...prev, ...newWalletIds])

        const endTime = Date.now()
        const totalTime = endTime - startTime

        console.log(`🎯 INSTANT IMPORT COMPLETE:`)
        console.log(`   ✅ ${validWallets.length} wallets imported successfully`)
        console.log(`   ❌ ${privateKeys.length - validWallets.length} failed imports`)
        console.log(`   ⚡ Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`)
        console.log(`   🚀 Average per wallet: ${(totalTime / privateKeys.length).toFixed(0)}ms`)
        console.log(`   🔥 ALL WALLETS PROCESSED SIMULTANEOUSLY WITH Promise.all()!`)

        setImportProgress({ current: validWallets.length, total: privateKeys.length, status: "complete" })

        toast({
          title: "🚀 Instant Import Complete!",
          description: `✅ ${validWallets.length} wallets imported in ${(totalTime / 1000).toFixed(2)}s`,
        })

        // Reset progress after 3 seconds
        setTimeout(() => {
          setImportProgress({ current: 0, total: 0, status: "idle" })
        }, 3000)

        return validWallets.length
      } catch (error) {
        console.error("❌ Bulk import failed:", error)
        setImportProgress({ current: 0, total: 0, status: "idle" })
        toast({
          title: "❌ Import Failed",
          description: "An error occurred during bulk import",
          variant: "destructive",
        })
        throw error
      }
    },
    [wallets, createKeypairFromPrivateKey, getWalletBalance, connection, toast],
  )

  const removeWallet = useCallback((walletId: string) => {
    setWallets((prev) => prev.filter((w) => w.id !== walletId))
    setSelectedWallets((prev) => prev.filter((id) => id !== walletId))
    console.log(`🗑️ Wallet removed: ${walletId}`)
  }, [])

  const clearWallets = useCallback(() => {
    setWallets([])
    setSelectedWallets([])
    console.log("🗑️ All wallets cleared")
  }, [])

  const toggleWalletSelection = useCallback((walletId: string) => {
    setSelectedWallets((prev) => (prev.includes(walletId) ? prev.filter((id) => id !== walletId) : [...prev, walletId]))
  }, [])

  const selectAllWallets = useCallback(() => {
    const connectedWalletIds = wallets.filter((w) => w.connected).map((w) => w.id)
    setSelectedWallets(connectedWalletIds)
  }, [wallets])

  const deselectAllWallets = useCallback(() => {
    setSelectedWallets([])
  }, [])

  const refreshBalances = useCallback(async () => {
    if (wallets.length === 0 || !connection) return

    console.log("🔄 Refreshing wallet balances...")
    setWallets((prev) => prev.map((w) => ({ ...w, isLoading: true })))

    const refreshPromises = wallets.map(async (wallet) => {
      try {
        const keypair = createKeypairFromPrivateKey(wallet.privateKey)
        const balance = await getWalletBalance(keypair.publicKey)

        setWallets((prev) => prev.map((w) => (w.id === wallet.id ? { ...w, balance, isLoading: false } : w)))

        console.log(`✅ Balance updated: ${wallet.publicKey.slice(0, 8)}... (${balance.toFixed(4)} SOL)`)
      } catch (error) {
        setWallets((prev) => prev.map((w) => (w.id === wallet.id ? { ...w, isLoading: false } : w)))
        console.error(`❌ Failed to refresh balance for ${wallet.publicKey.slice(0, 8)}...`, error)
      }
    })

    await Promise.allSettled(refreshPromises)
    console.log("✅ Balance refresh completed")
  }, [wallets, connection, createKeypairFromPrivateKey, getWalletBalance])

  return {
    wallets,
    selectedWallets,
    connection: !!connection,
    importProgress,
    addWallet,
    importMultipleWallets,
    removeWallet,
    clearWallets,
    toggleWalletSelection,
    selectAllWallets,
    deselectAllWallets,
    refreshBalances,
  }
}
