"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRightLeft, Send } from "lucide-react"

interface TransferPanelProps {
  walletManager: any
}

export function TransferPanel({ walletManager }: TransferPanelProps) {
  const [fromWallet, setFromWallet] = useState("")
  const [toWallet, setToWallet] = useState("")
  const [amount, setAmount] = useState("")
  const [transferType, setTransferType] = useState("sol")

  const connectedWallets = walletManager.wallets.filter((w: any) => w.connected)

  const handleTransfer = async () => {
    console.log("Transfer:", { fromWallet, toWallet, amount, transferType })
    // Implementation would go here
  }

  return (
    <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5" />
          Bulk Transfer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-white">From Wallet</Label>
            <Select value={fromWallet} onValueChange={setFromWallet}>
              <SelectTrigger className="bg-black/30 border-gray-600 text-white">
                <SelectValue placeholder="Select source wallet" />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                {connectedWallets.map((wallet: any) => (
                  <SelectItem key={wallet.id} value={wallet.id} className="text-white">
                    {wallet.name} ({wallet.balance.toFixed(3)} SOL)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-white">To Wallet</Label>
            <Select value={toWallet} onValueChange={setToWallet}>
              <SelectTrigger className="bg-black/30 border-gray-600 text-white">
                <SelectValue placeholder="Select destination wallet" />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                {connectedWallets.map((wallet: any) => (
                  <SelectItem key={wallet.id} value={wallet.id} className="text-white">
                    {wallet.name} ({wallet.balance.toFixed(3)} SOL)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-white">Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="bg-black/30 border-gray-600 text-white"
            />
          </div>
          <div>
            <Label className="text-white">Transfer Type</Label>
            <Select value={transferType} onValueChange={setTransferType}>
              <SelectTrigger className="bg-black/30 border-gray-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="sol" className="text-white">
                  SOL
                </SelectItem>
                <SelectItem value="token" className="text-white">
                  Token
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleTransfer}
          disabled={!fromWallet || !toWallet || !amount}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold h-12"
        >
          <Send className="w-5 h-5 mr-2" />
          Execute Transfer
        </Button>
      </CardContent>
    </Card>
  )
}
