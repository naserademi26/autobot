"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Upload, Zap, FileText, AlertCircle, CheckCircle } from "lucide-react"
import type { ImportProgress } from "@/hooks/useWalletManager"

interface InstantWalletsProps {
  onImportWallets: (privateKeys: string[]) => Promise<number>
  importProgress: ImportProgress
}

export function InstantWallets({ onImportWallets, importProgress }: InstantWalletsProps) {
  const [privateKeysText, setPrivateKeysText] = useState("")
  const [isImporting, setIsImporting] = useState(false)

  const parsePrivateKeys = (text: string): string[] => {
    if (!text.trim()) return []

    // Split by various delimiters and clean up
    const keys = text
      .split(/[\n,;|]/)
      .map((key) => key.trim())
      .filter((key) => key.length > 0)

    return keys
  }

  const handleImport = async () => {
    const keys = parsePrivateKeys(privateKeysText)

    if (keys.length === 0) {
      return
    }

    if (keys.length > 60) {
      alert("Maximum 60 wallets allowed")
      return
    }

    setIsImporting(true)
    try {
      await onImportWallets(keys)
      setPrivateKeysText("")
    } catch (error) {
      console.error("Import failed:", error)
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setPrivateKeysText(content)
    }
    reader.readAsText(file)
  }

  const parsedKeys = parsePrivateKeys(privateKeysText)
  const progressPercentage = importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Import Controls */}
      <Card className="bg-black/40 backdrop-blur-sm border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-400" />
            Instant Wallet Import (Up to 60 Wallets)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Import Progress */}
          {importProgress.status === "importing" && (
            <div className="bg-blue-900/20 border border-blue-600 rounded-lg p-4">
              <div className="flex items-center justify-between text-sm text-white mb-2">
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-400" />⚡ IMPORTING {importProgress.total} WALLETS SIMULTANEOUSLY...
                </span>
                <span className="font-mono text-blue-400">
                  {importProgress.current}/{importProgress.total}
                </span>
              </div>
              <Progress value={progressPercentage} className="bg-gray-700" />
              <div className="text-xs text-blue-300 mt-1 text-center">
                All wallets importing at the exact same time with Promise.all() - Zero delays!
              </div>
            </div>
          )}

          {/* Success Message */}
          {importProgress.status === "complete" && (
            <div className="bg-green-900/20 border border-green-600 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">
                  ✅ Successfully imported {importProgress.current} wallets simultaneously!
                </span>
              </div>
              <div className="text-xs text-green-300 mt-1">
                All wallets have been automatically selected for trading
              </div>
            </div>
          )}

          {/* Private Keys Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Private Keys</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-slate-300">
                  {parsedKeys.length}/60 wallets
                </Badge>
                <input
                  type="file"
                  accept=".txt,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <Button
                  onClick={() => document.getElementById("file-upload")?.click()}
                  size="sm"
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Upload File
                </Button>
              </div>
            </div>

            <Textarea
              value={privateKeysText}
              onChange={(e) => setPrivateKeysText(e.target.value)}
              placeholder={`Paste up to 60 private keys here (one per line)

Supported formats:
• Base58: 5Kb8kLf9CJYs4Aazxtwn5A9XQXvtxvSWkrFBFq9A1QQXxiWrjuYKn7FjjKoKWVqVzgEcG3QDXsup8yzxaQPA94AX
• Array: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64]
• Hex: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d

You can separate keys with:
• New lines
• Commas
• Semicolons
• Pipes (|)`}
              className="bg-slate-800 border-slate-600 text-white min-h-[300px] font-mono text-sm"
            />
          </div>

          {/* Validation Info */}
          {parsedKeys.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-3">
              <div className="flex items-start gap-2">
                {parsedKeys.length <= 60 ? (
                  <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                )}
                <div>
                  <p className="text-sm text-white font-medium">
                    {parsedKeys.length <= 60
                      ? `✅ Ready to import ${parsedKeys.length} wallets`
                      : `❌ Too many wallets (${parsedKeys.length}/60)`}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    All wallets will be imported simultaneously using Promise.all() for maximum speed
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Import Button */}
          <Button
            onClick={handleImport}
            disabled={isImporting || parsedKeys.length === 0 || parsedKeys.length > 60}
            className="w-full h-12 text-lg font-bold bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
          >
            {isImporting ? (
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 animate-pulse" />
                IMPORTING {parsedKeys.length} WALLETS SIMULTANEOUSLY...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5" />⚡ INSTANT IMPORT {parsedKeys.length} WALLETS SIMULTANEOUSLY
              </div>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="bg-black/40 backdrop-blur-sm border-slate-600">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Import Instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-300">✅ Supported Formats:</h4>
              <ul className="text-xs text-slate-400 space-y-1">
                <li>• Base58 encoded private keys</li>
                <li>• Array format [1,2,3,...]</li>
                <li>• Hex format (128 characters)</li>
                <li>• Mixed formats in same input</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-300">⚡ Features:</h4>
              <ul className="text-xs text-slate-400 space-y-1">
                <li>• Import up to 60 wallets</li>
                <li>• Simultaneous processing</li>
                <li>• Auto-selection for trading</li>
                <li>• Real-time balance fetching</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
