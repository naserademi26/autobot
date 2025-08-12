"use client"

import { useState, useCallback } from "react"
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js"
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token"
import type { WalletInfo } from "@/hooks/useWalletManager"
import { sendAndConfirmTransaction } from "@solana/web3.js"

export interface TransferOperation {
  id: string
  fromWallet: string
  toAddress: string
  amount: number
  status: "pending" | "success" | "failed"
  signature?: string
  error?: string
  timestamp: Date
}

export function useWalletTransfer() {
  const [operations, setOperations] = useState<TransferOperation[]>([])
  const [isTransferring, setIsTransferring] = useState(false)

  const addOperation = useCallback((operation: Omit<TransferOperation, "id" | "timestamp">) => {
    const newOperation: TransferOperation = {
      ...operation,
      id: Date.now().toString(),
      timestamp: new Date(),
    }
    setOperations((prev) => [newOperation, ...prev])
    return newOperation.id
  }, [])

  const updateOperation = useCallback((id: string, updates: Partial<TransferOperation>) => {
    setOperations((prev) => prev.map((op) => (op.id === id ? { ...op, ...updates } : op)))
  }, [])

  const getConnection = useCallback(async () => {
    const rpcEndpoints = [
      process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com",
      "https://rpc.helius.xyz/?api-key=demo",
      "https://solana-mainnet.g.alchemy.com/v2/demo",
      "https://rpc.ankr.com/solana",
    ]

    let connection: Connection | null = null
    let lastError: Error | null = null

    // Try each RPC endpoint
    for (const endpoint of rpcEndpoints) {
      try {
        connection = new Connection(endpoint, { commitment: "confirmed" })
        const slot = await connection.getSlot() // Test connection
        if (slot) {
          break
        }
      } catch (error) {
        lastError = error as Error
      }
    }

    if (!connection) {
      throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message}`)
    }

    return connection
  }, [])

  const transferSOL = useCallback(
    async (fromPrivateKey: string, toAddress: string, amount: number, walletName: string) => {
      const operationId = addOperation({
        fromWallet: walletName,
        toAddress,
        amount,
        status: "pending",
      })

      try {
        const connection = await getConnection()

        // Create keypair from private key
        const fromKeypair = Keypair.fromSecretKey(new Uint8Array(fromPrivateKey.split(",").map(Number)))

        // Create destination public key
        const toPublicKey = new PublicKey(toAddress)

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash()

        // Create transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: fromKeypair.publicKey,
            toPubkey: toPublicKey,
            lamports: amount * LAMPORTS_PER_SOL,
          }),
        )

        transaction.recentBlockhash = blockhash
        transaction.feePayer = fromKeypair.publicKey

        // Sign and send transaction
        transaction.sign(fromKeypair)
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        })

        // Confirm transaction
        await connection.confirmTransaction(signature, "confirmed")

        updateOperation(operationId, {
          status: "success",
          signature,
        })

        return { success: true, signature }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Transfer failed"
        updateOperation(operationId, {
          status: "failed",
          error: errorMessage,
        })

        return { success: false, error: errorMessage }
      }
    },
    [addOperation, updateOperation, getConnection],
  )

  const bulkTransferSOL = useCallback(
    async (wallets: Array<{ privateKey: string; name: string }>, toAddress: string, amount: number) => {
      setIsTransferring(true)
      const results = []

      try {
        // Execute transfers with staggered delays
        for (let i = 0; i < wallets.length; i++) {
          const wallet = wallets[i]

          // Add random delay between transfers (2-5 seconds)
          if (i > 0) {
            const delay = Math.random() * 3000 + 2000
            await new Promise((resolve) => setTimeout(resolve, delay))
          }

          const result = await transferSOL(wallet.privateKey, toAddress, amount, wallet.name)

          results.push({
            wallet: wallet.name,
            ...result,
          })
        }

        return results
      } finally {
        setIsTransferring(false)
      }
    },
    [transferSOL],
  )

  const clearOperations = useCallback(() => {
    setOperations([])
  }, [])

  const transferToken = useCallback(
    async (fromWallet: WalletInfo, toAddress: string, tokenMint: string, amount: number) => {
      if (!fromWallet.publicKey || !fromWallet.keypair) {
        throw new Error("Wallet not properly connected")
      }

      setIsTransferring(true)
      try {
        const connection = await getConnection()
        const mintPublicKey = new PublicKey(tokenMint)
        const toPublicKey = new PublicKey(toAddress)

        // Get associated token addresses
        const fromTokenAccount = await getAssociatedTokenAddress(mintPublicKey, fromWallet.publicKey)
        const toTokenAccount = await getAssociatedTokenAddress(mintPublicKey, toPublicKey)

        const transaction = new Transaction()

        // Check if destination token account exists
        try {
          await getAccount(connection, toTokenAccount)
        } catch (error) {
          // Account doesn't exist, create it
          transaction.add(
            createAssociatedTokenAccountInstruction(
              fromWallet.publicKey, // payer
              toTokenAccount, // associated token account
              toPublicKey, // owner
              mintPublicKey, // mint
            ),
          )
        }

        // Get token decimals (assume 6 for most tokens, but should be fetched)
        const decimals = 6 // This should be fetched from mint info
        const transferAmount = amount * Math.pow(10, decimals)

        // Add transfer instruction
        transaction.add(
          createTransferInstruction(
            fromTokenAccount, // source
            toTokenAccount, // destination
            fromWallet.publicKey, // owner
            transferAmount, // amount
          ),
        )

        if (fromWallet.connectionType === "private_key" && fromWallet.keypair) {
          // Use private key to sign and send
          const signature = await sendAndConfirmTransaction(connection, transaction, [fromWallet.keypair], {
            commitment: "confirmed",
          })

          console.log(`✅ Token transfer successful: ${signature}`)
          return signature
        } else {
          throw new Error("Only private key wallets supported for transfers currently")
        }
      } catch (error) {
        console.error("Token transfer failed:", error)
        throw error
      } finally {
        setIsTransferring(false)
      }
    },
    [getConnection],
  )

  const consolidateSOL = useCallback(
    async (sourceWallets: WalletInfo[], destinationAddress: string) => {
      setIsTransferring(true)
      try {
        const connection = await getConnection()
        const results = []

        for (const wallet of sourceWallets) {
          if (!wallet.publicKey || !wallet.keypair || wallet.balance <= 0.001) {
            continue // Skip wallets without keys or insufficient balance
          }

          try {
            // Leave 0.001 SOL for future transactions
            const transferAmount = Math.max(0, wallet.balance - 0.001)

            if (transferAmount <= 0) {
              console.log(`Skipping ${wallet.name} - insufficient balance after fees`)
              continue
            }

            const transaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: new PublicKey(destinationAddress),
                lamports: transferAmount * LAMPORTS_PER_SOL,
              }),
            )

            const signature = await sendAndConfirmTransaction(connection, transaction, [wallet.keypair], {
              commitment: "confirmed",
            })

            console.log(`✅ Consolidated ${transferAmount.toFixed(4)} SOL from ${wallet.name}: ${signature}`)
            results.push({ wallet: wallet.name, success: true, amount: transferAmount, signature })

            // Small delay between transfers
            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (error) {
            console.error(`Failed to consolidate from ${wallet.name}:`, error)
            results.push({ wallet: wallet.name, success: false, error: error.message })
          }
        }

        return results
      } catch (error) {
        console.error("Consolidation failed:", error)
        throw error
      } finally {
        setIsTransferring(false)
      }
    },
    [getConnection],
  )

  const consolidateTokens = useCallback(
    async (sourceWallets: WalletInfo[], destinationAddress: string, tokenMint: string) => {
      setIsTransferring(true)
      try {
        const connection = await getConnection()
        const mintPublicKey = new PublicKey(tokenMint)
        const destinationPublicKey = new PublicKey(destinationAddress)
        const results = []

        // Get destination token account
        const destinationTokenAccount = await getAssociatedTokenAddress(mintPublicKey, destinationPublicKey)

        // Check if destination token account exists, create if not
        try {
          await getAccount(connection, destinationTokenAccount)
        } catch (error) {
          // Create destination token account first
          const createAccountTx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              sourceWallets[0].publicKey!, // Use first wallet as payer
              destinationTokenAccount,
              destinationPublicKey,
              mintPublicKey,
            ),
          )

          if (sourceWallets[0].keypair) {
            await sendAndConfirmTransaction(connection, createAccountTx, [sourceWallets[0].keypair], {
              commitment: "confirmed",
            })
            console.log("✅ Created destination token account")
          }
        }

        for (const wallet of sourceWallets) {
          if (!wallet.publicKey || !wallet.keypair || wallet.tokenBalance <= 0) {
            continue // Skip wallets without keys or tokens
          }

          try {
            const fromTokenAccount = await getAssociatedTokenAddress(mintPublicKey, wallet.publicKey)

            // Get actual token balance
            const tokenAccount = await getAccount(connection, fromTokenAccount)
            const tokenBalance = Number(tokenAccount.amount)

            if (tokenBalance <= 0) {
              console.log(`Skipping ${wallet.name} - no tokens`)
              continue
            }

            const transaction = new Transaction().add(
              createTransferInstruction(
                fromTokenAccount, // source
                destinationTokenAccount, // destination
                wallet.publicKey, // owner
                tokenBalance, // transfer all tokens
              ),
            )

            const signature = await sendAndConfirmTransaction(connection, transaction, [wallet.keypair], {
              commitment: "confirmed",
            })

            const humanReadableAmount = tokenBalance / Math.pow(10, 6) // Assume 6 decimals
            console.log(`✅ Consolidated ${humanReadableAmount.toFixed(2)} tokens from ${wallet.name}: ${signature}`)
            results.push({ wallet: wallet.name, success: true, amount: humanReadableAmount, signature })

            // Small delay between transfers
            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (error) {
            console.error(`Failed to consolidate tokens from ${wallet.name}:`, error)
            results.push({ wallet: wallet.name, success: false, error: error.message })
          }
        }

        return results
      } catch (error) {
        console.error("Token consolidation failed:", error)
        throw error
      } finally {
        setIsTransferring(false)
      }
    },
    [getConnection],
  )

  return {
    operations,
    isTransferring,
    transferSOL,
    bulkTransferSOL,
    clearOperations,
    transferToken,
    consolidateSOL,
    consolidateTokens,
  }
}
