"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Shield, Eye, EyeOff, Shuffle } from "lucide-react"

interface StealthPrivacyPanelProps {
  walletManager: any
}

export function StealthPrivacyPanel({ walletManager }: StealthPrivacyPanelProps) {
  return (
    <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Stealth Privacy System
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-black/20 border-gray-700">
            <CardContent className="p-4 text-center">
              <Eye className="w-8 h-8 mx-auto mb-2 text-blue-400" />
              <h3 className="text-white font-semibold">Transaction Mixing</h3>
              <p className="text-gray-400 text-sm mt-1">Obfuscate transaction patterns</p>
              <Badge className="mt-2 bg-green-600">Active</Badge>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-gray-700">
            <CardContent className="p-4 text-center">
              <EyeOff className="w-8 h-8 mx-auto mb-2 text-purple-400" />
              <h3 className="text-white font-semibold">IP Masking</h3>
              <p className="text-gray-400 text-sm mt-1">Hide your real IP address</p>
              <Badge className="mt-2 bg-yellow-600">Pending</Badge>
            </CardContent>
          </Card>

          <Card className="bg-black/20 border-gray-700">
            <CardContent className="p-4 text-center">
              <Shuffle className="w-8 h-8 mx-auto mb-2 text-orange-400" />
              <h3 className="text-white font-semibold">Random Delays</h3>
              <p className="text-gray-400 text-sm mt-1">Randomize transaction timing</p>
              <Badge className="mt-2 bg-green-600">Active</Badge>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12">
            <Shield className="w-5 h-5 mr-2" />
            Enable Full Stealth Mode
          </Button>

          <div className="bg-black/20 p-4 rounded-lg">
            <h4 className="text-white font-semibold mb-2">Privacy Features:</h4>
            <ul className="text-gray-400 text-sm space-y-1">
              <li>• Random transaction delays (1-10 seconds)</li>
              <li>• Multiple RPC endpoint rotation</li>
              <li>• Transaction pattern obfuscation</li>
              <li>• Wallet address mixing</li>
              <li>• Anti-MEV protection</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
