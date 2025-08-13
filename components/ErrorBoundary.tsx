"use client"

import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-8">
          <Card className="bg-slate-800/60 backdrop-blur-sm border-slate-700 shadow-xl max-w-md w-full">
            <CardHeader className="text-center">
              <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-rose-400" />
              <CardTitle className="text-white text-xl">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-slate-300 text-center">
                The application encountered an error. Please try refreshing the page.
              </p>
              {this.state.error && (
                <details className="bg-slate-900/80 p-3 rounded-lg border border-slate-600">
                  <summary className="text-slate-400 text-sm cursor-pointer">Error details</summary>
                  <pre className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{this.state.error.message}</pre>
                </details>
              )}
              <Button
                onClick={() => window.location.reload()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Page
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
