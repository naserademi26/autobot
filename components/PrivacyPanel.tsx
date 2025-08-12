"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shield, Clock, Globe, Eye } from "lucide-react"
import { usePrivacyManager } from "@/hooks/usePrivacyManager"

export function PrivacyPanel() {
  const { settings, updateSettings } = usePrivacyManager()

  return (
    <Card className="bg-black/20 backdrop-blur-sm border-gray-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Shield className="w-5 h-5" />🔒 Privacy Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Random Delays */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <Label className="text-white">Random Delays</Label>
            </div>
            <Switch
              checked={settings.useRandomDelays}
              onCheckedChange={(checked) => updateSettings({ useRandomDelays: checked })}
            />
          </div>

          {settings.useRandomDelays && (
            <div className="grid grid-cols-2 gap-3 ml-6">
              <div>
                <Label className="text-gray-400 text-sm">Min Delay (ms)</Label>
                <Input
                  type="number"
                  value={settings.minDelay}
                  onChange={(e) => updateSettings({ minDelay: Number.parseInt(e.target.value) || 0 })}
                  className="bg-white/10 border-gray-600 text-white"
                />
              </div>
              <div>
                <Label className="text-gray-400 text-sm">Max Delay (ms)</Label>
                <Input
                  type="number"
                  value={settings.maxDelay}
                  onChange={(e) => updateSettings({ maxDelay: Number.parseInt(e.target.value) || 0 })}
                  className="bg-white/10 border-gray-600 text-white"
                />
              </div>
            </div>
          )}
        </div>

        {/* Stealth Mode */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-400" />
            <Label className="text-white">Stealth Mode</Label>
          </div>
          <Switch
            checked={settings.enableStealth}
            onCheckedChange={(checked) => updateSettings({ enableStealth: checked })}
          />
        </div>

        {/* User Agent Randomization */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-green-400" />
            <Label className="text-white">Randomize User Agent</Label>
          </div>
          <Switch
            checked={settings.randomizeUserAgent}
            onCheckedChange={(checked) => updateSettings({ randomizeUserAgent: checked })}
          />
        </div>

        {/* Proxy Rotation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-400" />
            <Label className="text-white">Proxy Rotation</Label>
          </div>
          <Switch
            checked={settings.useProxyRotation}
            onCheckedChange={(checked) => updateSettings({ useProxyRotation: checked })}
          />
        </div>

        {/* TOR Routing */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-red-400" />
            <Label className="text-white">TOR Routing (Advanced)</Label>
          </div>
          <Switch
            checked={settings.enableTorRouting}
            onCheckedChange={(checked) => updateSettings({ enableTorRouting: checked })}
          />
        </div>

        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
          <p className="text-blue-300 text-sm">
            🛡️ Privacy features help mask trading patterns and reduce detection risk
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
